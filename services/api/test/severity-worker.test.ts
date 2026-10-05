import assert from 'node:assert/strict';
import { after, afterEach, mock, test } from 'node:test';
import type { FastifyBaseLogger } from 'fastify';

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
const { pool } = await import('../src/db');
const { supabase } = await import('../src/lib/storage');
const { processOneSeverityJob } = await import('../src/ai/severity_worker');
const { enqueueMissingSeverities } = await import('../src/ai/backfill');
const savedEnv = { ...process.env };
const logger = { error() {} } as unknown as FastifyBaseLogger;
afterEach(() => { mock.restoreAll(); process.env = { ...savedEnv }; });
after(async () => { await pool.end(); });

async function run(options: { empty?: boolean; attempt?: number; http?: number; snapshot?: object;
  snapshotLost?: boolean; claimFailure?: boolean } = {}) {
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.AI_SEVERITY_MIN_CONFIDENCE = '0.65';
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let released = false;
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('FOR UPDATE OF a SKIP LOCKED')) {
        if (options.claimFailure) throw new Error('claim failed');
        return { rows: options.empty ? [] : [{ id: 'analysis', report_id: 'report', media_id: 'media',
          storage_key: 'report/photo.jpg', media_type: 'image/jpeg', model_name: 'test-model',
          attempt_count: 0, input_snapshot: options.snapshot ?? null }] };
      }
      if (sql.includes('RETURNING attempt_count')) return { rows: [{ attempt_count: options.attempt ?? 1 }] };
      return { rows: [], rowCount: 1 };
    }, release() { released = true; },
  };
  mock.method(pool, 'connect', async () => client);
  mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('FROM reports r JOIN report_categories')) return { rows: [{
      category_slug: 'POTHOLE', category_label: 'Pothole', description: 'Road blocked',
      latitude: null, longitude: null, accuracy: null, address: null,
    }] };
    return { rows: [], rowCount: options.snapshotLost ? 0 : 1 };
  });
  mock.method(supabase.storage, 'from', () => ({ download: async () => ({ data: new Blob(['photo']), error: null }) }));
  const fetch = mock.method(globalThis, 'fetch', async () => options.http
    ? new Response('{}', { status: options.http })
    : Response.json({ model: 'test-version', choices: [{ message: { content: JSON.stringify({
      level: 'HIGH', confidence: 0.9, visualEvidence: 'Road is damaged.', descriptionEvidence: 'Citizen reports blockage.',
      geographicContext: 'No location supplied.', uncertainty: 'Scale is unclear.',
    }) } }] }));
  let error: unknown;
  try { await processOneSeverityJob(logger); } catch (e) { error = e; }
  assert.equal(released, true);
  return { calls, fetch, error };
}
test('empty queue does no model work; claim failure rolls back and releases', async () => {
  let result = await run({ empty: true });
  assert.equal(result.fetch.mock.callCount(), 0);
  assert.equal(result.calls.at(-1)?.sql, 'COMMIT');
  mock.restoreAll();
  result = await run({ claimFailure: true });
  assert.ok(result.error instanceof Error);
  assert.equal(result.calls.at(-1)?.sql, 'ROLLBACK');
});
test('snapshot is persisted before inference and missing GPS does not block severity', async () => {
  const { calls, error } = await run();
  assert.equal(error, undefined);
  const snapshotWrite = calls.findIndex(c => c.sql.includes('SET input_snapshot'));
  const resultWrite = calls.findIndex(c => c.sql.includes("SET status = 'COMPLETED'"));
  assert.ok(snapshotWrite >= 0 && resultWrite > snapshotWrite);
  const snapshot = JSON.parse(String(calls[snapshotWrite].params?.[1]));
  assert.equal(snapshot.location, null);
  assert.equal(snapshot.description, 'Road blocked');
  assert.equal(snapshot.mediaId, 'media');
  const result = JSON.parse(String(calls[resultWrite].params?.[3]));
  assert.equal(result.score, 0.75);
  assert.equal(result.rubricVersion, snapshot.rubricVersion);
  assert.deepEqual(calls[resultWrite].params?.slice(0, 3), ['analysis', 'test-version', 0.9]);
  assert.match(calls[resultWrite].sql, /attempt_count = \$5/);
});
test('retry uses original snapshot and threshold instead of changed report/configuration', async () => {
  const snapshot = { category: { slug: 'POTHOLE', label: 'Pothole' }, description: 'Original description', location: null,
    mediaId: 'media', storageKey: 'original.jpg', mimeType: 'image/jpeg', threshold: 0.95, rubricVersion: 'civic-severity-v1' };
  const { calls, fetch } = await run({ snapshot, attempt: 2 });
  assert.ok(!calls.some(c => c.sql.includes('FROM reports r JOIN report_categories')));
  const body = JSON.parse(String(fetch.mock.calls[0].arguments[1]?.body));
  assert.equal(JSON.parse(body.messages[1].content[0].text).description, 'Original description');
  const result = JSON.parse(String(calls.find(c => c.sql.includes("SET status = 'COMPLETED'"))?.params?.[3]));
  assert.equal(result.level, null);
  assert.equal(result.threshold, 0.95);
});
test('lost snapshot claim stops before inference', async () => {
  const { fetch, calls } = await run({ snapshotLost: true });
  assert.equal(fetch.mock.callCount(), 0);
  assert.ok(!calls.some(c => c.sql.includes("SET status = 'COMPLETED'")));
});
test('transient failures retry up to three attempts, permanent failures end immediately', async () => {
  for (const [http, attempt, status, delay] of [[429, 1, 'PENDING', 30_000], [503, 2, 'PENDING', 120_000],
    [503, 3, 'FAILED', 0], [401, 1, 'FAILED', 30_000]] as const) {
    const { calls } = await run({ http, attempt });
    const failed = calls.find(c => c.sql.includes('next_attempt_at = NOW() +'));
    assert.deepEqual(failed?.params, ['analysis', status, 'OPENAI_HTTP_' + http, delay, attempt]);
    assert.match(failed!.sql, /attempt_count = \$5/);
    const reclaim = calls.find(c => c.sql.includes('FOR UPDATE OF a SKIP LOCKED'));
    assert.match(reclaim!.sql, /attempt_count < \$1/);
    assert.ok(calls.some(c => c.sql.includes("error_code = 'WORKER_CRASHED'")));
    mock.restoreAll();
  }
});
test('backfill selects supported media and preserves existing analysis jobs', async () => {
  const query = mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    assert.match(sql, /ON CONFLICT \(report_id, analysis_type\) DO NOTHING/);
    assert.match(sql, /'SEVERITY_ESTIMATION'/);
    assert.match(sql, /'SKIPPED'/);
    assert.match(sql, /ORDER BY \(media_type = ANY/);
    assert.ok((params[1] as string[]).includes('image/jpeg'));
    assert.ok(!(params[1] as string[]).includes('image/heic'));
    return { rows: [], rowCount: 2 };
  });
  assert.equal(await enqueueMissingSeverities(), 2);
  assert.equal(query.mock.callCount(), 1);
});
