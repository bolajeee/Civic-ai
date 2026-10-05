import type { FastifyBaseLogger } from 'fastify';
import { query } from '../db';
import {
  classificationModel,
  isClassificationEnabled,
  supportedClassificationImageTypes,
} from './classification';
import { embeddingModel, isEmbeddingEnabled } from './embedding';
import { severityModel, isSeverityEnabled } from './severity';

/**
 * Queues AI work for reports that predate the feature flags.
 *
 * Reports submitted while a flag was off have no job row, so nothing would ever
 * pick them up. Turning the flag on is the explicit consent to the API spend,
 * so the missing rows are created at startup. Idempotent: a report that already
 * has a row is never touched, and a failed API call still leaves the report
 * intact.
 */
export async function backfillAiJobs(logger: FastifyBaseLogger): Promise<void> {
  try {
    if (isClassificationEnabled()) {
      const queued = await enqueueMissingClassifications();
      if (queued > 0) logger.info({ queued }, 'Backfilled classification jobs');
    }
    if (isEmbeddingEnabled()) {
      const queued = await enqueueMissingEmbeddings();
      if (queued > 0) logger.info({ queued }, 'Backfilled embedding jobs');
    }
    if (isSeverityEnabled()) {
      const queued = await enqueueMissingSeverities();
      if (queued > 0) logger.info({ queued }, 'Backfilled severity jobs');
    }
  } catch (error) {
    // The server must still start; the next boot retries the backfill.
    logger.error({ err: error }, 'AI job backfill failed');
  }
}

export async function enqueueMissingSeverities(): Promise<number> {
  const result = await query(
    `INSERT INTO report_ai_analyses
       (report_id, media_id, analysis_type, status, model_name, error_code)
     SELECT r.id, m.id, 'SEVERITY_ESTIMATION',
       CASE WHEN m.media_type = ANY($2::text[]) THEN 'PENDING' ELSE 'SKIPPED' END,
       $1, CASE WHEN m.media_type = ANY($2::text[]) THEN NULL ELSE 'UNSUPPORTED_IMAGE_TYPE' END
     FROM reports r JOIN LATERAL (
       SELECT id, media_type FROM report_media WHERE report_id = r.id
       ORDER BY (media_type = ANY($2::text[])) DESC, display_order, id LIMIT 1
     ) m ON TRUE
     WHERE NOT EXISTS (SELECT 1 FROM report_ai_analyses a
       WHERE a.report_id = r.id AND a.analysis_type = 'SEVERITY_ESTIMATION')
     ON CONFLICT (report_id, analysis_type) DO NOTHING`,
    [severityModel(), supportedClassificationImageTypes()],
  );
  return result.rowCount ?? 0;
}

export async function enqueueMissingClassifications(): Promise<number> {
  // Prefers the first supported photo; a report with only unsupported media is
  // recorded as SKIPPED, matching what the submit path does.
  const result = await query(
    `INSERT INTO report_ai_analyses
       (report_id, media_id, analysis_type, status, model_name, error_code)
     SELECT r.id,
            m.id,
            'IMAGE_CLASSIFICATION',
            CASE WHEN m.media_type = ANY($2::text[]) THEN 'PENDING' ELSE 'SKIPPED' END,
            $1,
            CASE WHEN m.media_type = ANY($2::text[]) THEN NULL
                 ELSE 'UNSUPPORTED_IMAGE_TYPE' END
     FROM reports r
     JOIN LATERAL (
       SELECT id, media_type
       FROM report_media
       WHERE report_id = r.id
       ORDER BY (media_type = ANY($2::text[])) DESC, display_order
       LIMIT 1
     ) m ON TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM report_ai_analyses a
       WHERE a.report_id = r.id AND a.analysis_type = 'IMAGE_CLASSIFICATION'
     )
     ON CONFLICT (report_id, analysis_type) DO NOTHING`,
    [classificationModel(), supportedClassificationImageTypes()],
  );
  return result.rowCount ?? 0;
}

export async function enqueueMissingEmbeddings(): Promise<number> {
  const result = await query(
    `INSERT INTO report_embeddings (report_id, embedding_type, status, model_name)
     SELECT r.id, 'SEMANTIC_TEXT', 'PENDING', $1
     FROM reports r
     WHERE NOT EXISTS (
       SELECT 1 FROM report_embeddings e
       WHERE e.report_id = r.id AND e.embedding_type = 'SEMANTIC_TEXT'
     )
     ON CONFLICT (report_id, embedding_type) DO NOTHING`,
    [embeddingModel()],
  );
  return result.rowCount ?? 0;
}
