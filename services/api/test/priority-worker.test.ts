import assert from 'node:assert/strict';
import { after, afterEach, mock, test } from 'node:test';
import { pool } from '../src/db';
import { processOneClusterPriority } from '../src/ai/priority_worker';
afterEach(() => { mock.restoreAll(); });
after(async () => { await pool.end(); });

async function run(options: { empty?: boolean; failure?: boolean; closed?: boolean; completeContext?: boolean } = {}) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let released = false;
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: options.empty ? [] : [{ issue_cluster_id: 'cluster', revision: '2' }] };
      if (sql.includes('FROM issue_clusters ic WHERE')) return { rows: [{ status: options.closed ? 'RESOLVED' : 'PENDING',
        calculated_at: new Date('2026-10-05T12:00:00Z'), grouping_review_pending: false }] };
      if (sql.includes('FROM issue_cluster_reports m JOIN reports')) return { rows: [{ id: 'report', citizen_id: 'citizen',
        status: 'PENDING', submitted_at: new Date('2026-09-20T12:00:00Z'), analysis_id: 'analysis', analysis_status: 'COMPLETED',
        model_version: 'model', prediction: { level: 'HIGH', score: 0.75, confidence: 0.9, threshold: 0.65 } }] };
      if (sql.includes('SELECT * FROM issue_cluster_priority_context')) return { rows: options.completeContext ? [{
        population_score: 0.8, population_source: 'Population source', location_importance_score: 1,
        location_importance_source: 'Essential road', updated_by: 'officer', reason: 'Checked sources',
      }] : [] };
      if (sql.includes('INSERT INTO issue_cluster_priority_calculations')) {
        if (options.failure) throw new Error('write failed');
        return { rows: [{ id: 'calculation' }] };
      }
      return { rows: [] };
    }, release() { released = true; },
  };
  mock.method(pool, 'connect', async () => client);
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('No model call expected'); });
  let error: unknown;
  try { await processOneClusterPriority(); } catch (e) { error = e; }
  assert.equal(released, true);
  assert.equal(fetch.mock.callCount(), 0);
  return { calls, error };
}
test('empty queue commits and concurrent jobs use SKIP LOCKED', async () => {
  const { calls, error } = await run({ empty: true });
  assert.equal(error, undefined);
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
  assert.ok(!calls.some(c => c.sql.includes('INSERT')));
  assert.equal(calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ');
});
test('sourced complete score and its input snapshot commit with current revision', async () => {
  const { calls, error } = await run({ completeContext: true });
  assert.equal(error, undefined);
  const write = calls.find(c => c.sql.includes('INSERT INTO issue_cluster_priority_calculations'))!;
  const input = JSON.parse(String(write.params?.[2]));
  const result = JSON.parse(String(write.params?.[3]));
  assert.equal(input.reports[0].severity.analysisId, 'analysis');
  assert.equal(input.contextRecord.updated_by, 'officer');
  assert.equal(result.score, 61.5);
  assert.equal(result.status, 'COMPLETED');
  const update = calls.find(c => c.sql.includes('SET last_calculation_id'))!;
  assert.deepEqual(update.params, ['cluster', 'calculation', false]);
  assert.match(update.sql, /evaluated_revision = revision/);
  assert.match(update.sql, /INTERVAL '1 hour'/);
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});
test('missing context still stores a reviewable incomplete calculation', async () => {
  const { calls } = await run();
  const write = calls.find(c => c.sql.includes('INSERT INTO issue_cluster_priority_calculations'))!;
  const result = JSON.parse(String(write.params?.[3]));
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.score, null);
});
test('closed clusters become inactive and stop hourly refresh until invalidated', async () => {
  const { calls } = await run({ closed: true });
  assert.equal(calls.find(c => c.sql.includes('SET last_calculation_id'))?.params?.[2], true);
});
test('failed calculation rolls back its snapshot and delays retry without blocking later clusters', async () => {
  const { calls, error } = await run({ failure: true });
  assert.ok(error instanceof Error);
  const rollback = calls.findIndex(c => c.sql === 'ROLLBACK TO SAVEPOINT priority_calculation');
  const failed = calls.findIndex(c => c.sql.includes("error_code = 'PRIORITY_CALCULATION_FAILED'"));
  assert.ok(rollback >= 0 && failed > rollback);
  assert.match(calls[failed].sql, /INTERVAL '2 minutes'/);
  assert.ok(!calls.some(c => c.sql.includes('SET last_calculation_id')));
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});
