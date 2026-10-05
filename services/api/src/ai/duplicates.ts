/** Bump when weights or inputs change, so stored scores stay explainable. */
export const DUPLICATE_SCORING_VERSION = 'geo-semantic-category-v1';

// Visual similarity is part of the target formula (docs/ai_strategy.md) but has
// no image embeddings yet, so its weight is spread over the other terms.
const WEIGHTS = { geo: 0.4, semantic: 0.4, category: 0.2 };
const MAX_CANDIDATES = 5;

export interface DuplicateSignals {
  distanceMeters: number;
  semanticSimilarity: number;
  categoryMatch: boolean;
}

export interface DuplicateConfig {
  radiusMeters: number;
  minScore: number;
}

export function isDuplicateDetectionEnabled(): boolean {
  return (
    process.env.AI_DUPLICATE_DETECTION_ENABLED?.trim().toLowerCase() === 'true'
  );
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function duplicateConfig(): DuplicateConfig {
  const radius = numberFromEnv('AI_DUPLICATE_RADIUS_METERS', 200);
  const minScore = numberFromEnv('AI_DUPLICATE_MIN_SCORE', 0.6);
  return {
    radiusMeters: radius > 0 ? radius : 200,
    minScore: Math.min(1, Math.max(0, minScore)),
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Transparent weighted score in 0–1: nearer, more similar, same-category
 * reports score higher. Distance falls off linearly to zero at the radius.
 */
export function duplicateScore(
  signals: DuplicateSignals,
  radiusMeters: number,
): number {
  const geo = clamp01(1 - signals.distanceMeters / radiusMeters);
  const semantic = clamp01(signals.semanticSimilarity);
  const category = signals.categoryMatch ? 1 : 0;
  return (
    WEIGHTS.geo * geo + WEIGHTS.semantic * semantic + WEIGHTS.category * category
  );
}

/** Scores, thresholds and ranks candidates; the best MAX_CANDIDATES remain. */
export function rankDuplicateCandidates<T extends DuplicateSignals>(
  candidates: T[],
  config: DuplicateConfig,
): Array<T & { score: number }> {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: duplicateScore(candidate, config.radiusMeters),
    }))
    .filter((candidate) => candidate.score >= config.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
}
