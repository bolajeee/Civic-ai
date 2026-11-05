import type { FastifyBaseLogger } from 'fastify';
import { pool } from '../db';
import { duplicateConfig } from './duplicates';
import {
  CLUSTERING_VERSION, clusteringConfig, decideCluster, isClusteringEnabled,
  type ClusterCandidate,
} from './clustering';

const POLL_INTERVAL_MS = 3_000;

export function startClusteringWorker(logger: FastifyBaseLogger): () => void {
  if (!isClusteringEnabled()) return () => {};
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const runOnce = async () => {
    try {
      await processOneClusterReport();
    } catch (err) {
      logger.error({ err }, 'Issue clustering poll failed');
    } finally {
      if (!stopped) timer = setTimeout(runOnce, POLL_INTERVAL_MS);
    }
  };
  void runOnce();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** One short, database-only transaction; restart-safe and serialized across workers. */
export async function processOneClusterReport(): Promise<void> {
  const client = await pool.connect();
  const config = { ...clusteringConfig(), radiusMeters: duplicateConfig().radiusMeters };
  let processingError: unknown;
  try {
    await client.query('BEGIN');
    // A transaction-level lock keeps concurrent workers from creating competing
    // singleton clusters for the same reports. Released even after a crash.
    const lock = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_xact_lock(61005, 1) AS acquired`,
    );
    if (!lock.rows[0]?.acquired) {
      await client.query('COMMIT');
      return;
    }
    const next = await client.query<{
      id: string; category_id: string; location_id: string | null; status: string;
    }>(
      `SELECT r.id, r.category_id, r.location_id, r.status
       FROM reports r JOIN report_duplicate_searches s ON s.report_id = r.id
       WHERE s.status IN ('COMPLETED', 'NO_LOCATION')
         AND NOT EXISTS (SELECT 1 FROM report_cluster_decisions d WHERE d.report_id = r.id)
       ORDER BY r.submitted_at, r.id LIMIT 1 FOR UPDATE OF r`,
    );
    const report = next.rows[0];
    if (!report) {
      await client.query('COMMIT');
      return;
    }

    // A savepoint allows a poison report to get a durable FAILED marker while
    // rolling back its membership, reviews and cluster atomically.
    await client.query('SAVEPOINT cluster_report');
    try {
      const existing = await client.query(
        'SELECT 1 FROM issue_cluster_reports WHERE report_id = $1', [report.id],
      );
      if (!['PENDING', 'IN_PROGRESS'].includes(report.status) || existing.rows.length) {
        await client.query(
          `INSERT INTO report_cluster_decisions (report_id, outcome, clustering_version, config)
           VALUES ($1, 'SKIPPED', $2, $3)`,
          [report.id, CLUSTERING_VERSION, JSON.stringify(config)],
        );
        await client.query('COMMIT');
        return;
      }

      // Only same-category open reports in open clusters are eligible. Compare
      // to the fixed anchor as well as the candidate to bound cluster spread.
      const found = await client.query<{
        cluster_id: string; candidate_report_id: string; score: string; scoring_version: string;
      }>(
        `SELECT m.issue_cluster_id AS cluster_id, d.candidate_report_id,
                d.score, d.scoring_version
         FROM report_duplicate_candidates d
         JOIN reports c ON c.id = d.candidate_report_id
         JOIN issue_cluster_reports m ON m.report_id = c.id
         JOIN issue_clusters ic ON ic.id = m.issue_cluster_id
         JOIN locations anchor ON anchor.id = ic.anchor_location_id
         JOIN locations source ON source.id = $3
         WHERE d.report_id = $1 AND d.category_match
           AND c.category_id = $2 AND ic.category_id = $2
           AND c.status IN ('PENDING', 'IN_PROGRESS')
           AND ic.status IN ('PENDING', 'IN_PROGRESS')
           AND ST_DistanceSphere(anchor.geom, source.geom) <= $4::double precision
         FOR SHARE OF c, ic`,
        [report.id, report.category_id, report.location_id, config.radiusMeters],
      );
      const candidates: ClusterCandidate[] = found.rows.map((row) => ({
        clusterId: row.cluster_id, candidateReportId: row.candidate_report_id,
        score: Number(row.score), scoringVersion: row.scoring_version,
      }));
      const decision = decideCluster(candidates, config);
      let clusterId: string;
      if (decision.outcome === 'ASSIGNED') {
        clusterId = decision.target.clusterId;
      } else {
        const created = await client.query<{ id: string }>(
          `INSERT INTO issue_clusters (category_id, anchor_location_id, status)
           VALUES ($1, $2, $3) RETURNING id`,
          [report.category_id, report.location_id, report.status],
        );
        clusterId = created.rows[0].id;
      }
      await client.query(
        `INSERT INTO issue_cluster_reports (report_id, issue_cluster_id, confidence, assignment_method)
         VALUES ($1, $2, $3, $4)`,
        [report.id, clusterId, decision.outcome === 'ASSIGNED' ? decision.target.score : null,
          decision.outcome === 'ASSIGNED' ? 'AI' : 'SYSTEM'],
      );
      if (decision.outcome === 'REVIEW') {
        for (const candidate of decision.candidates) {
          await client.query(
            `INSERT INTO issue_cluster_review_candidates
               (report_id, issue_cluster_id, candidate_report_id, score, scoring_version, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [report.id, candidate.clusterId, candidate.candidateReportId,
              candidate.score, candidate.scoringVersion, decision.reason],
          );
        }
      }
      await client.query(
        `INSERT INTO report_cluster_decisions
           (report_id, outcome, clustering_version, config, matched_report_id, scoring_version)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [report.id, decision.outcome, CLUSTERING_VERSION, JSON.stringify(config),
          decision.outcome === 'ASSIGNED' ? decision.target.candidateReportId : null,
          decision.outcome === 'ASSIGNED' ? decision.target.scoringVersion : null],
      );
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT cluster_report');
      await client.query(
        `INSERT INTO report_cluster_decisions
           (report_id, outcome, clustering_version, config, error_code)
         VALUES ($1, 'FAILED', $2, $3, 'CLUSTERING_FAILED')`,
        [report.id, CLUSTERING_VERSION, JSON.stringify(config)],
      );
      processingError = error;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (processingError) throw processingError;
}
