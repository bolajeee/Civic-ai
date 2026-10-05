import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db';
import { isPriorityEnabled } from '../ai/priority';

/** Overview only: counts cover the full dataset; activity lists are bounded. */
export default async function govDashboardRoutes(app: FastifyInstance) {
  async function requireGovernment(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await query<{ role: string; status: string }>(
        'SELECT role, status FROM users WHERE id = $1', [(request.user as { id: string }).id]);
      const user = result.rows[0];
      if (!user || !['ADMIN', 'OPERATOR'].includes(user.role) || user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: 'Access denied' });
      }
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  }

  app.get('/overview', { preHandler: [app.authenticate, requireGovernment] }, async (_request, reply) => {
    const priorityEnabled = isPriorityEnabled();
    // Interpolated fragments are fixed server-owned SQL, never request input.
    const priorityCte = priorityEnabled ? `,
      priority_state AS (
        SELECT CASE
          WHEN j.error_code IS NOT NULL THEN 'failed'
          WHEN p.id IS NULL OR j.evaluated_revision IS DISTINCT FROM j.revision
            OR j.next_run_at <= NOW() THEN 'pending'
          ELSE lower(p.result->>'status') END AS state
        FROM issue_clusters ic
        LEFT JOIN issue_cluster_priority_jobs j ON j.issue_cluster_id = ic.id
        LEFT JOIN issue_cluster_priority_calculations p ON p.id = j.last_calculation_id
        WHERE ic.status IN ('PENDING', 'IN_PROGRESS') AND ic.report_count > 0
      )` : '';
    const prioritySummary = priorityEnabled ? `jsonb_build_object(
      'enabled', true,
      'completed', (SELECT count(*)::int FROM priority_state WHERE state = 'completed'),
      'incomplete', (SELECT count(*)::int FROM priority_state WHERE state = 'incomplete'),
      'unavailable', (SELECT count(*)::int FROM priority_state WHERE state = 'unavailable'),
      'inactive', (SELECT count(*)::int FROM priority_state WHERE state = 'inactive'),
      'pending', (SELECT count(*)::int FROM priority_state WHERE state = 'pending'),
      'failed', (SELECT count(*)::int FROM priority_state WHERE state = 'failed'))`
      : `jsonb_build_object('enabled', false)`;
    try {
      // One PostgreSQL statement gives all sections the same MVCC snapshot.
      const result = await query<{ overview: unknown }>(`
        WITH report_counts AS (
          SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
            count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
            count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
            count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
            count(*) FILTER (WHERE location_id IS NULL)::int AS without_location
          FROM reports
        ), cluster_counts AS (
          SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('PENDING', 'IN_PROGRESS'))::int AS open,
            count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
            count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected
          FROM issue_clusters WHERE report_count > 0
        ) ${priorityCte}
        SELECT jsonb_build_object(
          'generatedAt', NOW(),
          'reports', (SELECT jsonb_build_object('total', total, 'pending', pending,
            'inProgress', in_progress, 'resolved', resolved, 'rejected', rejected,
            'withoutLocation', without_location) FROM report_counts),
          'clusters', (SELECT row_to_json(cluster_counts) FROM cluster_counts),
          'unclusteredReports', (SELECT count(*)::int FROM reports r
            WHERE NOT EXISTS (SELECT 1 FROM issue_cluster_reports m WHERE m.report_id = r.id)),
          'groupingReview', (SELECT jsonb_build_object('candidates', count(*)::int,
            'reports', count(DISTINCT report_id)::int)
            FROM issue_cluster_review_candidates WHERE status = 'PENDING'),
          'priority', ${prioritySummary},
          'categories', (SELECT coalesce(jsonb_agg(category ORDER BY display_order, slug), '[]'::jsonb)
            FROM (SELECT c.slug, c.label, c.display_order, count(r.id)::int AS total,
              count(r.id) FILTER (WHERE r.status IN ('PENDING', 'IN_PROGRESS'))::int AS open
              FROM report_categories c LEFT JOIN reports r ON r.category_id = c.id
              GROUP BY c.id) category),
          'recentReports', (SELECT coalesce(jsonb_agg(report ORDER BY "submittedAt" DESC, id DESC), '[]'::jsonb)
            FROM (SELECT r.id, r.public_id AS "publicId", c.label AS category, r.status,
              r.submitted_at AS "submittedAt", l.address,
              (r.location_id IS NOT NULL) AS "hasLocation", ic.public_id AS "clusterPublicId"
              FROM reports r JOIN report_categories c ON c.id = r.category_id
              LEFT JOIN locations l ON l.id = r.location_id
              LEFT JOIN issue_cluster_reports m ON m.report_id = r.id
              LEFT JOIN issue_clusters ic ON ic.id = m.issue_cluster_id
              ORDER BY r.submitted_at DESC, r.id DESC LIMIT 8) report)
        ) AS overview`);
      reply.header('Cache-Control', 'no-store');
      return result.rows[0].overview;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
