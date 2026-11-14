import type { FastifyInstance } from 'fastify';
import { query } from '../db';
import { isPriorityEnabled } from '../ai/priority';
import { governmentAccess } from './gov-access';
import { scopeParams } from '../lib/gov-scope';

/** Overview only: counts cover the full dataset (scoped to the account's state, if any); activity lists are bounded. */
export default async function govDashboardRoutes(app: FastifyInstance) {
  const requireGovernment = governmentAccess(app);

  app.get('/overview', { preHandler: [app.authenticate, requireGovernment] }, async (request, reply) => {
    const priorityEnabled = isPriorityEnabled();
    const [govLevel, govStateId] = scopeParams(request.govAccount!);
    // Interpolated fragments are fixed server-owned SQL, never request input.
    const priorityCte = priorityEnabled ? `,
      priority_state AS (
        SELECT CASE
          WHEN j.error_code IS NOT NULL THEN 'failed'
          WHEN p.id IS NULL OR j.evaluated_revision IS DISTINCT FROM j.revision
            OR j.next_run_at <= NOW() THEN 'pending'
          ELSE lower(p.result->>'status') END AS state
        FROM issue_clusters ic
        LEFT JOIN locations anchor ON anchor.id = ic.anchor_location_id
        LEFT JOIN issue_cluster_priority_jobs j ON j.issue_cluster_id = ic.id
        LEFT JOIN issue_cluster_priority_calculations p ON p.id = j.last_calculation_id
        WHERE ic.status IN ('PENDING', 'IN_PROGRESS') AND ic.report_count > 0
          AND ($1::text = 'FEDERAL' OR anchor.state_id = $2::uuid)
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
            count(*) FILTER (WHERE r.status = 'PENDING')::int AS pending,
            count(*) FILTER (WHERE r.status = 'IN_PROGRESS')::int AS in_progress,
            count(*) FILTER (WHERE r.status = 'RESOLVED')::int AS resolved,
            count(*) FILTER (WHERE r.status = 'REJECTED')::int AS rejected,
            count(*) FILTER (WHERE r.location_id IS NULL)::int AS without_location
          FROM reports r LEFT JOIN locations l ON l.id = r.location_id
          WHERE ($1::text = 'FEDERAL' OR l.state_id = $2::uuid)
        ), cluster_counts AS (
          SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ic.status IN ('PENDING', 'IN_PROGRESS'))::int AS open,
            count(*) FILTER (WHERE ic.status = 'RESOLVED')::int AS resolved,
            count(*) FILTER (WHERE ic.status = 'REJECTED')::int AS rejected
          FROM issue_clusters ic LEFT JOIN locations anchor ON anchor.id = ic.anchor_location_id
          WHERE ic.report_count > 0 AND ($1::text = 'FEDERAL' OR anchor.state_id = $2::uuid)
        ) ${priorityCte}
        SELECT jsonb_build_object(
          'generatedAt', NOW(),
          'reports', (SELECT jsonb_build_object('total', total, 'pending', pending,
            'inProgress', in_progress, 'resolved', resolved, 'rejected', rejected,
            'withoutLocation', without_location) FROM report_counts),
          'clusters', (SELECT row_to_json(cluster_counts) FROM cluster_counts),
          'unclusteredReports', (SELECT count(*)::int FROM reports r
            LEFT JOIN locations l ON l.id = r.location_id
            WHERE NOT EXISTS (SELECT 1 FROM issue_cluster_reports m WHERE m.report_id = r.id)
              AND ($1::text = 'FEDERAL' OR l.state_id = $2::uuid)),
          'groupingReview', (SELECT jsonb_build_object('candidates', count(*)::int,
            'reports', count(DISTINCT rc.report_id)::int)
            FROM issue_cluster_review_candidates rc
            JOIN reports r ON r.id = rc.report_id LEFT JOIN locations l ON l.id = r.location_id
            WHERE rc.status = 'PENDING' AND ($1::text = 'FEDERAL' OR l.state_id = $2::uuid)),
          'priority', ${prioritySummary},
          'categories', (SELECT coalesce(jsonb_agg(category ORDER BY display_order, slug), '[]'::jsonb)
            FROM (SELECT c.slug, c.label, c.display_order,
              count(r.id) FILTER (WHERE r.id IS NOT NULL
                AND ($1::text = 'FEDERAL' OR l.state_id = $2::uuid))::int AS total,
              count(r.id) FILTER (WHERE r.id IS NOT NULL AND r.status IN ('PENDING', 'IN_PROGRESS')
                AND ($1::text = 'FEDERAL' OR l.state_id = $2::uuid))::int AS open
              FROM report_categories c LEFT JOIN reports r ON r.category_id = c.id
              LEFT JOIN locations l ON l.id = r.location_id
              GROUP BY c.id) category),
          'recentReports', (SELECT coalesce(jsonb_agg(report ORDER BY "submittedAt" DESC, id DESC), '[]'::jsonb)
            FROM (SELECT r.id, r.public_id AS "publicId", c.label AS category, r.status,
              r.submitted_at AS "submittedAt", l.address,
              (r.location_id IS NOT NULL) AS "hasLocation", ic.public_id AS "clusterPublicId"
              FROM reports r JOIN report_categories c ON c.id = r.category_id
              LEFT JOIN locations l ON l.id = r.location_id
              LEFT JOIN issue_cluster_reports m ON m.report_id = r.id
              LEFT JOIN issue_clusters ic ON ic.id = m.issue_cluster_id
              WHERE ($1::text = 'FEDERAL' OR l.state_id = $2::uuid)
              ORDER BY r.submitted_at DESC, r.id DESC LIMIT 8) report)
        ) AS overview`, [govLevel, govStateId]);
      reply.header('Cache-Control', 'no-store');
      return result.rows[0].overview;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
