import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { pool, query } from '../db';
import { uploadImage, getImageUrls, deleteImages } from '../lib/storage';
import { createReportSchema, listReportsSchema } from '../schemas/report';
import {
  classificationModel,
  isSupportedClassificationImageType,
  isClassificationEnabled,
} from '../ai/classification';

/** Matches the client-side cap in the Flutter app. */
const MAX_PHOTOS = 5;

/**
 * Accepted image types. Anything else is rejected before it reaches storage.
 *
 * Kept in step with `_mimeTypeFor` in the Flutter photo picker: the two lists
 * have to agree, or a photo the citizen can pick is one the server will refuse
 * only after they have filled in the whole form.
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

interface StagedFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

/** A report row joined with its category, location and media summary. */
interface ReportRow {
  id: string;
  public_id: string;
  status: string;
  description: string | null;
  submitted_at: Date;
  category_id: string;
  category_slug: string;
  category_label: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  address: string | null;
  photo_count: string;
  thumbnail_key: string | null;
  ai_analysis_status: string | null;
  ai_model_name: string | null;
  ai_model_version: string | null;
  ai_predicted_category_id: string | null;
  ai_predicted_category_slug: string | null;
  ai_predicted_category_label: string | null;
  ai_confidence: string | null;
  ai_prediction: { evidence?: string } | null;
}

