import type { FastifyBaseLogger } from 'fastify';
import { pool, query } from '../db';
import { downloadImage } from '../lib/storage';
import {
  generateVisualEmbedding,
  isVisualEmbeddingEnabled,
  VisualEmbeddingError,
} from './visual_embedding';

const POLL_INTERVAL_MS = 3_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [30_000, 120_000];

interface VisualJob {
  id: string;
  storage_key: string;
  media_type: string;
  model_name: string;
  attempt_count: number;
}

export function startVisualEmbeddingWorker(logger: FastifyBaseLogger): () => void {
  if (!isVisualEmbeddingEnabled()) return () => {};
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    try {
      await processOneVisualEmbeddingJob(logger);
    } catch (error) {
      logger.error({ err: error }, 'Visual embedding queue poll failed');
    } finally {
      if (!stopped) timer = setTimeout(run, POLL_INTERVAL_MS);
    }
  };
  void run();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

async function claimJob(): Promise<VisualJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE report_visual_embeddings SET status = 'FAILED',
         error_code = 'WORKER_CRASHED', completed_at = NOW(), updated_at = NOW()
       WHERE status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '10 minutes'
         AND attempt_count >= $1`,
      [MAX_ATTEMPTS],
    );
    const candidate = await client.query<VisualJob>(
      `SELECT e.id, m.storage_key, m.media_type, e.model_name, e.attempt_count
       FROM report_visual_embeddings e
       JOIN report_media m ON m.id = e.media_id
       WHERE ((e.status = 'PENDING' AND e.next_attempt_at <= NOW())
          OR (e.status = 'PROCESSING' AND e.updated_at < NOW() - INTERVAL '10 minutes'))
         AND e.attempt_count < $1
       ORDER BY e.created_at, e.id LIMIT 1
       FOR UPDATE OF e SKIP LOCKED`,
      [MAX_ATTEMPTS],
    );
    if (!candidate.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    const job = candidate.rows[0];
    const updated = await client.query(
      `UPDATE report_visual_embeddings SET status = 'PROCESSING',
         attempt_count = attempt_count + 1, started_at = COALESCE(started_at, NOW()),
         updated_at = NOW() WHERE id = $1 RETURNING attempt_count`,
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

export async function processOneVisualEmbeddingJob(logger: FastifyBaseLogger): Promise<void> {
  const job = await claimJob();
  if (!job) return;
  try {
    const image = await downloadImage(job.storage_key);
    const result = await generateVisualEmbedding({
      image,
      mimeType: job.media_type,
      model: job.model_name,
    });
    await query(
      `UPDATE report_visual_embeddings SET status = 'COMPLETED', model_version = $2,
         embedding = $3::extensions.vector, error_code = NULL,
         completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [job.id, result.modelVersion, JSON.stringify(result.vector)],
    );
  } catch (error) {
    const failure = error instanceof VisualEmbeddingError
      ? error : new VisualEmbeddingError('VISUAL_EMBEDDING_PROCESSING_FAILED', true);
    const retry = failure.retryable && job.attempt_count < MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[job.attempt_count - 1] ?? 0;
    await query(
      `UPDATE report_visual_embeddings SET status = $2, error_code = $3,
         next_attempt_at = NOW() + ($4 * INTERVAL '1 millisecond'), updated_at = NOW(),
         completed_at = CASE WHEN $2::varchar = 'FAILED' THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [job.id, retry ? 'PENDING' : 'FAILED', failure.code, delay],
    );
    logger.error(
      { visualEmbeddingId: job.id, errorCode: failure.code, retryScheduled: retry },
      'Visual embedding job failed',
    );
  }
}
