import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isPriorityEnabled } from '../ai/priority';
import { query } from '../db';
import { governmentAccess } from './gov-access';

const filters = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']).optional(),
  category: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  q: z.string().trim().max(200).optional(),
}).strict();

const params = z.object({ id: z.uuid() });

function prioritySql(enabled: boolean) {
  if (!enabled) return {
    joins: '',
    projection: `jsonb_build_object('status', 'disabled', 'score', NULL, 'band', NULL)`,
  };
  return {
    joins: `LEFT JOIN issue_cluster_priority_jobs priority_job ON priority_job.issue_cluster_id = ic.id
      LEFT JOIN issue_cluster_priority_calculations priority_calculation
        ON priority_calculation.id = priority_job.last_calculation_id`,
    projection: `jsonb_build_object(
      'status', CASE WHEN priority_job.error_code IS NOT NULL THEN 'failed'
        WHEN priority_calculation.id IS NULL
          OR priority_job.evaluated_revision IS DISTINCT FROM priority_job.revision
          OR priority_job.next_run_at <= NOW() THEN 'pending'
        ELSE lower(priority_calculation.result->>'status') END,
      'score', CASE WHEN priority_job.error_code IS NULL
          AND priority_calculation.id IS NOT NULL
          AND priority_job.evaluated_revision IS NOT DISTINCT FROM priority_job.revision
          AND priority_job.next_run_at > NOW()
        THEN priority_calculation.result->'score' ELSE NULL END,
      'band', CASE WHEN priority_job.error_code IS NULL
          AND priority_calculation.id IS NOT NULL
          AND priority_job.evaluated_revision IS NOT DISTINCT FROM priority_job.revision
          AND priority_job.next_run_at > NOW()
        THEN priority_calculation.result->'band' ELSE NULL END)`,
  };
}

const summaryColumns = (priority: string) => `ic.id, ic.public_id AS "publicId", ic.status,
  ic.report_count AS "reportCount", ic.created_at AS "createdAt", ic.updated_at AS "updatedAt",
  jsonb_build_object('slug', c.slug, 'label', c.label) AS category,
  CASE WHEN ic.centroid IS NULL THEN NULL ELSE jsonb_build_object(
    'latitude', ST_Y(ic.centroid), 'longitude', ST_X(ic.centroid)) END AS centroid,
  (SELECT count(*)::int FROM issue_cluster_review_candidates review
    WHERE review.issue_cluster_id = ic.id AND review.status = 'PENDING') AS "pendingReviewCount",
  (SELECT jsonb_build_object(
      'pending', count(*) FILTER (WHERE r.status = 'PENDING')::int,
      'inProgress', count(*) FILTER (WHERE r.status = 'IN_PROGRESS')::int,
      'resolved', count(*) FILTER (WHERE r.status = 'RESOLVED')::int,
      'rejected', count(*) FILTER (WHERE r.status = 'REJECTED')::int)
    FROM issue_cluster_reports membership JOIN reports r ON r.id = membership.report_id
    WHERE membership.issue_cluster_id = ic.id) AS "reportStatuses",
  ${priority} AS priority`;

export default async function govClustersRoutes(app: FastifyInstance) {
  const access = [app.authenticate, governmentAccess(app)];
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.get('/', { preHandler: access }, async (request, reply) => {
    const parsed = filters.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid cluster filters', details: parsed.error.flatten() });
    const { page, limit, status, category, q } = parsed.data;
    const priority = prioritySql(isPriorityEnabled());
    try {
      const result = await query<{ listing: unknown }>(`
        WITH matches AS (
          SELECT ic.id, ic.updated_at
          FROM issue_clusters ic JOIN report_categories c ON c.id = ic.category_id
          WHERE ic.report_count > 0
            AND ($1::text IS NULL OR ic.status::text = $1)
            AND ($2::text IS NULL OR c.slug = $2)
            AND ($3::text IS NULL OR strpos(lower(concat_ws(' ', ic.public_id, c.label)), lower($3)) > 0)
        ), page_ids AS (
          SELECT id FROM matches ORDER BY updated_at DESC, id DESC LIMIT $4 OFFSET $5
        ), cluster_page AS (
          SELECT ${summaryColumns(priority.projection)}
          FROM page_ids page JOIN issue_clusters ic ON ic.id = page.id
          JOIN report_categories c ON c.id = ic.category_id
          ${priority.joins}
        )
        SELECT jsonb_build_object('generatedAt', NOW(), 'page', $6::int, 'limit', $4::int,
          'total', (SELECT count(*)::int FROM matches),
          'priorityEnabled', $7::boolean,
          'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'label', label)
            ORDER BY display_order, slug), '[]'::jsonb) FROM report_categories),
          'clusters', (SELECT coalesce(jsonb_agg(to_jsonb(cluster_page)
            ORDER BY "updatedAt" DESC, id DESC), '[]'::jsonb) FROM cluster_page)) AS listing`,
        [status ?? null, category ?? null, q || null, limit, (page - 1) * limit, page, isPriorityEnabled()]);
      return result.rows[0].listing;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.get('/:id', { preHandler: access }, async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid cluster id' });
    const priority = prioritySql(isPriorityEnabled());
    try {
      const result = await query<{ cluster: unknown }>(`
        SELECT to_jsonb(detail) AS cluster FROM (
          SELECT ${summaryColumns(priority.projection)},
            CASE WHEN anchor.id IS NULL THEN NULL ELSE jsonb_build_object(
              'latitude', anchor.latitude, 'longitude', anchor.longitude,
              'accuracy', anchor.accuracy, 'address', anchor.address) END AS "anchorLocation",
            (SELECT jsonb_build_object(
                'ai', count(*) FILTER (WHERE assignment_method = 'AI')::int,
                'human', count(*) FILTER (WHERE assignment_method = 'HUMAN')::int,
                'system', count(*) FILTER (WHERE assignment_method = 'SYSTEM')::int,
                'averageConfidence', round(avg(confidence)::numeric, 4),
                'firstAssignedAt', min(assigned_at), 'lastAssignedAt', max(assigned_at))
              FROM issue_cluster_reports membership WHERE membership.issue_cluster_id = ic.id) AS grouping
          FROM issue_clusters ic JOIN report_categories c ON c.id = ic.category_id
          LEFT JOIN locations anchor ON anchor.id = ic.anchor_location_id
          ${priority.joins}
          WHERE ic.id = $1 AND ic.report_count > 0
        ) detail`, [parsed.data.id]);
      if (!result.rows[0]) return reply.status(404).send({ error: 'Cluster not found' });
      return { cluster: result.rows[0].cluster, priorityEnabled: isPriorityEnabled() };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
