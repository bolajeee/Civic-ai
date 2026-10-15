import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isPriorityEnabled } from '../ai/priority';
import { query } from '../db';
import { governmentAccess } from './gov-access';
import { compileIssueReport, type CompilationInput } from '../lib/issue-report-compilation';
import { renderIssueReportPdf } from '../lib/issue-report-pdf';

const filters = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']).optional(),
  category: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  q: z.string().trim().max(200).optional(),
  review: z.enum(['all', 'pending', 'clear']).default('all'),
  assignment: z.enum(['all', 'AI', 'HUMAN', 'SYSTEM']).default('all'),
  location: z.enum(['all', 'present', 'missing']).default('all'),
}).strict();

const reviewFilters = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'ACCEPTED', 'DISMISSED', 'all']).default('PENDING'),
  reason: z.enum(['all', 'LOW_SCORE', 'AMBIGUOUS_MATCH']).default('all'),
  category: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  q: z.string().trim().max(200).optional(),
}).strict();

const params = z.object({ id: z.uuid() });
const versionParams = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().min(1).max(1000000),
});
const evidenceFilters = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

interface EvidencePhoto { id: string; storageKey: string; mediaType: string; displayOrder: number }
interface EvidenceReport { photos: EvidencePhoto[]; [key: string]: unknown }
interface EvidenceResult {
  generatedAt: string; page: number; limit: number; total: number;
  cluster: { id: string; publicId: string } | null; reports: EvidenceReport[];
}
interface Options { signPhotos?: (keys: string[], ttl: number) => Promise<Record<string, string>> }

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
    LEFT JOIN issue_cluster_reports review_source ON review_source.report_id = review.report_id
    WHERE review.status = 'PENDING'
      AND (review.issue_cluster_id = ic.id OR review_source.issue_cluster_id = ic.id)) AS "pendingReviewCount",
  (SELECT jsonb_build_object(
      'pending', count(*) FILTER (WHERE r.status = 'PENDING')::int,
      'inProgress', count(*) FILTER (WHERE r.status = 'IN_PROGRESS')::int,
      'resolved', count(*) FILTER (WHERE r.status = 'RESOLVED')::int,
      'rejected', count(*) FILTER (WHERE r.status = 'REJECTED')::int)
    FROM issue_cluster_reports membership JOIN reports r ON r.id = membership.report_id
    WHERE membership.issue_cluster_id = ic.id) AS "reportStatuses",
  ${priority} AS priority`;

async function loadCompilation(id: string) {
  const result = await query<{ compilation: CompilationInput | null }>(`
    WITH selected_cluster AS (
      SELECT ic.id, ic.public_id, ic.status, c.slug, c.label,
        CASE WHEN ic.centroid IS NULL THEN NULL ELSE jsonb_build_object(
          'latitude', ST_Y(ic.centroid), 'longitude', ST_X(ic.centroid)) END AS centroid
      FROM issue_clusters ic
      JOIN report_categories c ON c.id = ic.category_id
      WHERE ic.id = $1 AND ic.report_count > 0
    ), source_reports AS (
      SELECT r.id, r.public_id AS "publicId", r.description, r.status,
        r.submitted_at AS "submittedAt",
        CASE WHEN location.id IS NULL THEN NULL ELSE jsonb_build_object(
          'address', location.address, 'latitude', location.latitude,
          'longitude', location.longitude) END AS location,
        (SELECT count(*)::int FROM report_media media WHERE media.report_id = r.id) AS "photoCount",
        membership.assignment_method AS "assignmentMethod",
        (SELECT count(*)::int FROM issue_cluster_review_candidates review
          WHERE review.report_id = r.id AND review.status = 'PENDING') AS "pendingReviewCount",
        (SELECT jsonb_build_object(
            'status', classification.status,
            'suggestedCategory', classification.prediction->>'categorySlug',
            'acceptedCategory', accepted_category.slug,
            'confidence', classification.confidence,
            'evidence', classification.prediction->>'evidence')
          FROM report_ai_analyses classification
          LEFT JOIN report_categories accepted_category
            ON accepted_category.id = classification.predicted_category_id
          WHERE classification.report_id = r.id
            AND classification.analysis_type = 'IMAGE_CLASSIFICATION') AS classification,
        (SELECT jsonb_build_object(
            'status', severity.status,
            'suggestedLevel', severity.prediction->>'suggestedLevel',
            'acceptedLevel', severity.prediction->>'level',
            'confidence', severity.confidence,
            'reviewRequired', CASE WHEN jsonb_typeof(severity.prediction->'reviewRequired') = 'boolean'
              THEN (severity.prediction->>'reviewRequired')::boolean ELSE NULL END,
            'uncertainty', severity.prediction->>'uncertainty')
          FROM report_ai_analyses severity
          WHERE severity.report_id = r.id
            AND severity.analysis_type = 'SEVERITY_ESTIMATION') AS severity
      FROM selected_cluster cluster
      JOIN issue_cluster_reports membership ON membership.issue_cluster_id = cluster.id
      JOIN reports r ON r.id = membership.report_id
      LEFT JOIN locations location ON location.id = r.location_id
    )
    SELECT CASE WHEN cluster.id IS NULL THEN NULL ELSE jsonb_build_object(
      'generatedAt', NOW(),
      'cluster', jsonb_build_object(
        'id', cluster.id, 'publicId', cluster.public_id, 'status', cluster.status,
        'category', jsonb_build_object('slug', cluster.slug, 'label', cluster.label),
        'centroid', cluster.centroid),
      'sourceReports', (SELECT coalesce(jsonb_agg(to_jsonb(source_reports)
        ORDER BY "submittedAt", id), '[]'::jsonb) FROM source_reports)
    ) END AS compilation
    FROM selected_cluster cluster`, [id]);
  const input = result.rows[0]?.compilation;
  return input ? compileIssueReport(input) : null;
}

export default async function govClustersRoutes(app: FastifyInstance, options: Options) {
  const access = [app.authenticate, governmentAccess(app)];
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.get('/', { preHandler: access }, async (request, reply) => {
    const parsed = filters.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid cluster filters', details: parsed.error.flatten() });
    const { page, limit, status, category, q, review, assignment, location } = parsed.data;
    const priority = prioritySql(isPriorityEnabled());
    try {
      const result = await query<{ listing: unknown }>(`
        WITH matches AS (
          SELECT ic.id, ic.updated_at
          FROM issue_clusters ic JOIN report_categories c ON c.id = ic.category_id
          WHERE ic.report_count > 0
            AND ($1::text IS NULL OR ic.status::text = $1)
            AND ($2::text IS NULL OR c.slug = $2)
            AND ($3::text IS NULL OR strpos(lower(concat_ws(' ', ic.public_id, c.label)), lower($3)) > 0
              OR EXISTS (SELECT 1 FROM issue_cluster_reports search_membership
                JOIN reports search_report ON search_report.id = search_membership.report_id
                LEFT JOIN locations search_location ON search_location.id = search_report.location_id
                WHERE search_membership.issue_cluster_id = ic.id
                  AND strpos(lower(concat_ws(' ', search_report.public_id, search_report.description,
                    search_location.address)), lower($3)) > 0)
              OR EXISTS (SELECT 1 FROM issue_cluster_review_candidates search_review
                JOIN reports source_report ON source_report.id = search_review.report_id
                LEFT JOIN reports candidate_report ON candidate_report.id = search_review.candidate_report_id
                LEFT JOIN issue_cluster_reports source_membership ON source_membership.report_id = source_report.id
                WHERE (search_review.issue_cluster_id = ic.id OR source_membership.issue_cluster_id = ic.id)
                  AND strpos(lower(concat_ws(' ', source_report.public_id, candidate_report.public_id)), lower($3)) > 0))
            AND ($4::text = 'all' OR ($4 = 'pending' AND EXISTS (
              SELECT 1 FROM issue_cluster_review_candidates review_filter
              LEFT JOIN issue_cluster_reports review_source ON review_source.report_id = review_filter.report_id
              WHERE review_filter.status = 'PENDING'
                AND (review_filter.issue_cluster_id = ic.id OR review_source.issue_cluster_id = ic.id)))
              OR ($4 = 'clear' AND NOT EXISTS (
              SELECT 1 FROM issue_cluster_review_candidates review_filter
              LEFT JOIN issue_cluster_reports review_source ON review_source.report_id = review_filter.report_id
              WHERE review_filter.status = 'PENDING'
                AND (review_filter.issue_cluster_id = ic.id OR review_source.issue_cluster_id = ic.id))))
            AND ($5::text = 'all' OR EXISTS (SELECT 1 FROM issue_cluster_reports assignment_filter
              WHERE assignment_filter.issue_cluster_id = ic.id AND assignment_filter.assignment_method = $5))
            AND ($6::text = 'all' OR EXISTS (SELECT 1 FROM issue_cluster_reports location_membership
              JOIN reports location_report ON location_report.id = location_membership.report_id
              WHERE location_membership.issue_cluster_id = ic.id
                AND (($6 = 'present' AND location_report.location_id IS NOT NULL)
                  OR ($6 = 'missing' AND location_report.location_id IS NULL))))
        ), page_ids AS (
          SELECT id FROM matches ORDER BY updated_at DESC, id DESC LIMIT $7 OFFSET $8
        ), cluster_page AS (
          SELECT ${summaryColumns(priority.projection)}
          FROM page_ids page JOIN issue_clusters ic ON ic.id = page.id
          JOIN report_categories c ON c.id = ic.category_id
          ${priority.joins}
        )
        SELECT jsonb_build_object('generatedAt', NOW(), 'page', $9::int, 'limit', $7::int,
          'total', (SELECT count(*)::int FROM matches),
          'priorityEnabled', $10::boolean,
          'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'label', label)
            ORDER BY display_order, slug), '[]'::jsonb) FROM report_categories),
          'clusters', (SELECT coalesce(jsonb_agg(to_jsonb(cluster_page)
            ORDER BY "updatedAt" DESC, id DESC), '[]'::jsonb) FROM cluster_page)) AS listing`,
        [status ?? null, category ?? null, q || null, review, assignment, location,
          limit, (page - 1) * limit, page, isPriorityEnabled()]);
      return result.rows[0].listing;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.get('/review-queue', { preHandler: access }, async (request, reply) => {
    const parsed = reviewFilters.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid review queue filters', details: parsed.error.flatten() });
    const { page, limit, status, reason, category, q } = parsed.data;
    try {
      const result = await query<{ queue: unknown }>(`
        WITH matches AS (
          SELECT review.report_id, review.issue_cluster_id, review.created_at
          FROM issue_cluster_review_candidates review
          JOIN reports source ON source.id = review.report_id
          JOIN report_categories source_category ON source_category.id = source.category_id
          JOIN issue_clusters proposed ON proposed.id = review.issue_cluster_id
          LEFT JOIN reports candidate ON candidate.id = review.candidate_report_id
          LEFT JOIN issue_cluster_reports current_membership ON current_membership.report_id = review.report_id
          LEFT JOIN issue_clusters current_cluster ON current_cluster.id = current_membership.issue_cluster_id
          WHERE ($1::text = 'all' OR review.status = $1)
            AND ($2::text = 'all' OR review.reason = $2)
            AND ($3::text IS NULL OR source_category.slug = $3)
            AND ($4::text IS NULL OR strpos(lower(concat_ws(' ', source.public_id, source.description,
              candidate.public_id, proposed.public_id, current_cluster.public_id)), lower($4)) > 0)
        ), page_keys AS (
          SELECT * FROM matches ORDER BY created_at ASC, report_id, issue_cluster_id LIMIT $5 OFFSET $6
        ), queue_page AS (
          SELECT review.report_id AS "reportId", review.issue_cluster_id AS "proposedClusterId",
            review.score, review.reason, review.status, review.scoring_version AS "scoringVersion",
            review.created_at AS "createdAt",
            review.reviewed_at AS "reviewedAt", review.review_reason AS "reviewReason",
            reviewer.public_id AS "reviewedBy",
            jsonb_build_object('id', source.id, 'publicId', source.public_id,
              'description', source.description, 'status', source.status,
              'submittedAt', source.submitted_at,
              'category', jsonb_build_object('slug', source_category.slug, 'label', source_category.label),
              'location', CASE WHEN source_location.id IS NULL THEN NULL ELSE jsonb_build_object(
                'latitude', source_location.latitude, 'longitude', source_location.longitude,
                'accuracy', source_location.accuracy, 'address', source_location.address) END) AS report,
            CASE WHEN current_cluster.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', current_cluster.id, 'publicId', current_cluster.public_id, 'status', current_cluster.status,
              'reportCount', current_cluster.report_count,
              'assignmentMethod', current_membership.assignment_method) END AS "currentCluster",
            jsonb_build_object('id', proposed.id, 'publicId', proposed.public_id, 'status', proposed.status,
              'reportCount', proposed.report_count,
              'category', jsonb_build_object('slug', proposed_category.slug, 'label', proposed_category.label)) AS "proposedCluster",
            CASE WHEN candidate.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', candidate.id, 'publicId', candidate.public_id, 'description', candidate.description) END AS "candidateReport",
            CASE WHEN signal.report_id IS NULL THEN NULL ELSE jsonb_build_object(
              'distanceMeters', signal.distance_meters, 'semanticSimilarity', signal.semantic_similarity,
              'categoryMatch', signal.category_match, 'combinedScore', signal.score) END AS signals,
            (SELECT jsonb_build_object('outcome', decision.outcome, 'decidedAt', decision.decided_at,
                'clusteringVersion', decision.clustering_version,
                'autoMinScore', CASE WHEN jsonb_typeof(decision.config->'autoMinScore') = 'number'
                  THEN (decision.config->>'autoMinScore')::double precision ELSE NULL END,
                'ambiguityMargin', CASE WHEN jsonb_typeof(decision.config->'ambiguityMargin') = 'number'
                  THEN (decision.config->>'ambiguityMargin')::double precision ELSE NULL END)
              FROM report_cluster_decisions decision WHERE decision.report_id = review.report_id) AS decision
          FROM page_keys keys
          JOIN issue_cluster_review_candidates review
            ON review.report_id = keys.report_id AND review.issue_cluster_id = keys.issue_cluster_id
          JOIN reports source ON source.id = review.report_id
          JOIN report_categories source_category ON source_category.id = source.category_id
          LEFT JOIN locations source_location ON source_location.id = source.location_id
          JOIN issue_clusters proposed ON proposed.id = review.issue_cluster_id
          JOIN report_categories proposed_category ON proposed_category.id = proposed.category_id
          LEFT JOIN reports candidate ON candidate.id = review.candidate_report_id
          LEFT JOIN issue_cluster_reports current_membership ON current_membership.report_id = review.report_id
          LEFT JOIN issue_clusters current_cluster ON current_cluster.id = current_membership.issue_cluster_id
          LEFT JOIN report_duplicate_candidates signal
            ON signal.report_id = review.report_id AND signal.candidate_report_id = review.candidate_report_id
          LEFT JOIN users reviewer ON reviewer.id = review.reviewed_by
        )
        SELECT jsonb_build_object('generatedAt', NOW(), 'page', $7::int, 'limit', $5::int,
          'total', (SELECT count(*)::int FROM matches),
          'counts', (SELECT jsonb_build_object(
            'pending', count(*) FILTER (WHERE status = 'PENDING')::int,
            'accepted', count(*) FILTER (WHERE status = 'ACCEPTED')::int,
            'dismissed', count(*) FILTER (WHERE status = 'DISMISSED')::int)
            FROM issue_cluster_review_candidates),
          'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'label', label)
            ORDER BY display_order, slug), '[]'::jsonb) FROM report_categories),
          'items', (SELECT coalesce(jsonb_agg(to_jsonb(queue_page)
            ORDER BY "createdAt" ASC, "reportId", "proposedClusterId"), '[]'::jsonb) FROM queue_page)) AS queue`,
        [status, reason, category ?? null, q || null, limit, (page - 1) * limit, page]);
      return result.rows[0].queue;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.get('/:id/evidence', { preHandler: access }, async (request, reply) => {
    const parsedParams = params.safeParse(request.params);
    const parsedQuery = evidenceFilters.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return reply.status(400).send({ error: 'Invalid cluster evidence request' });
    }
    const { page, limit } = parsedQuery.data;
    try {
      const result = await query<{ evidence: EvidenceResult }>(`
        WITH selected_cluster AS (
          SELECT id, public_id FROM issue_clusters WHERE id = $1 AND report_count > 0
        ), evidence_reports AS (
          SELECT r.id, r.public_id AS "publicId", r.description, r.status,
            r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
            jsonb_build_object('slug', category.slug, 'label', category.label) AS category,
            CASE WHEN location.id IS NULL THEN NULL ELSE jsonb_build_object(
              'latitude', location.latitude, 'longitude', location.longitude,
              'accuracy', location.accuracy, 'address', location.address) END AS location,
            jsonb_build_object(
              'assignmentMethod', membership.assignment_method,
              'confidence', membership.confidence,
              'assignedAt', membership.assigned_at,
              'visualSimilarity', NULL,
              'visualSignalStatus', 'not_implemented',
              'search', (SELECT jsonb_build_object('status', duplicate_search.status,
                'candidateCount', duplicate_search.candidate_count,
                'scoringVersion', duplicate_search.scoring_version,
                'errorCode', duplicate_search.error_code)
                FROM report_duplicate_searches duplicate_search WHERE duplicate_search.report_id = r.id),
              'decision', (SELECT jsonb_build_object(
                  'outcome', decision.outcome,
                  'decidedAt', decision.decided_at,
                  'clusteringVersion', decision.clustering_version,
                  'scoringVersion', decision.scoring_version,
                  'errorCode', decision.error_code,
                  'autoMinScore', CASE WHEN jsonb_typeof(decision.config->'autoMinScore') = 'number'
                    THEN (decision.config->>'autoMinScore')::double precision ELSE NULL END,
                  'ambiguityMargin', CASE WHEN jsonb_typeof(decision.config->'ambiguityMargin') = 'number'
                    THEN (decision.config->>'ambiguityMargin')::double precision ELSE NULL END,
                  'radiusMeters', CASE WHEN jsonb_typeof(decision.config->'radiusMeters') = 'number'
                    THEN (decision.config->>'radiusMeters')::double precision ELSE NULL END,
                  'matchedReport', CASE WHEN matched.id IS NULL THEN NULL ELSE jsonb_build_object(
                    'id', matched.id, 'publicId', matched.public_id) END,
                  'signals', CASE WHEN matched_signal.report_id IS NULL THEN NULL ELSE jsonb_build_object(
                    'distanceMeters', matched_signal.distance_meters,
                    'semanticSimilarity', matched_signal.semantic_similarity,
                    'categoryMatch', matched_signal.category_match,
                    'combinedScore', matched_signal.score,
                    'scoringVersion', matched_signal.scoring_version) END)
                FROM report_cluster_decisions decision
                LEFT JOIN reports matched ON matched.id = decision.matched_report_id
                LEFT JOIN report_duplicate_candidates matched_signal
                  ON matched_signal.report_id = decision.report_id
                  AND matched_signal.candidate_report_id = decision.matched_report_id
                WHERE decision.report_id = r.id),
              'competingCandidates', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'cluster', jsonb_build_object('id', candidate_cluster.id,
                    'publicId', candidate_cluster.public_id),
                  'report', CASE WHEN candidate_report.id IS NULL THEN NULL ELSE jsonb_build_object(
                    'id', candidate_report.id, 'publicId', candidate_report.public_id) END,
                  'score', review.score, 'reason', review.reason, 'status', review.status,
                  'scoringVersion', review.scoring_version,
                  'distanceMeters', candidate_signal.distance_meters,
                  'semanticSimilarity', candidate_signal.semantic_similarity,
                  'categoryMatch', candidate_signal.category_match)
                ORDER BY review.score DESC, candidate_cluster.id), '[]'::jsonb)
                FROM issue_cluster_review_candidates review
                JOIN issue_clusters candidate_cluster ON candidate_cluster.id = review.issue_cluster_id
                LEFT JOIN reports candidate_report ON candidate_report.id = review.candidate_report_id
                LEFT JOIN report_duplicate_candidates candidate_signal
                  ON candidate_signal.report_id = review.report_id
                  AND candidate_signal.candidate_report_id = review.candidate_report_id
                WHERE review.report_id = r.id)
            ) AS grouping
          FROM selected_cluster cluster
          JOIN issue_cluster_reports membership ON membership.issue_cluster_id = cluster.id
          JOIN reports r ON r.id = membership.report_id
          JOIN report_categories category ON category.id = r.category_id
          LEFT JOIN locations location ON location.id = r.location_id
        ), evidence_page AS (
          SELECT evidence_reports.*,
            (SELECT coalesce(jsonb_agg(jsonb_build_object('id', media.id,
              'storageKey', media.storage_key, 'mediaType', media.media_type,
              'displayOrder', media.display_order) ORDER BY media.display_order, media.id), '[]'::jsonb)
              FROM report_media media WHERE media.report_id = evidence_reports.id) AS photos
          FROM evidence_reports ORDER BY "submittedAt" DESC, id DESC LIMIT $2 OFFSET $3
        )
        SELECT jsonb_build_object(
          'generatedAt', NOW(), 'page', $4::int, 'limit', $2::int,
          'total', (SELECT count(*)::int FROM evidence_reports),
          'cluster', (SELECT jsonb_build_object('id', id, 'publicId', public_id) FROM selected_cluster),
          'reports', (SELECT coalesce(jsonb_agg(to_jsonb(evidence_page)
            ORDER BY "submittedAt" DESC, id DESC), '[]'::jsonb) FROM evidence_page)) AS evidence`,
        [parsedParams.data.id, limit, (page - 1) * limit, page]);
      const evidence = result.rows[0].evidence;
      if (!evidence.cluster) return reply.status(404).send({ error: 'Cluster not found' });
      const keys = evidence.reports.flatMap(report => report.photos.map(photo => photo.storageKey));
      let urls: Record<string, string> = {};
      if (keys.length) {
        try {
          const sign = options.signPhotos ?? (await import('../lib/storage')).getImageUrls;
          urls = await sign(keys, 900);
        } catch (error) { app.log.error(error, 'Cluster evidence photo signing failed'); }
      }
      return { ...evidence, reports: evidence.reports.map(report => ({
        ...report, photos: report.photos.map(({ storageKey, ...photo }) => ({
          ...photo, url: urls[storageKey] ?? null,
        })),
      })), photosExpireInSeconds: 900 };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.get('/:id/compilation', { preHandler: access }, async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid cluster id' });
    try {
      const compilation = await loadCompilation(parsed.data.id);
      if (!compilation) return reply.status(404).send({ error: 'Cluster not found' });
      return compilation;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.get('/:id/report.pdf', { preHandler: access }, async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid cluster id' });
    try {
      const compilation = await loadCompilation(parsed.data.id);
      if (!compilation) return reply.status(404).send({ error: 'Cluster not found' });
      const filename = `${compilation.cluster.publicId}-issue-report.pdf`;
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(renderIssueReportPdf(compilation));
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.get('/:id/report-versions', { preHandler: access }, async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid cluster id' });
    try {
      const result = await query<{ versions: unknown }>(`
        SELECT CASE WHEN cluster.id IS NULL THEN NULL ELSE jsonb_build_object(
          'cluster', jsonb_build_object('id', cluster.id, 'publicId', cluster.public_id),
          'versions', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', version.id, 'number', version.version_number,
            'createdAt', version.created_at, 'createdBy', creator.public_id,
            'reviewStatus', version.snapshot->'review'->>'status',
            'sourceCount', version.snapshot->'cluster'->'reportCount')
            ORDER BY version.version_number DESC)
            FROM issue_report_versions version
            JOIN users creator ON creator.id = version.created_by
            WHERE version.issue_cluster_id = cluster.id), '[]'::jsonb)) END AS versions
        FROM issue_clusters cluster WHERE cluster.id = $1`, [parsed.data.id]);
      if (!result.rows[0]?.versions) return reply.status(404).send({ error: 'Cluster not found' });
      return result.rows[0].versions;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.post('/:id/report-versions', { preHandler: access }, async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid cluster id' });
    try {
      const compilation = await loadCompilation(parsed.data.id);
      if (!compilation) return reply.status(404).send({ error: 'Cluster not found' });
      const actorId = (request.user as { id: string }).id;
      const result = await query<{ version: { id: string; number: number; createdAt: string } }>(`
        WITH allocated AS (
          UPDATE issue_clusters SET next_report_version = next_report_version + 1
          WHERE id = $1
          RETURNING id, next_report_version - 1 AS version_number
        ), inserted AS (
          INSERT INTO issue_report_versions
            (issue_cluster_id, version_number, snapshot, created_by)
          SELECT allocated.id, allocated.version_number, $2::jsonb, $3
          FROM allocated
          RETURNING id, version_number, created_at
        )
        SELECT jsonb_build_object('id', id, 'number', version_number,
          'createdAt', created_at) AS version FROM inserted`,
      [parsed.data.id, JSON.stringify(compilation), actorId]);
      return reply.status(201).send({ version: result.rows[0].version });
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  app.get('/:id/report-versions/:version/report.pdf', { preHandler: access }, async (request, reply) => {
    const parsed = versionParams.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid report version' });
    try {
      const result = await query<{ report: null | { snapshot: ReturnType<typeof compileIssueReport>;
        id: string; number: number; createdAt: string; createdBy: string; publicId: string } }>(`
        SELECT jsonb_build_object('snapshot', version.snapshot, 'id', version.id,
          'number', version.version_number, 'createdAt', version.created_at,
          'createdBy', creator.public_id, 'publicId', cluster.public_id) AS report
        FROM issue_report_versions version
        JOIN issue_clusters cluster ON cluster.id = version.issue_cluster_id
        JOIN users creator ON creator.id = version.created_by
        WHERE version.issue_cluster_id = $1 AND version.version_number = $2`,
      [parsed.data.id, parsed.data.version]);
      const stored = result.rows[0]?.report;
      if (!stored) return reply.status(404).send({ error: 'Report version not found' });
      const versioned = { ...stored.snapshot, liveDraft: false as const,
        version: { id: stored.id, number: stored.number, createdAt: stored.createdAt, createdBy: stored.createdBy } };
      return reply.header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${stored.publicId}-issue-report-v${stored.number}.pdf"`)
        .send(renderIssueReportPdf(versioned));
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
