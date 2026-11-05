export const CLUSTERING_VERSION = 'anchor-category-v1';

export interface ClusteringConfig {
  autoMinScore: number;
  ambiguityMargin: number;
}

export interface ClusterCandidate {
  clusterId: string;
  candidateReportId: string;
  score: number;
  scoringVersion: string;
}

export function isClusteringEnabled(): boolean {
  return process.env.AI_CLUSTERING_ENABLED?.trim().toLowerCase() === 'true';
}

function threshold(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

export function clusteringConfig(): ClusteringConfig {
  return {
    autoMinScore: threshold('AI_CLUSTER_AUTO_MIN_SCORE', 0.85),
    ambiguityMargin: threshold('AI_CLUSTER_AMBIGUITY_MARGIN', 0.05),
  };
}

/** Compare distinct clusters, so two strong reports in one cluster are not ambiguous. */
export function decideCluster(candidates: ClusterCandidate[], config: ClusteringConfig) {
  const ranked = candidates
    .filter((c) => Number.isFinite(c.score) && c.score >= 0 && c.score <= 1)
    .sort((a, b) => b.score - a.score || a.clusterId.localeCompare(b.clusterId)
      || a.candidateReportId.localeCompare(b.candidateReportId));
  const distinct = ranked.filter((c, i) => ranked.findIndex((other) => other.clusterId === c.clusterId) === i);
  const best = distinct[0];
  if (!best) return { outcome: 'SINGLETON' as const, candidates: distinct };
  const ambiguous = distinct[1] && best.score - distinct[1].score <= config.ambiguityMargin + 1e-9;
  if (best.score < config.autoMinScore || ambiguous) {
    return {
      outcome: 'REVIEW' as const,
      reason: ambiguous ? 'AMBIGUOUS_MATCH' : 'LOW_SCORE',
      candidates: distinct,
    };
  }
  return { outcome: 'ASSIGNED' as const, target: best, candidates: distinct };
}
