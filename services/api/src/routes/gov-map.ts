import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { governmentAccess } from './gov-access';

const bbox = z.string().transform(value => value.split(',').map(part => part.trim()))
  .refine(parts => parts.length === 4 && parts.every(part => part !== '' && Number.isFinite(Number(part))))
  .transform(parts => parts.map(Number))
  .refine(([west, south, east, north]) => west >= -180 && east <= 180 && south >= -90 && north <= 90
    && west < east && south < north, 'Use west,south,east,north within geographic bounds; split antimeridian views.');
const filters = z.object({
  bbox,
  layer: z.enum(['reports', 'clusters', 'all']).default('all'),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']).optional(),
  category: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(250),
}).strict();

export default async function govMapRoutes(app: FastifyInstance) {
  app.get('/map', { preHandler: [app.authenticate, governmentAccess(app)] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = filters.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid map filters', details: parsed.error.flatten() });
    const { bbox: bounds, layer, status, category, limit } = parsed.data;
    try {
      // Each layer is capped independently. All metadata shares the same snapshot.
      // Spatial predicates use the existing GiST indexes; coordinates are GeoJSON [longitude, latitude].
      const result = await query<{ map: unknown }>(`
        WITH viewport AS (SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom),
        report_matches AS (
          SELECT r.id, r.public_id, r.status, r.submitted_at, c.label, c.slug,
            l.geom, l.address, l.accuracy, ic.public_id AS cluster_public_id
          FROM locations l JOIN reports r ON r.location_id = l.id
          JOIN report_categories c ON c.id = r.category_id
          LEFT JOIN issue_cluster_reports m ON m.report_id = r.id
          LEFT JOIN issue_clusters ic ON ic.id = m.issue_cluster_id
          WHERE $7::text IN ('reports', 'all') AND l.geom && (SELECT geom FROM viewport)
            AND ($5::text IS NULL OR r.status::text = $5)
            AND ($6::text IS NULL OR c.slug = $6)
        ), cluster_matches AS (
          SELECT ic.id, ic.public_id, ic.status, ic.report_count, ic.created_at,
            ic.centroid, c.label, c.slug
          FROM issue_clusters ic JOIN report_categories c ON c.id = ic.category_id
          WHERE $7::text IN ('clusters', 'all') AND ic.report_count > 0
            AND ic.centroid && (SELECT geom FROM viewport)
            AND ($5::text IS NULL OR ic.status::text = $5)
            AND ($6::text IS NULL OR c.slug = $6)
        ), report_page AS (
          SELECT * FROM report_matches ORDER BY submitted_at DESC, id DESC LIMIT $8
        ), cluster_page AS (
          SELECT * FROM cluster_matches ORDER BY created_at DESC, id DESC LIMIT $8
        )
        SELECT jsonb_build_object(
          'generatedAt', NOW(), 'bbox', jsonb_build_array($1, $2, $3, $4), 'limit', $8,
          'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'label', label)
            ORDER BY display_order, slug), '[]'::jsonb) FROM report_categories),
          'reports', jsonb_build_object('type', 'FeatureCollection',
            'total', (SELECT count(*)::int FROM report_matches),
            'withoutGeometry', (SELECT count(*)::int FROM reports r
              JOIN report_categories c ON c.id = r.category_id LEFT JOIN locations l ON l.id = r.location_id
              WHERE $7::text IN ('reports', 'all') AND l.geom IS NULL
                AND ($5::text IS NULL OR r.status::text = $5) AND ($6::text IS NULL OR c.slug = $6)),
            'features', (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'type', 'Feature', 'id', id, 'geometry', ST_AsGeoJSON(geom)::jsonb,
              'properties', jsonb_build_object('kind', 'report', 'publicId', public_id,
                'status', status, 'category', label, 'categorySlug', slug, 'submittedAt', submitted_at,
                'address', address, 'accuracy', accuracy, 'clusterPublicId', cluster_public_id))
              ORDER BY submitted_at DESC, id DESC), '[]'::jsonb) FROM report_page)),
          'clusters', jsonb_build_object('type', 'FeatureCollection',
            'total', (SELECT count(*)::int FROM cluster_matches),
            'withoutGeometry', (SELECT count(*)::int FROM issue_clusters ic
              JOIN report_categories c ON c.id = ic.category_id WHERE $7::text IN ('clusters', 'all')
                AND ic.report_count > 0 AND ic.centroid IS NULL
                AND ($5::text IS NULL OR ic.status::text = $5) AND ($6::text IS NULL OR c.slug = $6)),
            'features', (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'type', 'Feature', 'id', id, 'geometry', ST_AsGeoJSON(centroid)::jsonb,
              'properties', jsonb_build_object('kind', 'cluster', 'publicId', public_id,
                'status', status, 'category', label, 'categorySlug', slug,
                'reportCount', report_count, 'createdAt', created_at))
              ORDER BY created_at DESC, id DESC), '[]'::jsonb) FROM cluster_page))
        ) AS map`, [...bounds, status ?? null, category ?? null, layer, limit]);
      return result.rows[0].map;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
