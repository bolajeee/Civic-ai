export interface ImpactScoreCounts {
  total: number;
  inProgress: number;
  resolved: number;
  rejected: number;
}

/** A reproducible 0-100 citizen impact score based on report outcomes. */
export function calculateImpactScore(counts: ImpactScoreCounts): number {
  const accepted = Math.max(0, counts.total - counts.rejected);
  if (accepted === 0) return 0;

  // 30% contribution, 20% government engagement, 50% resolution.
  const contribution = Math.min(accepted, 10) * 3;
  const actedOn = Math.min(accepted, counts.inProgress + counts.resolved);
  const engagement = (actedOn / accepted) * 20;
  const resolution = (Math.min(accepted, counts.resolved) / accepted) * 50;
  return Math.max(0, Math.min(100, Math.round(contribution + engagement + resolution)));
}
