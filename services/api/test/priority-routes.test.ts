import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import authenticatePlugin from '../src/plugins/authenticate';
import govPriorityRoutes from '../src/routes/gov-priority';
import { pool } from '../src/db';

const app = Fastify();
const savedEnv = { ...process.env };
const cluster = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const url = '/api/gov/issue-clusters/' + cluster;
function auth(role = 'ADMIN') { return { authorization: 'Bearer ' + app.jwt.sign({ id: user, role }) }; }
before(async () => {
  await app.register(fastifyJwt, { secret: 'priority-test-secret' });
  await app.register(authenticatePlugin);
  await app.register(govPriorityRoutes, { prefix: '/api/gov/issue-clusters' });
  await app.ready();
});
beforeEach(() => { process.env.AI_PRIORITY_ENABLED = 'true'; });
afterEach(() => { mock.restoreAll(); process.env = { ...savedEnv }; });
after(async () => { await app.close(); await pool.end(); });
function database(options: { role?: string; accountStatus?: string; missing?: boolean; stale?: boolean; failed?: boolean } = {}) {
  return mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) {
      assert.equal(params?.[0], user);
      return { rows: [{ role: options.role ?? 'ADMIN', status: options.accountStatus ?? 'ACTIVE' }] };
    }
    assert.equal(params?.[0], cluster);
    if (sql.includes('INSERT INTO issue_cluster_priority_context')) return { rows: [], rowCount: options.missing ? 0 : 1 };
    return { rows: options.missing ? [] : [{ id: cluster, error_code: options.failed ? 'PRIORITY_CALCULATION_FAILED' : null,
      stale: options.stale ?? false, calculation_id: 'calculation', calculated_at: new Date('2026-10-05T12:00:00Z'),
      result: { status: 'COMPLETED', score: 61.5, reviewRequired: false }, input_snapshot: { reports: [{ id: 'other-citizen-report' }] } }] };
  });
}
test('missing or invalid JWT cannot query any evidence', async () => {
  const query = mock.method(pool, 'query', async () => { throw new Error('No database call expected'); });
  for (const headers of [{}, { authorization: 'Bearer invalid' }]) {
    const response = await app.inject({ url: url + '/priority', headers });
    assert.equal(response.statusCode, 401);
  }
  assert.equal(query.mock.callCount(), 0);
});
test('current database role and account status control access even with an ADMIN JWT', async () => {
  for (const options of [{ role: 'CITIZEN' }, { role: 'UNKNOWN' }, { accountStatus: 'SUSPENDED' }]) {
    const query = database(options);
    for (const request of [{ method: 'GET' as const, url: url + '/priority' },
      { method: 'PUT' as const, url: url + '/priority-context', payload: {} }]) {
      const response = await app.inject({ ...request, headers: auth() });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(query.mock.callCount(), 2); // authorization lookups only.
    mock.restoreAll();
  }
});
test('operators can read calculation evidence; citizens cannot override the cluster via query', async () => {
  database({ role: 'OPERATOR' });
  const response = await app.inject({ url: url + '/priority?clusterId=someone-else', headers: auth('CITIZEN') });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ready');
  assert.equal(response.json().priority.score, 61.5);
  assert.equal(response.json().lastCalculation.inputSnapshot.reports[0].id, 'other-citizen-report');
});
test('stale or failed calculations are preserved for audit but never returned as current priority', async () => {
  for (const [options, status] of [[{ stale: true }, 'pending'], [{ failed: true }, 'failed']] as const) {
    database(options);
    const response = await app.inject({ url: url + '/priority', headers: auth() });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, status);
    assert.equal(response.json().priority, null);
    assert.equal(response.json().lastCalculation.result.score, 61.5);
    mock.restoreAll();
  }
});
test('unknown cluster returns 404 and invalid UUID returns 400', async () => {
  database({ missing: true });
  assert.equal((await app.inject({ url: url + '/priority', headers: auth() })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/gov/issue-clusters/invalid/priority', headers: auth() })).statusCode, 400);
});
test('disabled priority needs no new migration tables after authorization', async () => {
  process.env.AI_PRIORITY_ENABLED = 'false';
  const query = database();
  const response = await app.inject({ url: url + '/priority', headers: auth() });
  assert.deepEqual(response.json(), { status: 'disabled', priority: null });
  const write = await app.inject({ method: 'PUT', url: url + '/priority-context', headers: auth(),
    payload: { population: null, locationImportance: null, reason: 'Clear context' } });
  assert.equal(write.statusCode, 503);
  assert.equal(query.mock.callCount(), 2);
});
test('context updates carry sourced scores, JWT reviewer and reason to the audited write', async () => {
  const query = database();
  const response = await app.inject({ method: 'PUT', url: url + '/priority-context', headers: auth(),
    payload: { population: { score: 0, source: '  Census dataset  ' },
      locationImportance: { score: 0.8, source: 'Agency route designation' }, reason: '  Verified inputs  ' } });
  assert.equal(response.statusCode, 202);
  const write = query.mock.calls[1].arguments;
  assert.match(write[0], /ON CONFLICT/);
  assert.deepEqual(write[1], [cluster, 0, 'Census dataset', 0.8, 'Agency route designation', user, 'Verified inputs']);
});
test('context may be cleared to unknown but unknown clusters are not inserted', async () => {
  const query = database({ missing: true });
  const response = await app.inject({ method: 'PUT', url: url + '/priority-context', headers: auth(),
    payload: { population: null, locationImportance: null, reason: 'No reliable sources' } });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(query.mock.calls[1].arguments[1], [cluster, null, null, null, null, user, 'No reliable sources']);
});
test('invalid scores, missing provenance, absent reasons and actor overrides are rejected', async () => {
  const query = database();
  const valid = { population: null, locationImportance: null, reason: 'Check' };
  for (const payload of [{ ...valid, population: { score: 1.1, source: 'Source' } },
    { ...valid, population: { score: 0.8, source: ' ' } }, { ...valid, reason: '' },
    { ...valid, updatedBy: 'other-user' }, { population: null, reason: 'Check' }]) {
    const response = await app.inject({ method: 'PUT', url: url + '/priority-context', headers: auth(), payload });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(query.mock.callCount(), 5); // authorization only, no writes.
});
test('database failures use the standard error without leaking details', async () => {
  mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    throw new Error('private error');
  });
  const response = await app.inject({ url: url + '/priority', headers: auth() });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Internal Server Error' });
});
