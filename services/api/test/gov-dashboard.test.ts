import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import dashboard from '../src/routes/gov-dashboard';
import { pool } from '../src/db';

const app = Fastify();
const url = '/api/gov/dashboard/overview';
const savedPriority = process.env.AI_PRIORITY_ENABLED;
const userId = '22222222-2222-4222-8222-222222222222';
const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ id: userId, role: 'ADMIN' })}` });
before(async () => {
  await app.register(jwt, { secret: 'dashboard-test-secret' });
  await app.register(authenticate);
  await app.register(dashboard, { prefix: '/api/gov/dashboard' });
  await app.ready();
});
afterEach(() => {
  mock.restoreAll();
  if (savedPriority === undefined) delete process.env.AI_PRIORITY_ENABLED;
  else process.env.AI_PRIORITY_ENABLED = savedPriority;
});
after(async () => { await app.close(); await pool.end(); });

test('overview requires a valid JWT before querying the database', async () => {
  const database = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  for (const authorization of [undefined, 'Bearer invalid']) {
    assert.equal((await app.inject({ url, headers: authorization ? { authorization } : {} })).statusCode, 401);
  }
  assert.equal(database.mock.callCount(), 0);
});

test('database role and status override an ADMIN token', async () => {
  for (const user of [null, { role: 'CITIZEN', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' },
    { role: 'UNKNOWN', status: 'ACTIVE' }]) {
    const database = mock.method(pool, 'query', async () => ({ rows: user ? [user] : [] }));
    assert.equal((await app.inject({ url, headers: headers() })).statusCode, 403);
    assert.equal(database.mock.callCount(), 1);
    mock.restoreAll();
  }
});

test('active operators receive one unpaginated snapshot, without citizen identity', async () => {
  process.env.AI_PRIORITY_ENABLED = 'true';
  const overview = { reports: { total: 42 }, recentReports: [], priority: { enabled: true, pending: 3 } };
  const database = mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) {
      assert.deepEqual(params, [userId]);
      return { rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] };
    }
    assert.match(sql, /count\(DISTINCT report_id\)/);
    assert.match(sql, /NOT EXISTS/);
    assert.match(sql, /WHERE report_count > 0/);
    assert.match(sql, /LIMIT 8/);
    assert.match(sql, /evaluated_revision IS DISTINCT FROM j.revision/);
    assert.match(sql, /j.next_run_at <= NOW\(\)/);
    assert.match(sql, /j.error_code IS NOT NULL THEN 'failed'/);
    assert.doesNotMatch(sql, /citizen_id|nin|email|password|input_snapshot/);
    return { rows: [{ overview }] };
  });
  const response = await app.inject({ url: url + '?limit=1&citizenId=other-user', headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), overview);
  assert.equal(database.mock.callCount(), 2);
});

test('disabled priority does not read priority tables or expose old calculations', async () => {
  process.env.AI_PRIORITY_ENABLED = 'false';
  mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.doesNotMatch(sql, /issue_cluster_priority_(jobs|calculations)|priority_state/);
    assert.match(sql, /'enabled', false/);
    return { rows: [{ overview: { priority: { enabled: false } } }] };
  });
  assert.deepEqual((await app.inject({ url, headers: headers() })).json(), { priority: { enabled: false } });
});

test('database errors, including authorization errors, never disclose internals', async () => {
  for (const failAuthorization of [true, false]) {
    mock.method(pool, 'query', async (sql: string) => {
      if (!failAuthorization && sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
      throw new Error('private database details');
    });
    const response = await app.inject({ url, headers: headers() });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal Server Error' });
    mock.restoreAll();
  }
});
