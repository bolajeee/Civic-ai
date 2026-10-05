import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import authenticatePlugin from '../src/plugins/authenticate';

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
const { default: reportRoutes } = await import('../src/routes/reports');
const { pool } = await import('../src/db');
const { supabase } = await import('../src/lib/storage');
const savedEnv = { ...process.env };
const citizen = '11111111-1111-4111-8111-111111111111';
const category = '22222222-2222-4222-8222-222222222222';
const app = Fastify();
before(async () => {
  await app.register(fastifyJwt, { secret: 'severity-test-secret' });
  await app.register(multipart);
  await app.register(authenticatePlugin);
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.ready();
});
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.AI_SEVERITY_ENABLED = 'true';
  process.env.AI_CLASSIFICATION_ENABLED = 'false';
  process.env.AI_EMBEDDINGS_ENABLED = 'false';
});
afterEach(() => { mock.restoreAll(); process.env = { ...savedEnv }; });
after(async () => { await app.close(); await pool.end(); });
function auth() { return { authorization: 'Bearer ' + app.jwt.sign({ id: citizen, role: 'CITIZEN' }) }; }
function form(types: string[]) {
  const boundary = 'severity-boundary';
  const fields = `--${boundary}\r\nContent-Disposition: form-data; name="categoryId"\r\n\r\n${category}\r\n`;
  const files = types.map((type, i) => `--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="${i}.photo"\r\nContent-Type: ${type}\r\n\r\nphoto\r\n`).join('');
  return { method: 'POST' as const, url: '/api/reports',
    headers: { ...auth(), 'content-type': 'multipart/form-data; boundary=' + boundary },
    payload: Buffer.from(fields + files + `--${boundary}--\r\n`) };
}
function submissionDatabase(failJob = false) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let media = 0;
  const removed: string[][] = [];
  mock.method(pool, 'query', async () => ({ rows: [{ id: category }] }));
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO reports')) return { rows: [{ id: 'report', public_id: 'CR-1', status: 'PENDING', submitted_at: new Date() }] };
      if (sql.includes('INSERT INTO report_media')) return { rows: [{ id: 'media-' + media++ }] };
      if (sql.includes("'SEVERITY_ESTIMATION'") && failJob) throw new Error('Queue insertion failed');
      return { rows: [] };
    }, release() {},
  };
  mock.method(pool, 'connect', async () => client);
  mock.method(supabase.storage, 'from', () => ({
    upload: async () => ({ data: {}, error: null }),
    remove: async (keys: string[]) => { removed.push(keys); return { error: null }; },
  }));
  return { calls, removed };
}
test('submission queues severity on the first supported photo without classification', async () => {
  const { calls } = submissionDatabase();
  const response = await app.inject(form(['image/heic', 'image/jpeg']));
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().report.aiSeverityStatus, 'pending');
  assert.equal(response.json().report.aiClassificationStatus, 'disabled');
  const jobIndex = calls.findIndex(c => c.sql.includes("'SEVERITY_ESTIMATION'"));
  assert.equal(calls[jobIndex].params?.[1], 'media-1');
  assert.equal(calls[jobIndex].params?.[2], 'PENDING');
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});
test('unsupported-only photos create a skipped job while keeping the report', async () => {
  const { calls } = submissionDatabase();
  const response = await app.inject(form(['image/heic']));
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().report.aiSeverityStatus, 'skipped');
  const job = calls.find(c => c.sql.includes("'SEVERITY_ESTIMATION'"));
  assert.equal(job?.params?.[2], 'SKIPPED');
  assert.equal(job?.params?.[4], 'UNSUPPORTED_IMAGE_TYPE');
});
test('disabled severity requires no migration or job insert', async () => {
  process.env.AI_SEVERITY_ENABLED = 'false';
  const { calls } = submissionDatabase();
  const response = await app.inject(form(['image/jpeg']));
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().report.aiSeverityStatus, 'disabled');
  assert.ok(!calls.some(c => c.sql.includes('report_ai_analyses')));
});
test('job insertion failure rolls back report/media and cleans up uploads', async () => {
  const { calls, removed } = submissionDatabase(true);
  const response = await app.inject(form(['image/jpeg']));
  assert.equal(response.statusCode, 500);
  assert.equal(calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].length, 1);
});
test('history returns completed severity independently and only for the JWT owner', async () => {
  const estimate = { level: null, score: null, suggestedLevel: 'HIGH', confidence: 0.4, reviewRequired: true };
  mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    assert.match(sql, /severity.analysis_type = 'SEVERITY_ESTIMATION'/);
    assert.match(sql, /WHERE r.citizen_id = \$1/);
    assert.equal(params[0], citizen);
    return { rows: [{ id: 'report', public_id: 'CR-1', status: 'PENDING', description: null, submitted_at: new Date(),
      category_id: category, category_slug: 'POTHOLE', category_label: 'Pothole', latitude: null, longitude: null,
      photo_count: '1', thumbnail_key: null, ai_analysis_status: null, severity_status: 'COMPLETED',
      severity_model: 'model', severity_model_version: 'version', severity_prediction: estimate }] };
  });
  const response = await app.inject({ url: '/api/reports?citizenId=someone-else', headers: auth() });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().reports[0].aiSeverity, {
    status: 'completed', model: 'model', modelVersion: 'version', estimate,
  });
  assert.equal(response.json().reports[0].aiClassification, null);
});
test('pending severity exposes no estimate and disabled history has no severity join', async () => {
  mock.method(pool, 'query', async (sql: string) => {
    const enabled = process.env.AI_SEVERITY_ENABLED === 'true';
    assert.equal(sql.includes('LEFT JOIN report_ai_analyses severity'), enabled);
    return { rows: [{ id: 'report', category_id: category, latitude: null, longitude: null,
      photo_count: '1', thumbnail_key: null, ai_analysis_status: null,
      severity_status: enabled ? 'PENDING' : null, severity_prediction: { level: 'HIGH' } }] };
  });
  let response = await app.inject({ url: '/api/reports', headers: auth() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().reports[0].aiSeverity.estimate, null);
  process.env.AI_SEVERITY_ENABLED = 'false';
  response = await app.inject({ url: '/api/reports', headers: auth() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().reports[0].aiSeverity, null);
});
