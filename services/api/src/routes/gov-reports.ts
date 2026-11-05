import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { governmentAccess } from './gov-access';

const filters = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']).optional(),
  category: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  q: z.string().trim().max(200).optional(),
  grouping: z.enum(['all', 'assigned', 'unassigned']).default('all'),
  location: z.enum(['all', 'present', 'missing']).default('all'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to,
  { message: 'From date must be on or before To date.', path: ['to'] });

// Shared projection deliberately excludes citizen identity and AI estimates.
const columns = `r.id, r.public_id AS "publicId", r.description, r.status,
  r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
  jsonb_build_object('slug', c.slug, 'label', c.label) AS category,
  CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('latitude', l.latitude,
    'longitude', l.longitude, 'accuracy', l.accuracy, 'address', l.address) END AS location,
  CASE WHEN ic.id IS NULL THEN NULL ELSE jsonb_build_object('id', ic.id,
    'publicId', ic.public_id, 'status', ic.status) END AS cluster`;
const joins = `FROM reports r JOIN report_categories c ON c.id = r.category_id
  LEFT JOIN locations l ON l.id = r.location_id
  LEFT JOIN issue_cluster_reports m ON m.report_id = r.id
  LEFT JOIN issue_clusters ic ON ic.id = m.issue_cluster_id`;

interface Media { id: string; storageKey: string; mediaType: string; displayOrder: number }
interface ReportDetail { id: string; photos: Media[]; [key: string]: unknown }
interface Options { signPhotos?: (keys: string[], ttl: number) => Promise<Record<string, string>> }

export default async function govReportsRoutes(app: FastifyInstance, options: Options) {
  const access = [app.authenticate, governmentAccess(app)];
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.get('/', { preHandler: access }, async (request, reply) => {
    const parsed = filters.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid report filters', details: parsed.error.flatten() });
    const { page, limit, status, category, q, grouping, location, from, to } = parsed.data;
    try {
      const result = await query<{ listing: unknown }>(`
        WITH matches AS (
          SELECT ${columns} ${joins}
          WHERE ($1::text IS NULL OR r.status::text = $1)
            AND ($2::text IS NULL OR c.slug = $2)
            AND ($3::text IS NULL OR strpos(lower(concat_ws(' ', r.public_id, r.description,
              l.address, c.label, ic.public_id)), lower($3)) > 0)
            AND ($4::text = 'all' OR ($4 = 'assigned' AND m.report_id IS NOT NULL)
              OR ($4 = 'unassigned' AND m.report_id IS NULL))
            AND ($5::text = 'all' OR ($5 = 'present' AND l.id IS NOT NULL)
              OR ($5 = 'missing' AND l.id IS NULL))
            AND ($6::date IS NULL OR r.submitted_at >= ($6::date::timestamp AT TIME ZONE 'Africa/Lagos'))
            AND ($7::date IS NULL OR r.submitted_at < (($7::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'))
        ), report_page AS (
          SELECT matches.*, (SELECT count(*)::int FROM report_media media WHERE media.report_id = matches.id) AS "photoCount"
          FROM matches ORDER BY "submittedAt" DESC, id DESC LIMIT $8 OFFSET $9
        )
        SELECT jsonb_build_object('generatedAt', NOW(), 'page', $10::int, 'limit', $8::int,
          'total', (SELECT count(*)::int FROM matches),
          'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'label', label)
            ORDER BY display_order, slug), '[]'::jsonb) FROM report_categories),
          'reports', (SELECT coalesce(jsonb_agg(to_jsonb(report_page) ORDER BY "submittedAt" DESC, id DESC),
            '[]'::jsonb) FROM report_page)) AS listing`,
        [status ?? null, category ?? null, q || null, grouping, location, from ?? null, to ?? null,
          limit, (page - 1) * limit, page]);
      return result.rows[0].listing;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.get('/:id', { preHandler: access }, async (request, reply) => {
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid report id' });
    try {
      const result = await query<{ report: ReportDetail }>(`
        SELECT to_jsonb(detail) AS report FROM (
          SELECT ${columns},
            (SELECT coalesce(jsonb_agg(jsonb_build_object('id', media.id, 'storageKey', media.storage_key,
              'mediaType', media.media_type, 'displayOrder', media.display_order)
              ORDER BY media.display_order, media.id), '[]'::jsonb)
              FROM report_media media WHERE media.report_id = r.id) AS photos
          ${joins} WHERE r.id = $1
        ) detail`, [parsed.data.id]);
      if (!result.rows[0]) return reply.status(404).send({ error: 'Report not found' });
      const { photos, ...report } = result.rows[0].report;
      let urls: Record<string, string> = {};
      if (photos.length) {
        try {
          const sign = options.signPhotos ?? (await import('../lib/storage')).getImageUrls;
          urls = await sign(photos.map(photo => photo.storageKey), 900);
        } catch (error) { app.log.error(error, 'Report photo signing failed'); }
      }
      return { report: { ...report, photos: photos.map(({ storageKey, ...photo }) => ({
        ...photo, url: urls[storageKey] ?? null,
      })) }, photosExpireInSeconds: 900 };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
