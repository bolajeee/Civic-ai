import type { FastifyBaseLogger } from 'fastify';
import { pool, query } from '../db';
import {
  DUPLICATE_SCORING_VERSION,
  duplicateConfig,
  isDuplicateDetectionEnabled,
  rankDuplicateCandidates,
} from './duplicates';

const POLL_INTERVAL_MS = 3_000;
const CANDIDATE_POOL = 50;
// Expanding the bounding box by degrees keeps the GiST index usable. One degree
// of latitude is ~111 km; the 1.5 margin covers longitude shrinking with
// latitude, so the exact sphere distance below is the real filter.
const METERS_PER_DEGREE = 111_320;
const BBOX_MARGIN = 1.5;

export function startDuplicateWorker(logger: FastifyBaseLogger): () => void {
  if (!isDuplicateDetectionEnabled()) return () => {};

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    if (!stopped) timer = setTimeout(runOnce, POLL_INTERVAL_MS);
  };

  const runOnce = async () => {
    try {
      await processOneReport(logger);
    } catch {
      logger.error('Duplicate search poll failed');
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

/** The oldest report with a finished embedding and no search yet. */
async function nextReportId(): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT r.id
     FROM reports r
     JOIN report_embeddings e
       ON e.report_id = r.id
      AND e.embedding_type = 'SEMANTIC_TEXT'
      AND e.status = 'COMPLETED'
     WHERE NOT EXISTS (
       SELECT 1 FROM report_duplicate_searches s WHERE s.report_id = r.id
     )
     ORDER BY r.submitted_at, r.id
     LIMIT 1`,
  );
  return result.rows[0]?.id ?? null;
}

async function processOneReport(logger: FastifyBaseLogger): Promise<void> {
  const reportId = await nextReportId();
  if (!reportId) return;

  try {
    await searchDuplicates(reportId);
  } catch (error) {
    // Recorded outside the rolled-back transaction, so one poison report cannot
    // block the reports behind it.
    await query(
      `INSERT INTO report_duplicate_searches
         (report_id, status, scoring_version, error_code)
       VALUES ($1, 'FAILED', $2, 'DUPLICATE_SEARCH_FAILED')
       ON CONFLICT (report_id) DO NOTHING`,
      [reportId, DUPLICATE_SCORING_VERSION],
    );
    logger.error({ err: error, reportId }, 'Duplicate search failed');
  }
}

async function searchDuplicates(reportId: string): Promise<void> {
  const config = duplicateConfig();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The marker is inserted first: a concurrent worker blocks on the primary
    // key until this commits, then finds the row and does nothing.
    const location = await client.query<{ has_location: boolean }>(
      `SELECT (r.location_id IS NOT NULL) AS has_location
       FROM reports r WHERE r.id = $1`,
      [reportId],
    );
    const hasLocation = location.rows[0]?.has_location ?? false;
    const marker = await client.query(
      `INSERT INTO report_duplicate_searches
         (report_id, status, scoring_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (report_id) DO NOTHING
       RETURNING report_id`,
      [
        reportId,
        hasLocation ? 'COMPLETED' : 'NO_LOCATION',
        DUPLICATE_SCORING_VERSION,
      ],
    );
    if (marker.rowCount === 0 || !hasLocation) {
      await client.query('COMMIT');
      return;
    }

    // Only earlier reports are candidates, so each pair is found once, by the
    // newer report. Closed reports are excluded: a fresh report near a
    // resolved one is more likely a recurrence than a duplicate.
    const found = await client.query<{
      candidate_id: string;
      distance_meters: number;
      semantic_similarity: number;
      category_match: boolean;
    }>(
      `SELECT c.id AS candidate_id,
              ST_DistanceSphere(cl.geom, rl.geom) AS distance_meters,
              1 - (ce.embedding <=> re.embedding) AS semantic_similarity,
              (c.category_id = r.category_id) AS category_match
       FROM reports r
       JOIN locations rl ON rl.id = r.location_id
       JOIN report_embeddings re
         ON re.report_id = r.id
        AND re.embedding_type = 'SEMANTIC_TEXT'
        AND re.status = 'COMPLETED'
       JOIN reports c
         ON c.id <> r.id
        AND c.status IN ('PENDING', 'IN_PROGRESS')
        AND (c.submitted_at, c.id) < (r.submitted_at, r.id)
       JOIN locations cl
         ON cl.id = c.location_id
        AND cl.geom && ST_Expand(rl.geom, $3::double precision)
       JOIN report_embeddings ce
         ON ce.report_id = c.id
        AND ce.embedding_type = 'SEMANTIC_TEXT'
        AND ce.status = 'COMPLETED'
       WHERE r.id = $1
         AND ST_DistanceSphere(cl.geom, rl.geom) <= $2::double precision
       ORDER BY ce.embedding <=> re.embedding
       LIMIT ${CANDIDATE_POOL}`,
      [
        reportId,
        config.radiusMeters,
        (config.radiusMeters / METERS_PER_DEGREE) * BBOX_MARGIN,
      ],
    );

    const ranked = rankDuplicateCandidates(
      found.rows.map((row) => ({
        candidateId: row.candidate_id,
        distanceMeters: Number(row.distance_meters),
        semanticSimilarity: Number(row.semantic_similarity),
        categoryMatch: row.category_match,
      })),
      config,
    );

    for (const candidate of ranked) {
      await client.query(
        `INSERT INTO report_duplicate_candidates
           (report_id, candidate_report_id, distance_meters,
            semantic_similarity, category_match, score, scoring_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (report_id, candidate_report_id) DO NOTHING`,
        [
          reportId,
          candidate.candidateId,
          candidate.distanceMeters,
          candidate.semanticSimilarity,
          candidate.categoryMatch,
          candidate.score.toFixed(4),
          DUPLICATE_SCORING_VERSION,
        ],
      );
    }
    await client.query(
      `UPDATE report_duplicate_searches SET candidate_count = $2
       WHERE report_id = $1`,
      [reportId, ranked.length],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
