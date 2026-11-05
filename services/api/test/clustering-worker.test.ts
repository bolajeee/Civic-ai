import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test, mock } from 'node:test';
import { pool } from '../src/db';
import { processOneClusterReport } from '../src/ai/clustering_worker';

after(async () => { await pool.end(); });
const savedEnv = { ...process.env };
beforeEach(() => {
  process.env.AI_CLUSTER_AUTO_MIN_SCORE = '0.85';
  process.env.AI_CLUSTER_AMBIGUITY_MARGIN = '0.05';
  process.env.AI_DUPLICATE_RADIUS_METERS = '200';
});
afterEach(() => { process.env = { ...savedEnv }; });

async function run(options: {
  locked?: boolean; empty?: boolean; existing?: boolean; closed?: boolean;
  score?: number; failMembership?: boolean;
} = {}) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let released = false;
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('pg_try_advisory')) return { rows: [{ acquired: !options.locked }] };
      if (sql.includes('FROM reports r JOIN report_duplicate_searches')) return { rows: options.empty ? [] : [{
        id: 'report', category_id: 'category', location_id: 'location', status: options.closed ? 'RESOLVED' : 'PENDING',
      }] };
      if (sql.startsWith('SELECT 1 FROM issue_cluster_reports')) return { rows: options.existing ? [{}] : [] };
      if (sql.includes('FROM report_duplicate_candidates')) return { rows: options.score === undefined ? [] : [{
        cluster_id: 'target', candidate_report_id: 'older', score: String(options.score), scoring_version: 'score-v1',
      }] };
      if (sql.includes('INSERT INTO issue_clusters')) return { rows: [{ id: 'singleton' }] };
      if (sql.includes('INSERT INTO issue_cluster_reports') && options.failMembership) throw new Error('insert failure');
      return { rows: [] };
    },
    release() { released = true; },
  };
  const connect = mock.method(pool, 'connect', async () => client);
  let error: unknown;
  try { await processOneClusterReport(); } catch (err) { error = err; }
  finally { connect.mock.restore(); }
  assert.equal(released, true);
  return { calls, error };
}

test('a busy lock or empty queue commits without any writes', async () => {
  for (const options of [{ locked: true }, { empty: true }]) {
    const { calls, error } = await run(options);
    assert.equal(error, undefined);
    assert.equal(calls.at(-1)?.sql, 'COMMIT');
    assert.ok(!calls.some((c) => c.sql.includes('INSERT')));
  }
});

test('singleton membership and decision commit together', async () => {
  const { calls, error } = await run();
  assert.equal(error, undefined);
  assert.deepEqual(calls.find((c) => c.sql.includes('INSERT INTO issue_cluster_reports'))?.params,
    ['report', 'singleton', null, 'SYSTEM']);
  assert.equal(calls.find((c) => c.sql.includes('INSERT INTO report_cluster_decisions'))?.params?.[1], 'SINGLETON');
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});

test('strong candidates attach without creating a second cluster', async () => {
  const { calls, error } = await run({ score: 0.98 });
  assert.equal(error, undefined);
  assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO issue_clusters')));
  assert.deepEqual(calls.find((c) => c.sql.includes('INSERT INTO issue_cluster_reports'))?.params,
    ['report', 'target', 0.98, 'AI']);
  const decision = calls.find((c) => c.sql.includes('INSERT INTO report_cluster_decisions'));
  assert.deepEqual(decision?.params?.slice(4), ['older', 'score-v1']);
});

test('weak matches create a singleton plus durable review evidence', async () => {
  const { calls, error } = await run({ score: 0.7 });
  assert.equal(error, undefined);
  assert.deepEqual(calls.find((c) => c.sql.includes('INSERT INTO issue_cluster_review_candidates'))?.params,
    ['report', 'target', 'older', 0.7, 'score-v1', 'LOW_SCORE']);
  assert.equal(calls.find((c) => c.sql.includes('INSERT INTO report_cluster_decisions'))?.params?.[1], 'REVIEW');
});

test('closed reports and pre-existing human memberships are skipped', async () => {
  for (const options of [{ closed: true }, { existing: true }]) {
    const { calls, error } = await run(options);
    assert.equal(error, undefined);
    assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO issue_cluster_reports')));
    assert.ok(calls.some((c) => c.sql.includes("VALUES ($1, 'SKIPPED'")));
  }
});

test('failed membership rolls back cluster changes and persists a failure marker', async () => {
  const { calls, error } = await run({ failMembership: true });
  assert.ok(error instanceof Error);
  const rollback = calls.findIndex((c) => c.sql === 'ROLLBACK TO SAVEPOINT cluster_report');
  const failed = calls.findIndex((c) => c.sql.includes("VALUES ($1, 'FAILED'"));
  assert.ok(rollback >= 0 && failed > rollback);
  assert.equal(calls[failed + 1].sql, 'COMMIT');
});
