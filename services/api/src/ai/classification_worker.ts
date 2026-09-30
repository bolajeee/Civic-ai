import type { FastifyBaseLogger } from 'fastify';
import { pool, query } from '../db';
import { downloadImage } from '../lib/storage';
import {
  ClassificationError,
  classifyReportImage,
  classificationConfidenceThreshold,
  type ClassificationCategory,
  isClassificationEnabled,
} from './classification';

const POLL_INTERVAL_MS = 3_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [30_000, 120_000];

interface ClassificationJob {
  id: string;
  media_id: string;
  storage_key: string;
  media_type: string;
  attempt_count: number;
  model_name: string;
}

export function startClassificationWorker(
  logger: FastifyBaseLogger,
): () => void {
  if (!isClassificationEnabled()) return () => {};

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    if (!stopped) timer = setTimeout(runOnce, POLL_INTERVAL_MS);
  };

  const runOnce = async () => {
    try {
      await processOneJob(logger);
    } catch {
      logger.error('AI classification queue poll failed');
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

async function claimJob(): Promise<ClassificationJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A job whose worker died on its final attempt would otherwise be
    // re-claimed forever, because only handled errors reach the retry cap.
    await client.query(
      `UPDATE report_ai_analyses
       SET status = 'FAILED',
           error_code = 'WORKER_CRASHED',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE analysis_type = 'IMAGE_CLASSIFICATION'
         AND status = 'PROCESSING'
         AND updated_at < NOW() - INTERVAL '10 minutes'
         AND attempt_count >= $1`,
      [MAX_ATTEMPTS],
    );
    const candidate = await client.query<ClassificationJob>(
      `SELECT a.id, a.media_id, m.storage_key, m.media_type,
              a.attempt_count, a.model_name
       FROM report_ai_analyses a
       JOIN report_media m ON m.id = a.media_id
       WHERE a.analysis_type = 'IMAGE_CLASSIFICATION'
         AND (
           (a.status = 'PENDING' AND a.next_attempt_at <= NOW())
           OR (
             a.status = 'PROCESSING'
             AND a.updated_at < NOW() - INTERVAL '10 minutes'
           )
         )
         AND a.attempt_count < $1
       ORDER BY a.created_at
       LIMIT 1
       FOR UPDATE OF a SKIP LOCKED`,
      [MAX_ATTEMPTS],
    );

    if (candidate.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const job = candidate.rows[0];
    const updated = await client.query(
      `UPDATE report_ai_analyses
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
    const [image, categoryRows] = await Promise.all([
      downloadImage(job.storage_key),
      query<ClassificationCategory>(
        `SELECT id, slug, label
         FROM report_categories
         ORDER BY display_order`,
      ),
    ]);
    const classification = await classifyReportImage({
      image,
      mimeType: job.media_type,
      model: job.model_name,
      categories: categoryRows.rows,
    });
    const threshold = classificationConfidenceThreshold();
    const predictedCategory = categoryRows.rows.find(
      (category) => category.slug === classification.categorySlug,
    );
    const predictedCategoryId =
      classification.categorySlug !== 'UNSURE' &&
      classification.confidence >= threshold
        ? (predictedCategory?.id ?? null)
        : null;

    await query(
      `UPDATE report_ai_analyses
       SET status = 'COMPLETED',
           predicted_category_id = $2,
           model_version = $3,
           confidence = $4,
           prediction = $5::jsonb,
           error_code = NULL,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [
        job.id,
        predictedCategoryId,
        classification.modelVersion,
        classification.confidence,
        JSON.stringify(classification),
      ],
    );
  } catch (error) {
    const code =
      error instanceof ClassificationError
        ? error.code
        : 'CLASSIFICATION_PROCESSING_FAILED';
    const retryable =
      !(error instanceof ClassificationError) || error.retryable;
    const canRetry = retryable && job.attempt_count < MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[job.attempt_count - 1] ?? 0;

    await query(
      `UPDATE report_ai_analyses
       SET status = $2,
           error_code = $3,
           next_attempt_at = NOW() + ($4 * INTERVAL '1 millisecond'),
           updated_at = NOW(),
           completed_at = CASE WHEN $2 = 'FAILED' THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [job.id, canRetry ? 'PENDING' : 'FAILED', code, delay],
    );
    logger.error(
      { analysisId: job.id, errorCode: code, retryScheduled: canRetry },
      'AI classification job failed',
    );
  }
}
