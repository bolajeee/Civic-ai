import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { calculatePriority, isPriorityEnabled, PRIORITY_WEIGHTS, type PriorityInput, type PriorityReport } from '../src/ai/priority';

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });
function report(id = 'r1', citizenId = 'c1', level = 'HIGH'): PriorityReport {
  const scores: Record<string, number> = { LOW: 0.25, MODERATE: 0.5, HIGH: 0.75, CRITICAL: 1 };
  return { id, citizenId, status: 'PENDING', submittedAt: '2026-09-20T12:00:00.000Z',
    severity: { analysisId: 'a-' + id, status: 'COMPLETED', modelVersion: 'm',
      prediction: { level, score: scores[level], confidence: 0.9, threshold: 0.65 } } };
}
function input(changes: Partial<PriorityInput> = {}): PriorityInput {
  return { clusterId: 'cluster', clusterStatus: 'PENDING', calculatedAt: '2026-10-05T12:00:00.000Z',
    reports: [report()], population: { score: 0.8, source: 'Verified population dataset' },
    locationImportance: { score: 1, source: 'Verified essential route designation' }, groupingReviewPending: false, ...changes };
}
test('five fixed weights sum to one and produce a reproducible score', () => {
  assert.ok(Math.abs(Object.values(PRIORITY_WEIGHTS).reduce((a, b) => a + b) - 1) < 1e-9);
  const result = calculatePriority(input());
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.score, 61.5); // 30 severity + 2 volume + 7.5 age + 12 population + 10 importance.
  assert.equal(result.band, 'HIGH');
  assert.deepEqual(result.components.severity, { weight: 0.4, value: 0.75, contribution: 30 });
  assert.equal(result.reviewRequired, false);
});
test('missing context keeps score unavailable and exposes fixed-weight bounds', () => {
  const result = calculatePriority(input({ population: null, locationImportance: null }));
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.score, null);
  assert.equal(result.band, null);
  assert.equal(result.lowerBound, 39.5);
  assert.equal(result.upperBound, 64.5);
  assert.deepEqual(result.missingInputs, ['population', 'locationImportance']);
  assert.equal(result.reviewRequired, true);
});
test('pending, failed, skipped, unsure, malformed and low confidence severity cannot score', () => {
  for (const change of [null, { ...report().severity!, status: 'PENDING' }, { ...report().severity!, status: 'FAILED' },
    { ...report().severity!, status: 'SKIPPED' }, { ...report().severity!, prediction: { level: null, score: null } },
    { ...report().severity!, prediction: { level: 'HIGH', score: 0.75, confidence: 0.4, threshold: 0.65 } },
    { ...report().severity!, prediction: { level: 'HIGH', score: 1, confidence: 0.9, threshold: 0.65 } }]) {
    const result = calculatePriority(input({ reports: [{ ...report(), severity: change }] }));
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.score, null);
    assert.equal(result.components.severity.value, null);
  }
});
test('severity maximum retains supporting references and critical requires review', () => {
  const result = calculatePriority(input({ reports: [report('low', 'a', 'LOW'), report('critical', 'b', 'CRITICAL'),
    { ...report('unknown', 'c'), severity: null }] }));
  assert.equal(result.components.severity.value, 1);
  assert.deepEqual(result.severityReportIds, ['critical']);
  assert.deepEqual(result.unavailableSeverityReportIds, ['unknown']);
  assert.equal(result.reviewRequired, true);
});
test('repeat submissions by the same citizen do not inflate report volume', () => {
  const single = calculatePriority(input());
  const repeated = calculatePriority(input({ reports: [report(), report('r2'), report('r3')] }));
  assert.equal(repeated.activeReportCount, 3);
  assert.equal(repeated.uniqueCitizenCount, 1);
  assert.equal(repeated.score, single.score);
});
test('volume and persistence saturate at ten citizens and thirty days', () => {
  const result = calculatePriority(input({ reports: Array.from({ length: 20 }, (_, i) => ({
    ...report('r' + i, 'c' + i, 'CRITICAL'), submittedAt: '2026-08-01T12:00:00.000Z',
  })), population: { score: 1, source: 'source' } }));
  assert.equal(result.score, 100);
  assert.equal(result.band, 'URGENT');
});
test('resolved and rejected reports do not contribute severity, age or volume', () => {
  const result = calculatePriority(input({ reports: [report(), { ...report('r2', 'c2', 'CRITICAL'), status: 'RESOLVED' },
    { ...report('r3', 'c3', 'CRITICAL'), status: 'REJECTED' }] }));
  assert.equal(result.score, 61.5);
  assert.equal(result.activeReportCount, 1);
});
test('empty and closed clusters have no priority or score bounds', () => {
  for (const changes of [{ reports: [] }, { clusterStatus: 'RESOLVED' }, { clusterStatus: 'REJECTED' }]) {
    const result = calculatePriority(input(changes));
    assert.equal(result.status, 'INACTIVE');
    assert.equal(result.score, null);
    assert.equal(result.lowerBound, null);
    assert.equal(result.upperBound, null);
  }
});
test('invalid dates and unprovenanced context stay missing; explicit zero context is valid', () => {
  for (const submittedAt of ['invalid', '2026-10-06T00:00:00.000Z']) {
    const result = calculatePriority(input({ reports: [{ ...report(), submittedAt }] }));
    assert.equal(result.components.persistence.value, null);
    assert.equal(result.score, null);
  }
  for (const population of [{ score: NaN, source: 'x' }, { score: 2, source: 'x' }, { score: 0.9, source: ' ' }]) {
    assert.equal(calculatePriority(input({ population })).components.population.value, null);
  }
  assert.equal(calculatePriority(input({ population: { score: 0, source: 'Verified no affected residents' } })).score, 49.5);
});
test('pending grouping review is separate from scoring completeness', () => {
  const result = calculatePriority(input({ groupingReviewPending: true }));
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.reviewRequired, true);
});
test('calculation rejects duplicate report inputs and invalid assessment time', () => {
  assert.throws(() => calculatePriority(input({ reports: [report(), report()] })), /DUPLICATE_REPORT_INPUT/);
  assert.throws(() => calculatePriority(input({ calculatedAt: 'bad' })), /INVALID_CALCULATION_TIME/);
});
test('priority flag is independent of model credentials and other AI flags', () => {
  delete process.env.AI_PRIORITY_ENABLED;
  assert.equal(isPriorityEnabled(), false);
  process.env.AI_PRIORITY_ENABLED = ' TRUE ';
  delete process.env.OPENAI_API_KEY;
  assert.equal(isPriorityEnabled(), true);
});
