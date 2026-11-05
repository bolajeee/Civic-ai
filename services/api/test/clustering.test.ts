import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { clusteringConfig, decideCluster, isClusteringEnabled } from '../src/ai/clustering';

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });
const config = { autoMinScore: 0.85, ambiguityMargin: 0.05 };
const candidate = (clusterId: string, score: number, candidateReportId = clusterId) => ({
  clusterId, candidateReportId, score, scoringVersion: 'test-v1',
});

test('no eligible candidates gives a singleton; invalid scores cannot assign', () => {
  assert.equal(decideCluster([], config).outcome, 'SINGLETON');
  assert.equal(decideCluster([candidate('a', NaN), candidate('b', 2)], config).outcome, 'SINGLETON');
});

test('a strong match joins the best cluster, including at the threshold', () => {
  const result = decideCluster([candidate('a', 0.65), candidate('b', 0.85)], config);
  assert.equal(result.outcome, 'ASSIGNED');
  if (result.outcome === 'ASSIGNED') assert.equal(result.target.clusterId, 'b');
});

test('weak matches keep the report separate for review', () => {
  const result = decideCluster([candidate('a', 0.84)], config);
  assert.equal(result.outcome, 'REVIEW');
  if (result.outcome === 'REVIEW') assert.equal(result.reason, 'LOW_SCORE');
});

test('close competing clusters require review even with a high top score', () => {
  for (const second of [0.9, 0.87, 0.85]) {
    const result = decideCluster([candidate('a', 0.9), candidate('b', second)], config);
    assert.equal(result.outcome, 'REVIEW');
    if (result.outcome === 'REVIEW') assert.equal(result.reason, 'AMBIGUOUS_MATCH');
  }
});

test('multiple supporting reports in one cluster do not create ambiguity', () => {
  const result = decideCluster([
    candidate('a', 0.91, 'r2'), candidate('a', 0.95, 'r1'), candidate('b', 0.7),
  ], config);
  assert.equal(result.outcome, 'ASSIGNED');
  if (result.outcome === 'ASSIGNED') assert.equal(result.target.candidateReportId, 'r1');
  assert.equal(result.candidates.length, 2);
});

test('tied scores have deterministic ordering', () => {
  const result = decideCluster([candidate('z', 0.9), candidate('a', 0.9)], config);
  assert.deepEqual(result.candidates.map((c) => c.clusterId), ['a', 'z']);
});

test('clustering is opt-in and invalid config uses safe defaults', () => {
  delete process.env.AI_CLUSTERING_ENABLED;
  assert.equal(isClusteringEnabled(), false);
  process.env.AI_CLUSTERING_ENABLED = ' TRUE ';
  assert.equal(isClusteringEnabled(), true);
  process.env.AI_CLUSTER_AUTO_MIN_SCORE = '-1';
  process.env.AI_CLUSTER_AMBIGUITY_MARGIN = 'garbage';
  assert.deepEqual(clusteringConfig(), config);
  process.env.AI_CLUSTER_AUTO_MIN_SCORE = '0.95';
  process.env.AI_CLUSTER_AMBIGUITY_MARGIN = '0.1';
  assert.deepEqual(clusteringConfig(), { autoMinScore: 0.95, ambiguityMargin: 0.1 });
});
