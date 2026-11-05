import type { FastifyBaseLogger } from 'fastify';
import { pool } from '../db';
import { calculatePriority, isPriorityEnabled, PRIORITY_VERSION, type PriorityInput, type PriorityReport } from './priority';

export function startPriorityWorker(logger: FastifyBaseLogger): () => void {
  if (!isPriorityEnabled()) return () => {};
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    try { await processOneClusterPriority(); }
    catch (err) { logger.error({ err }, 'Cluster priority calculation failed'); }
    finally { if (!stopped) timer = setTimeout(run, 3_000); }
  };
  void run();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/** Queue lock + consistent evidence snapshot; no model calls or citizen writes. */
export async function processOneClusterPriority(): Promise<void> {
  const client = await pool.connect();
  let calculationError: unknown;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const jobs = await client.query<{ issue_cluster_id: string; revision: string }>(
      `SELECT issue_cluster_id, revision FROM issue_cluster_priority_jobs
       WHERE next_run_at <= NOW() ORDER BY next_run_at, issue_cluster_id
       LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const job = jobs.rows[0];
    if (!job) { await client.query('COMMIT'); return; }
    await client.query('SAVEPOINT priority_calculation');
    try {
      const clusterRows = await client.query<{ status: string; calculated_at: Date; grouping_review_pending: boolean }>(
        `SELECT ic.status, NOW() AS calculated_at,
           EXISTS (SELECT 1 FROM issue_cluster_review_candidates rc
             WHERE rc.status = 'PENDING' AND (rc.issue_cluster_id = ic.id OR rc.report_id IN
               (SELECT report_id FROM issue_cluster_reports WHERE issue_cluster_id = ic.id))) AS grouping_review_pending
         FROM issue_clusters ic WHERE ic.id = $1`, [job.issue_cluster_id]);
      const cluster = clusterRows.rows[0];
      if (!cluster) throw new Error('CLUSTER_NOT_FOUND');
      const reports = await client.query<{
        id: string; citizen_id: string; status: string; submitted_at: Date;
        analysis_id: string | null; analysis_status: string | null; prediction: unknown; model_version: string | null;
      }>(`SELECT r.id, r.citizen_id, r.status, r.submitted_at,
            a.id AS analysis_id, a.status AS analysis_status, a.prediction, a.model_version
          FROM issue_cluster_reports m JOIN reports r ON r.id = m.report_id
          LEFT JOIN report_ai_analyses a ON a.report_id = r.id AND a.analysis_type = 'SEVERITY_ESTIMATION'
          WHERE m.issue_cluster_id = $1 ORDER BY r.id`, [job.issue_cluster_id]);
      const contextRows = await client.query<{
        population_score: number | null; population_source: string | null;
        location_importance_score: number | null; location_importance_source: string | null;
      }>('SELECT * FROM issue_cluster_priority_context WHERE issue_cluster_id = $1', [job.issue_cluster_id]);
      const context = contextRows.rows[0];
      const reportInputs: PriorityReport[] = reports.rows.map(r => ({ id: r.id, citizenId: r.citizen_id,
        status: r.status, submittedAt: r.submitted_at.toISOString(),
        severity: r.analysis_id ? { analysisId: r.analysis_id, status: r.analysis_status!, prediction: r.prediction,
          modelVersion: r.model_version } : null }));
      const input: PriorityInput = { clusterId: job.issue_cluster_id, clusterStatus: cluster.status,
        calculatedAt: cluster.calculated_at.toISOString(), reports: reportInputs,
        population: context?.population_score != null ? { score: context.population_score, source: context.population_source! } : null,
        locationImportance: context?.location_importance_score != null
          ? { score: context.location_importance_score, source: context.location_importance_source! } : null,
        groupingReviewPending: cluster.grouping_review_pending };
      const result = calculatePriority(input);
      const calculation = await client.query<{ id: string }>(
        `INSERT INTO issue_cluster_priority_calculations
           (issue_cluster_id, scoring_version, input_snapshot, result, calculated_at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) RETURNING id`,
        [job.issue_cluster_id, PRIORITY_VERSION, JSON.stringify({ ...input, contextRecord: context ?? null }),
          JSON.stringify(result), input.calculatedAt]);
      await client.query(
        `UPDATE issue_cluster_priority_jobs SET last_calculation_id = $2, evaluated_revision = revision,
         next_run_at = CASE WHEN $3 THEN 'infinity'::timestamptz ELSE NOW() + INTERVAL '1 hour' END,
         error_code = NULL, attempt_count = 0 WHERE issue_cluster_id = $1`,
        [job.issue_cluster_id, calculation.rows[0].id, result.status === 'INACTIVE']);
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT priority_calculation');
      await client.query(
        `UPDATE issue_cluster_priority_jobs SET error_code = 'PRIORITY_CALCULATION_FAILED',
         attempt_count = attempt_count + 1, next_run_at = NOW() + INTERVAL '2 minutes'
         WHERE issue_cluster_id = $1`, [job.issue_cluster_id]);
      calculationError = error;
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  if (calculationError) throw calculationError;
}
