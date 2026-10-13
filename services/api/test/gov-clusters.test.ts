import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import routes from '../src/routes/gov-clusters';
import { pool } from '../src/db';

const app = Fastify();
const url = '/api/gov/issue-clusters/';
const id = '33333333-3333-4333-8333-333333333333';
const userId = '22222222-2222-4222-8222-222222222222';
const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ id: userId, role: 'ADMIN' })}` });
const previousPriority = process.env.AI_PRIORITY_ENABLED;

before(async () => {
  await app.register(jwt, { secret: 'clusters-test-secret' });
  await app.register(authenticate);
  await app.register(routes, { prefix: '/api/gov/issue-clusters' });
  await app.ready();
});
afterEach(() => { mock.restoreAll(); process.env.AI_PRIORITY_ENABLED = 'false'; });
after(async () => {
  if (previousPriority === undefined) delete process.env.AI_PRIORITY_ENABLED;
  else process.env.AI_PRIORITY_ENABLED = previousPriority;
  await app.close(); await pool.end();
});

test('cluster list and summary require authentication before database access', async () => {
  const db = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  for (const path of [url, url + id]) {
    for (const authorization of [undefined, 'Bearer invalid']) {
      const response = await app.inject({ url: path, headers: authorization ? { authorization } : {} });
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
  }
  assert.equal(db.mock.callCount(), 0);
});

test('database role and status override stale government token claims', async () => {
  for (const user of [null, { role: 'CITIZEN', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }]) {
    const db = mock.method(pool, 'query', async () => ({ rows: user ? [user] : [] }));
    for (const path of [url, url + id]) assert.equal((await app.inject({ url: path, headers: headers() })).statusCode, 403);
    assert.equal(db.mock.callCount(), 2);
    mock.restoreAll();
  }
});

test('list rejects unknown, invalid and unbounded filters', async () => {
  const db = mock.method(pool, 'query', async () => ({ rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] }));
  for (const value of ['page=0', 'page=1000001', 'limit=101', 'page=1.2', 'status=OPEN',
    'category=%27%3BDROP', `q=${'a'.repeat(201)}`, 'citizenId=someone']) {
    assert.equal((await app.inject({ url: `${url}?${value}`, headers: headers() })).statusCode, 400, value);
  }
  assert.equal(db.mock.callCount(), 8);
});

test('disabled-priority list binds literal search and paginates a consistent non-empty snapshot', async () => {
  process.env.AI_PRIORITY_ENABLED = 'false';
  const listing = { page: 2, limit: 20, total: 21, priorityEnabled: false, categories: [], clusters: [] };
  mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] };
    assert.deepEqual(values, ['IN_PROGRESS', 'POTHOLE', '%_literal', 20, 20, 2, false]);
    assert.match(sql, /ic\.report_count > 0/);
    assert.match(sql, /strpos\(lower\(concat_ws/);
    assert.match(sql, /ORDER BY updated_at DESC, id DESC LIMIT \$4 OFFSET \$5/);
    assert.doesNotMatch(sql, /issue_cluster_priority_jobs|citizen_id|email|nin|description|storage_key/);
    return { rows: [{ listing }] };
  });
  const response = await app.inject({ url: `${url}?page=2&status=IN_PROGRESS&category=POTHOLE&q=%20%25_literal%20`, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), listing);
});

test('enabled list includes current priority state without returning calculation evidence', async () => {
  process.env.AI_PRIORITY_ENABLED = 'true';
  mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.deepEqual(values, [null, null, null, 20, 0, 1, true]);
    assert.match(sql, /issue_cluster_priority_jobs/);
    assert.match(sql, /evaluated_revision IS DISTINCT FROM/);
    assert.doesNotMatch(sql, /input_snapshot|population_source|location_importance_source/);
    return { rows: [{ listing: { total: 0, clusters: [], priorityEnabled: true } }] };
  });
  assert.equal((await app.inject({ url, headers: headers() })).statusCode, 200);
});

test('summary validates ids, distinguishes missing clusters and exposes aggregate grouping only', async () => {
  process.env.AI_PRIORITY_ENABLED = 'false';
  const db = mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.deepEqual(values, [id]);
    assert.match(sql, /averageConfidence/);
    assert.match(sql, /firstAssignedAt/);
    assert.doesNotMatch(sql, /citizen_id|description|storage_key|input_snapshot/);
    return { rows: [] };
  });
  assert.equal((await app.inject({ url: url + 'invalid', headers: headers() })).statusCode, 400);
  const response = await app.inject({ url: url + id, headers: headers() });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'Cluster not found' });
  assert.equal(db.mock.callCount(), 3);
});

test('list and summary database failures are sanitized', async () => {
  mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    throw new Error('private database details');
  });
  for (const path of [url, url + id]) {
    const response = await app.inject({ url: path, headers: headers() });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal Server Error' });
  }
});
