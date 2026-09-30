import type { FastifyBaseLogger } from 'fastify';
import { pool, query } from '../db';
import {
  EmbeddingError,
  buildEmbeddingText,
  generateEmbedding,
  isEmbeddingEnabled,
} from './embedding';

const POLL_INTERVAL_MS = 3_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [30_000, 120_000];

interface EmbeddingJob {
  id: string;
  report_id: string;
  attempt_count: number;
  model_name: string;
}

export function startEmbeddingWorker(logger: FastifyBaseLogger): () => void {
  if (!isEmbeddingEnabled()) return () => {};

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    if (!stopped) timer = setTimeout(runOnce, POLL_INTERVAL_MS);
  };

  const runOnce = async () => {
    try {
      await processOneJob(logger);
    } catch {
      logger.error('AI embedding queue poll failed');
    } finally {
      schedule();
    }
  };

  void runOnce();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function claimJob(): Promise<EmbeddingJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A job whose worker died on its final attempt would otherwise sit in
    // PROCESSING forever, because only handled errors reach the retry cap.
    await client.query(
      `UPDATE report_embeddings
       SET status = 'FAILED',
           error_code = 'WORKER_CRASHED',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE status = 'PROCESSING'
         AND updated_at < NOW() - INTERVAL '10 minutes'
         AND attempt_count >= $1`,
      [MAX_ATTEMPTS],
    );
    // A report's embedding waits for its image classification to settle so the
    // visual evidence can be included; a classification that never ran (row
    // absent, SKIPPED or FAILED) does not hold the embedding back.
    const candidate = await client.query<EmbeddingJob>(
      `SELECT e.id, e.report_id, e.attempt_count, e.model_name
       FROM report_embeddings e
       WHERE (
           (e.status = 'PENDING' AND e.next_attempt_at <= NOW())
           OR (
             e.status = 'PROCESSING'
             AND e.updated_at < NOW() - INTERVAL '10 minutes'
           )
         )
         AND e.attempt_count < $1
         AND NOT EXISTS (
           SELECT 1 FROM report_ai_analyses a
           WHERE a.report_id = e.report_id
             AND a.analysis_type = 'IMAGE_CLASSIFICATION'
             AND a.status IN ('PENDING', 'PROCESSING')
         )
       ORDER BY e.created_at
       LIMIT 1
       FOR UPDATE OF e SKIP LOCKED`,
      [MAX_ATTEMPTS],
    );

    if (candidate.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const job = candidate.rows[0];
    const updated = await client.query(
      `UPDATE report_embeddings
       SET status = 'PROCESSING',
           attempt_count = attempt_count + 1,
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
       WHERE id = $1
       RETURNING attempt_count`,
      [job.id],
    );
    await client.query('COMMIT');

    return { ...job, attempt_count: updated.rows[0].attempt_count };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processOneJob(logger: FastifyBaseLogger): Promise<void> {
  const job = await claimJob();
  if (!job) return;

  try {
    const source = await query<{
      category_label: string;
      description: string | null;
      address: string | null;
      visual_evidence: string | null;
    }>(
      `SELECT c.label AS category_label,
              r.description,
              l.address,
              ai.prediction->>'evidence' AS visual_evidence
       FROM reports r
       JOIN report_categories c ON c.id = r.category_id
       LEFT JOIN locations l ON l.id = r.location_id
       LEFT JOIN report_ai_analyses ai
         ON ai.report_id = r.id
        AND ai.analysis_type = 'IMAGE_CLASSIFICATION'
        AND ai.status = 'COMPLETED'
       WHERE r.id = $1`,
      [job.report_id],
    );
    const row = source.rows[0];
    if (!row) throw new EmbeddingError('REPORT_NOT_FOUND', false);

    const text = buildEmbeddingText({
      categoryLabel: row.category_label,
      description: row.description,
      address: row.address,
      visualEvidence: row.visual_evidence,
    });
    const result = await generateEmbedding({ text, model: job.model_name });

    await query(
      `UPDATE report_embeddings
       SET status = 'COMPLETED',
           model_version = $2,
           input_text = $3,
           embedding = $4::extensions.vector,
           error_code = NULL,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [job.id, result.modelVersion, text, JSON.stringify(result.vector)],
    );
  } catch (error) {
    const code =
      error instanceof EmbeddingError ? error.code : 'EMBEDDING_PROCESSING_FAILED';
    const retryable = !(error instanceof EmbeddingError) || error.retryable;
    const canRetry = retryable && job.attempt_count < MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[job.attempt_count - 1] ?? 0;

    await query(
      `UPDATE report_embeddings
       SET status = $2,
           error_code = $3,
           next_attempt_at = NOW() + ($4 * INTERVAL '1 millisecond'),
           updated_at = NOW(),
           completed_at = CASE WHEN $2 = 'FAILED' THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [job.id, canRetry ? 'PENDING' : 'FAILED', code, delay],
    );
    logger.error(
      { embeddingId: job.id, errorCode: code, retryScheduled: canRetry },
      'AI embedding job failed',
    );
  }
}
