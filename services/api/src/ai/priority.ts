export const PRIORITY_VERSION = 'weighted-cluster-v1';
export const PRIORITY_WEIGHTS = { severity: 0.4, volume: 0.2, persistence: 0.15, population: 0.15, locationImportance: 0.1 } as const;
export const PRIORITY_CONFIG = { volumeSaturation: 10, persistenceSaturationDays: 30 } as const;
export function isPriorityEnabled(): boolean {
  return process.env.AI_PRIORITY_ENABLED?.trim().toLowerCase() === 'true';
}
export interface PriorityReport {
  id: string; citizenId: string; status: string; submittedAt: string;
  severity: { analysisId: string; status: string; prediction: unknown; modelVersion: string | null } | null;
}
export interface PriorityContextValue { score: number; source: string }
export interface PriorityInput {
  clusterId: string; clusterStatus: string; reports: PriorityReport[];
  population: PriorityContextValue | null; locationImportance: PriorityContextValue | null;
  groupingReviewPending: boolean; calculatedAt: string;
}
const levels = { LOW: 0.25, MODERATE: 0.5, HIGH: 0.75, CRITICAL: 1 } as const;
function acceptedSeverity(report: PriorityReport): { score: number; review: boolean } | null {
  const analysis = report.severity;
  if (analysis?.status !== 'COMPLETED' || !analysis.prediction || typeof analysis.prediction !== 'object') return null;
  const p = analysis.prediction as Record<string, unknown>;
  if (typeof p.level !== 'string' || !Object.hasOwn(levels, p.level)) return null;
  const score = levels[p.level as keyof typeof levels];
  if (p.score !== score || typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) ||
      p.confidence < 0 || p.confidence > 1 || typeof p.threshold !== 'number' ||
      !Number.isFinite(p.threshold) || p.threshold < 0 || p.threshold > 1 || p.confidence < p.threshold) return null;
  return { score, review: p.reviewRequired === true || p.level === 'CRITICAL' };
}
function contextScore(value: PriorityContextValue | null): number | null {
  return value && Number.isFinite(value.score) && value.score >= 0 && value.score <= 1 && value.source.trim()
    ? value.score : null;
}
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Fixed weights: unknown inputs stay unknown and are never silently reweighted. */
export function calculatePriority(input: PriorityInput) {
  const now = Date.parse(input.calculatedAt);
  if (!Number.isFinite(now)) throw new Error('INVALID_CALCULATION_TIME');
  if (new Set(input.reports.map(r => r.id)).size !== input.reports.length) throw new Error('DUPLICATE_REPORT_INPUT');
  const active = input.reports.filter(r => ['PENDING', 'IN_PROGRESS'].includes(r.status));
  const severities = active.map(report => ({ reportId: report.id, result: acceptedSeverity(report) }));
  const accepted = severities.filter(s => s.result !== null);
  // Maximum preserves a credible serious observation instead of averaging it away.
  const severity = accepted.length ? Math.max(...accepted.map(s => s.result!.score)) : null;
  const uniqueCitizens = new Set(active.map(r => r.citizenId)).size;
  const volume = active.length ? Math.min(1, uniqueCitizens / PRIORITY_CONFIG.volumeSaturation) : null;
  const dates = active.map(r => Date.parse(r.submittedAt));
  const validDates = dates.length > 0 && dates.every(d => Number.isFinite(d) && d <= now);
  const ageDays = validDates ? (now - Math.min(...dates)) / 86_400_000 : null;
  const persistence = ageDays === null ? null : Math.min(1, ageDays / PRIORITY_CONFIG.persistenceSaturationDays);
  const values = { severity, volume, persistence, population: contextScore(input.population),
    locationImportance: contextScore(input.locationImportance) };
  const components = Object.fromEntries(Object.entries(PRIORITY_WEIGHTS).map(([name, weight]) => {
    const value = values[name as keyof typeof values];
    return [name, { weight, value: value === null ? null : round(value), contribution: value === null ? null : round(value * weight * 100) }];
  }));
  const missingInputs = (Object.keys(values) as Array<keyof typeof values>).filter(key => values[key] === null);
  const lower = Object.entries(PRIORITY_WEIGHTS).reduce((sum, [key, weight]) => sum + (values[key as keyof typeof values] ?? 0) * weight * 100, 0);
  const upper = lower + missingInputs.reduce((sum, key) => sum + PRIORITY_WEIGHTS[key] * 100, 0);
  const inactive = !['PENDING', 'IN_PROGRESS'].includes(input.clusterStatus) || active.length === 0;
  const status = inactive ? 'INACTIVE' : severity === null ? 'UNAVAILABLE' : missingInputs.length ? 'INCOMPLETE' : 'COMPLETED';
  const score = status === 'COMPLETED' ? round(lower) : null;
  const band = score === null ? null : score >= 75 ? 'URGENT' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
  const unavailableSeverityReportIds = severities.filter(s => !s.result).map(s => s.reportId);
  return { status, score, band, lowerBound: inactive ? null : round(lower), upperBound: inactive ? null : round(upper),
    components, missingInputs, reviewRequired: !inactive && (missingInputs.length > 0 || input.groupingReviewPending ||
      unavailableSeverityReportIds.length > 0 || accepted.some(s => s.result!.review)),
    severityAggregation: 'MAX_ACCEPTED', severityReportIds: accepted.filter(s => s.result!.score === severity).map(s => s.reportId),
    unavailableSeverityReportIds, activeReportCount: active.length, uniqueCitizenCount: uniqueCitizens,
    ageDays: ageDays === null ? null : round(ageDays), version: PRIORITY_VERSION, config: PRIORITY_CONFIG,
    calculatedAt: input.calculatedAt };
}
