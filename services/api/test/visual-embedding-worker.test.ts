import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, mock, test } from 'node:test';
import type { FastifyBaseLogger } from 'fastify';

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
const { pool } = await import('../src/db');
const { supabase } = await import('../src/lib/storage');
const { enqueueMissingVisualEmbeddings } = await import('../src/ai/backfill');
const { processOneVisualEmbeddingJob } = await import('../src/ai/visual_embedding_worker');
const { VISUAL_EMBEDDING_DIMENSIONS } = await import('../src/ai/visual_embedding');
const savedEnv = { ...process.env };
const logger = { error() {} } as unknown as FastifyBaseLogger;
afterEach(() => { mock.restoreAll(); process.env = { ...savedEnv }; });
after(async () => { await pool.end(); });

test('worker claims, downloads, embeds, and completes one media job', async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('FOR UPDATE OF e SKIP LOCKED')) return { rows: [{
        id: 'visual', storage_key: 'report/photo.jpg', media_type: 'image/png',
        model_name: 'multimodalembedding@001', attempt_count: 0,
      }] };
      if (sql.includes('RETURNING attempt_count')) return { rows: [{ attempt_count: 1 }] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  mock.method(pool, 'connect', async () => client);
  mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 1 };
  });
  mock.method(supabase.storage, 'from', () => ({
    download: async () => ({ data: new Blob(['photo']), error: null }),
  }));
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.VERTEX_AI_PROJECT_ID = 'project';
  process.env.VERTEX_AI_CLIENT_EMAIL = 'worker@example.test';
  process.env.VERTEX_AI_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
    String(url).includes('oauth2.googleapis.com')
      ? Response.json({ access_token: 'token', expires_in: 3600 })
      : Response.json({ predictions: [{
          imageEmbedding: new Array(VISUAL_EMBEDDING_DIMENSIONS).fill(0.1),
        }] }));

  await processOneVisualEmbeddingJob(logger);
  const completed = calls.find((call) => call.sql.includes("SET status = 'COMPLETED'"));
  assert.ok(completed);
  assert.equal(JSON.parse(String(completed.params?.[2])).length, VISUAL_EMBEDDING_DIMENSIONS);
  assert.ok(calls.some((call) => call.sql.includes("error_code = 'WORKER_CRASHED'")));
});

test('backfill records supported and skipped media without replacing existing jobs', async () => {
  const query = mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    assert.match(sql, /INSERT INTO report_visual_embeddings/);
    assert.match(sql, /'SKIPPED'/);
    assert.match(sql, /ON CONFLICT \(media_id\) DO NOTHING/);
    assert.deepEqual(params[1], ['image/jpeg', 'image/png']);
    return { rows: [], rowCount: 4 };
  });
  assert.equal(await enqueueMissingVisualEmbeddings(), 4);
  assert.equal(query.mock.callCount(), 1);
});