export default async function reportRoutes(fastify: FastifyInstance) {
  // Counts cover all of the caller's reports, independently of history pagination.
  fastify.get(
    '/summary',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const citizenId = (request.user as { id: string }).id;
        const result = await query<{
          total: string;
          pending: string;
          in_progress: string;
          resolved: string;
          rejected: string;
        }>(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
                  COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') AS in_progress,
                  COUNT(*) FILTER (WHERE status = 'RESOLVED') AS resolved,
                  COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected
           FROM reports
           WHERE citizen_id = $1`,
          [citizenId],
        );
        const counts = result.rows[0];

        // PostgreSQL COUNT returns bigint strings; the API exposes JSON numbers.
        return reply.status(200).send({
          total: Number(counts.total),
          pending: Number(counts.pending),
          inProgress: Number(counts.in_progress),
          resolved: Number(counts.resolved),
          rejected: Number(counts.rejected),
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/reports/categories
  //
  // The citizen app submits `categoryId`, so it needs the identifiers. Serving
  // them from the table keeps a single source of truth rather than duplicating
  // the list — and their UUIDs — in the client.
  // ---------------------------------------------------------------------------
  fastify.get(
    '/categories',
    { preHandler: [fastify.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await query(
          `SELECT id, slug, label
           FROM report_categories
           ORDER BY display_order`,
        );

        return reply.status(200).send({ categories: result.rows });
      } catch (err: any) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/reports — submit a report with its photos
  //
  // Multipart rather than JSON so the photos travel with the report: a report
  // row can never end up committed without the images it describes.
  // ---------------------------------------------------------------------------
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const fields: Record<string, string> = {};
      const files: StagedFile[] = [];

      try {
        // The file count is capped here, at the parser, not only after the loop.
        // Every part is buffered in memory by `toBuffer()`, so checking
        // `files.length` afterwards would mean an unbounded stream of 10 MB
        // photos is held in RAM before the first one is ever rejected. Busboy
        // aborts the request the moment the cap is crossed.
        for await (const part of request.parts({
          limits: { files: MAX_PHOTOS },
        })) {
          if (part.type === 'file') {
            files.push({
              buffer: await part.toBuffer(),
              filename: part.filename,
              mimetype: part.mimetype,
            });
          } else {
            fields[part.fieldname] = String(part.value);
          }
        }
      } catch (err: any) {
        // The parser's own limits. These are the citizen's problem — too many
        // photos, or one that is too large — rather than a malformed request,
        // so they get a message that says what to do instead of a bare 400.
        if (err.code === 'FST_FILES_LIMIT') {
          return reply
            .status(400)
            .send({ error: `A report can have at most ${MAX_PHOTOS} photos` });
        }
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply
            .status(400)
            .send({ error: 'Each photo must be smaller than 10 MB' });
        }

        fastify.log.error(err);
        return reply.status(400).send({ error: 'Malformed upload' });
      }

      const uploadedKeys: string[] = [];

      try {
        if (files.length === 0) {
          return reply
            .status(400)
            .send({ error: 'At least one photo is required' });
        }
        if (files.length > MAX_PHOTOS) {
          // Unreachable while the parser cap above is in place — kept as a
          // backstop so the rule survives someone relaxing that cap.
          return reply
            .status(400)
            .send({ error: `A report can have at most ${MAX_PHOTOS} photos` });
        }

        const unsupported = files.find(
          (file) => !ALLOWED_MIME_TYPES.has(file.mimetype),
        );
        if (unsupported) {
          return reply.status(400).send({
            error: `Unsupported image type: ${unsupported.mimetype}`,
          });
        }

        const input = createReportSchema.parse(fields);

        // Both or neither — a lone latitude is a client bug, not a location.
        const hasLatitude = input.latitude !== undefined;
        const hasLongitude = input.longitude !== undefined;
        if (hasLatitude !== hasLongitude) {
          return reply
            .status(400)
            .send({ error: 'latitude and longitude must be provided together' });
        }

        const category = await query(
          'SELECT id FROM report_categories WHERE id = $1',
          [input.categoryId],
        );
        if (category.rows.length === 0) {
          return reply.status(400).send({ error: 'Unknown category' });
        }

        // Generated up front so the storage path and the database row share an
        // id, which lets the upload happen before the transaction opens.
        const reportId = crypto.randomUUID();
        const citizenId = (request.user as { id: string }).id;

        for (const [index, file] of files.entries()) {
          const extension =
            EXTENSION_BY_MIME[file.mimetype] ??
            file.filename.split('.').pop()?.toLowerCase() ??
            'jpg';
          const key = `${reportId}/${index}-${crypto.randomUUID()}.${extension}`;

          await uploadImage(key, file.buffer, file.mimetype);
          uploadedKeys.push(key);
        }

        const hasLocation = hasLatitude && hasLongitude;

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          let locationId: string | null = null;
          if (hasLocation) {
            const location = await client.query(
              `INSERT INTO locations (latitude, longitude, accuracy, address, geom)
               VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($2, $1), 4326))
               RETURNING id`,
              [
                input.latitude,
                input.longitude,
                input.accuracy ?? null,
                input.address ?? null,
              ],
            );
            locationId = location.rows[0].id;
          }

          const report = await client.query(
            `INSERT INTO reports
               (id, citizen_id, category_id, description, location_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, public_id, status, submitted_at`,
            [
              reportId,
              citizenId,
              input.categoryId,
              input.description ?? null,
              locationId,
            ],
          );

          let classificationMediaId: string | null = null;
          let firstMediaId: string | null = null;
          for (const [index, file] of files.entries()) {
            const media = await client.query(
              `INSERT INTO report_media
                 (report_id, storage_key, media_type, file_size, display_order)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id`,
              [
                reportId,
                uploadedKeys[index],
                file.mimetype,
                file.buffer.length,
                index,
              ],
            );
            const mediaId = media.rows[0]?.id ?? null;
            if (index === 0) firstMediaId = mediaId;
            if (
              classificationMediaId === null &&
              isSupportedClassificationImageType(file.mimetype)
            ) {
              classificationMediaId = mediaId;
            }
          }

          const classificationEnabled = isClassificationEnabled();
          const hasSupportedImage = classificationMediaId !== null;
          const analysisMediaId = classificationMediaId ?? firstMediaId;
          const classificationStatus = !classificationEnabled
            ? 'DISABLED'
            : hasSupportedImage
              ? 'PENDING'
              : 'SKIPPED';
          if (classificationEnabled && analysisMediaId) {
            await client.query(
              `INSERT INTO report_ai_analyses
                 (report_id, media_id, analysis_type, status, model_name, error_code)
               VALUES ($1, $2, 'IMAGE_CLASSIFICATION', $3, $4, $5)`,
              [
                reportId,
                analysisMediaId,
                classificationStatus,
                classificationModel(),
                classificationStatus === 'SKIPPED'
                  ? 'UNSUPPORTED_IMAGE_TYPE'
                  : null,
              ],
            );
          }

          await client.query('COMMIT');

          // camelCase to match the list endpoint, so the client parses both
          // responses with the same field names.
          return reply.status(201).send({
            report: {
              id: report.rows[0].id,
              publicId: report.rows[0].public_id,
              status: report.rows[0].status,
              submittedAt: report.rows[0].submitted_at,
              aiClassificationStatus: classificationStatus.toLowerCase(),
            },
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } catch (err: any) {
        // The rows were rolled back, so the uploaded images now reference
        // nothing. Best-effort removal — the submission error matters more.
        if (uploadedKeys.length > 0) {
          try {
            await deleteImages(uploadedKeys);
          } catch (cleanupError) {
            fastify.log.error(cleanupError);
          }
        }

        if (err.name === 'ZodError') {
          return reply.status(400).send({ error: err.issues });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/reports — the authenticated citizen's own reports, newest first
  // ---------------------------------------------------------------------------
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { limit, offset } = listReportsSchema.parse(request.query);
        const citizenId = (request.user as { id: string }).id;
        const aiEnabled = isClassificationEnabled();
        const aiColumns = aiEnabled
          ? `ai.status AS ai_analysis_status,
             ai.model_name AS ai_model_name,
             ai.model_version AS ai_model_version,
             ai.predicted_category_id AS ai_predicted_category_id,
             ai_category.slug AS ai_predicted_category_slug,
             ai_category.label AS ai_predicted_category_label,
             ai.confidence AS ai_confidence,
             ai.prediction AS ai_prediction`
          : `NULL::text AS ai_analysis_status,
             NULL::text AS ai_model_name,
             NULL::text AS ai_model_version,
             NULL::uuid AS ai_predicted_category_id,
             NULL::text AS ai_predicted_category_slug,
             NULL::text AS ai_predicted_category_label,
             NULL::numeric AS ai_confidence,
             NULL::jsonb AS ai_prediction`;
        const aiJoins = aiEnabled
          ? `LEFT JOIN report_ai_analyses ai
               ON ai.report_id = r.id
              AND ai.analysis_type = 'IMAGE_CLASSIFICATION'
             LEFT JOIN report_categories ai_category
               ON ai_category.id = ai.predicted_category_id`
          : '';

        // Scoped by citizen_id: a citizen sees only their own reports, per the
        // data isolation rule in docs/architecture.md.
        const result = await query(
          `SELECT
             r.id,
             r.public_id,
             r.status,
             r.description,
             r.submitted_at,
             c.id     AS category_id,
             c.slug   AS category_slug,
             c.label  AS category_label,
             l.latitude,
             l.longitude,
             l.accuracy,
             l.address,
             (SELECT COUNT(*) FROM report_media m WHERE m.report_id = r.id)
               AS photo_count,
             (SELECT m.storage_key FROM report_media m
               WHERE m.report_id = r.id
               ORDER BY m.display_order
               LIMIT 1) AS thumbnail_key,
             ${aiColumns}
           FROM reports r
           JOIN report_categories c ON c.id = r.category_id
           LEFT JOIN locations l ON l.id = r.location_id
           ${aiJoins}
           WHERE r.citizen_id = $1
           ORDER BY r.submitted_at DESC
           LIMIT $2 OFFSET $3`,
          [citizenId, limit, offset],
        );

        const rows = result.rows as ReportRow[];

        // Signed in one batch rather than one call per row.
        const thumbnailUrls = await getImageUrls(
          rows
            .map((row) => row.thumbnail_key)
            .filter((key): key is string => key !== null),
        );

        return reply.status(200).send({
          reports: rows.map((row) => ({
            id: row.id,
            publicId: row.public_id,
            status: row.status,
            description: row.description,
            submittedAt: row.submitted_at,
            category: {
              id: row.category_id,
              slug: row.category_slug,
              label: row.category_label,
            },
            location:
              row.latitude !== null && row.longitude !== null
                ? {
                    latitude: row.latitude,
                    longitude: row.longitude,
                    accuracy: row.accuracy,
                    address: row.address,
                  }
                : null,
            photoCount: Number(row.photo_count),
            thumbnailUrl: row.thumbnail_key
              ? (thumbnailUrls[row.thumbnail_key] ?? null)
              : null,
            aiClassification: row.ai_analysis_status
              ? {
                  status: row.ai_analysis_status.toLowerCase(),
                  model: row.ai_model_name,
                  modelVersion: row.ai_model_version,
                  category:
                    row.ai_predicted_category_id !== null
                      ? {
                          id: row.ai_predicted_category_id,
                          slug: row.ai_predicted_category_slug,
                          label: row.ai_predicted_category_label,
                        }
                      : null,
                  confidence:
                    row.ai_confidence === null
                      ? null
                      : Number(row.ai_confidence),
                  evidence: row.ai_prediction?.evidence ?? null,
                }
              : null,
          })),
        });
      } catch (err: any) {
        if (err.name === 'ZodError') {
          return reply.status(400).send({ error: err.issues });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
