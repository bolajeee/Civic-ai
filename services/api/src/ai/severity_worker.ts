import type { FastifyBaseLogger } from 'fastify';
import { pool, query } from '../db';
import { downloadImage } from '../lib/storage';
import { SeverityError, estimateReportSeverity, severityConfidenceThreshold,
  SEVERITY_VERSION, type SeverityContext, isSeverityEnabled } from './severity';

const MAX_ATTEMPTS = 3;
interface SeveritySnapshot extends SeverityContext {
  mediaId: string; storageKey: string; mimeType: string; threshold: number; rubricVersion: string;
}
interface SeverityJob {
  id: string; report_id: string; media_id: string; storage_key: string; media_type: string;
  attempt_count: number; model_name: string; input_snapshot: SeveritySnapshot | null;
}
export function startSeverityWorker(logger: FastifyBaseLogger): () => void {
  if (!isSeverityEnabled()) return () => {};
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    try { await processOneSeverityJob(logger); }
    catch { logger.error('AI severity queue poll failed'); }
    finally { if (!stopped) timer = setTimeout(run, 3_000); }
  };
  void run();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
async function claimJob(): Promise<SeverityJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE report_ai_analyses SET status = 'FAILED', error_code = 'WORKER_CRASHED',
       completed_at = NOW(), updated_at = NOW()
       WHERE analysis_type = 'SEVERITY_ESTIMATION' AND status = 'PROCESSING'
         AND updated_at < NOW() - INTERVAL '10 minutes' AND attempt_count >= $1`, [MAX_ATTEMPTS]);
    const candidate = await client.query<SeverityJob>(
      `SELECT a.id, a.report_id, a.media_id, m.storage_key, m.media_type,
              a.attempt_count, a.model_name, a.input_snapshot
       FROM report_ai_analyses a JOIN report_media m ON m.id = a.media_id
       WHERE a.analysis_type = 'SEVERITY_ESTIMATION'
         AND ((a.status = 'PENDING' AND a.next_attempt_at <= NOW())
           OR (a.status = 'PROCESSING' AND a.updated_at < NOW() - INTERVAL '10 minutes'))
         AND a.attempt_count < $1
       ORDER BY a.created_at LIMIT 1 FOR UPDATE OF a SKIP LOCKED`, [MAX_ATTEMPTS]);
    if (!candidate.rows.length) { await client.query('COMMIT'); return null; }
    const job = candidate.rows[0];
    const updated = await client.query(
      `UPDATE report_ai_analyses SET status = 'PROCESSING', attempt_count = attempt_count + 1,
       started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE id = $1 RETURNING attempt_count`, [job.id]);
    await client.query('COMMIT');
    return { ...job, attempt_count: updated.rows[0].attempt_count };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function processOneSeverityJob(logger: FastifyBaseLogger): Promise<void> {
  const job = await claimJob();
  if (!job) return;
  try {
    let snapshot = job.input_snapshot;
    if (!snapshot) {
      const rows = await query<{
        category_slug: string; category_label: string; description: string | null;
        latitude: number | null; longitude: number | null; accuracy: number | null; address: string | null;
      }>(`SELECT c.slug AS category_slug, c.label AS category_label, r.description,
                 l.latitude, l.longitude, l.accuracy, l.address
          FROM reports r JOIN report_categories c ON c.id = r.category_id
          LEFT JOIN locations l ON l.id = r.location_id WHERE r.id = $1`, [job.report_id]);
      const row = rows.rows[0];
      if (!row) throw new SeverityError('REPORT_NOT_FOUND', false);
      snapshot = {
        category: { slug: row.category_slug, label: row.category_label }, description: row.description,
        location: row.latitude !== null && row.longitude !== null ? {
          latitude: Number(row.latitude), longitude: Number(row.longitude),
          accuracy: row.accuracy === null ? null : Number(row.accuracy), address: row.address,
        } : null,
        mediaId: job.media_id, storageKey: job.storage_key, mimeType: job.media_type,
        threshold: severityConfidenceThreshold(), rubricVersion: SEVERITY_VERSION,
      };
      const saved = await query(
        `UPDATE report_ai_analyses SET input_snapshot = $2::jsonb
         WHERE id = $1 AND status = 'PROCESSING' AND attempt_count = $3 RETURNING id`,
        [job.id, JSON.stringify(snapshot), job.attempt_count]);
      if (!saved.rowCount) return;
    }
    const image = await downloadImage(snapshot.storageKey);
    const severity = await estimateReportSeverity({ image, mimeType: snapshot.mimeType,
      model: job.model_name, context: {
        category: snapshot.category, description: snapshot.description, location: snapshot.location,
      }, threshold: snapshot.threshold });
    await query(
      `UPDATE report_ai_analyses SET status = 'COMPLETED', model_version = $2,
       confidence = $3, prediction = $4::jsonb, error_code = NULL,
       completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'PROCESSING' AND attempt_count = $5`,
      [job.id, severity.modelVersion, severity.confidence, JSON.stringify(severity), job.attempt_count]);
  } catch (error) {
    const code = error instanceof SeverityError ? error.code : 'SEVERITY_PROCESSING_FAILED';
    const canRetry = (!(error instanceof SeverityError) || error.retryable) && job.attempt_count < MAX_ATTEMPTS;
    const delay = [30_000, 120_000][job.attempt_count - 1] ?? 0;
    await query(
      `UPDATE report_ai_analyses SET status = $2, error_code = $3,
       next_attempt_at = NOW() + ($4 * INTERVAL '1 millisecond'), updated_at = NOW(),
       completed_at = CASE WHEN $2 = 'FAILED' THEN NOW() ELSE NULL END
       WHERE id = $1 AND status = 'PROCESSING' AND attempt_count = $5`,
      [job.id, canRetry ? 'PENDING' : 'FAILED', code, delay, job.attempt_count]);
    logger.error({ analysisId: job.id, errorCode: code, retryScheduled: canRetry }, 'AI severity job failed');
  }
}
