import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { pool, query } from '../db';
import { uploadImage, getImageUrls, deleteImages } from '../lib/storage';
import { createReportSchema, listReportsSchema } from '../schemas/report';

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
}

export default async function reportRoutes(fastify: FastifyInstance) {
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

          for (const [index, file] of files.entries()) {
            await client.query(
              `INSERT INTO report_media
                 (report_id, storage_key, media_type, file_size, display_order)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                reportId,
                uploadedKeys[index],
                file.mimetype,
                file.buffer.length,
                index,
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
               LIMIT 1) AS thumbnail_key
           FROM reports r
           JOIN report_categories c ON c.id = r.category_id
           LEFT JOIN locations l ON l.id = r.location_id
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
