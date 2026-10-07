import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import routes from '../src/routes/gov-reports';
import { pool } from '../src/db';

const app = Fastify();
const url = '/api/gov/reports/';
const id = '22222222-2222-4222-8222-222222222222';
const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ id, role: 'ADMIN' })}` });
let sign: (keys: string[], ttl: number) => Promise<Record<string, string>>;
before(async () => {
  await app.register(jwt, { secret: 'reports-test-secret' });
  await app.register(authenticate);
  await app.register(routes, { prefix: '/api/gov/reports', signPhotos: (keys, ttl) => sign(keys, ttl) });
  await app.ready();
});
afterEach(() => mock.restoreAll());
after(async () => { await app.close(); await pool.end(); });

test('government list and details require a valid JWT before querying any data', async () => {
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

test('database government role and account status override stale token claims on list and detail', async () => {
  for (const user of [null, { role: 'CITIZEN', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }]) {
    const db = mock.method(pool, 'query', async () => ({ rows: user ? [user] : [] }));
    for (const path of [url, url + id]) assert.equal((await app.inject({ url: path, headers: headers() })).statusCode, 403);
    assert.equal(db.mock.callCount(), 2);
    mock.restoreAll();
  }
});

test('list rejects invalid pagination, dates, enum filters and identity overrides', async () => {
  const db = mock.method(pool, 'query', async () => ({ rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] }));
  for (const params of ['page=0', 'page=1000001', 'limit=101', 'limit=0', 'page=1.2', 'status=OPEN',
    'grouping=other', 'location=other', 'category=%27%3BDROP', 'q=' + 'a'.repeat(201),
    'from=2026-02-30', 'to=2026-13-01', 'from=2026-10-08&to=2026-10-07', 'citizenId=someone']) {
    assert.equal((await app.inject({ url: url + '?' + params, headers: headers() })).statusCode, 400, params);
  }
  assert.equal(db.mock.callCount(), 14);
});

test('list binds full-dataset literal search, WAT dates and pagination without citizen identifiers', async () => {
  const listing = { page: 2, limit: 20, total: 45, categories: [], reports: [] };
  mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] };
    assert.deepEqual(params, ['PENDING', 'POTHOLE', '%_test', 'unassigned', 'missing', '2026-10-01', '2026-10-07', 20, 20, 2]);
    assert.match(sql, /strpos\(lower\(concat_ws/);
    assert.match(sql, /AT TIME ZONE 'Africa\/Lagos'/);
    assert.match(sql, /ORDER BY "submittedAt" DESC, id DESC LIMIT \$8 OFFSET \$9/);
    assert.doesNotMatch(sql, /citizen_id|nin|email|password|storage_key|report_ai_analyses/);
    return { rows: [{ listing }] };
  });
  const response = await app.inject({ url: url + '?page=2&status=PENDING&category=POTHOLE&q=%20%25_test%20&grouping=unassigned&location=missing&from=2026-10-01&to=2026-10-07', headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), listing);
});

test('list defaults to a bounded first page and blank search is absent', async () => {
  mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.deepEqual(params, [null, null, null, 'all', 'all', null, null, 20, 0, 1]);
    return { rows: [{ listing: { total: 0, reports: [] } }] };
  });
  assert.equal((await app.inject({ url: url + '?q=%20', headers: headers() })).statusCode, 200);
});

test('report details validate UUIDs and distinguish a missing report', async () => {
  const db = mock.method(pool, 'query', async (sql: string) => ({ rows: sql.startsWith('SELECT role, status') ? [{ role: 'ADMIN', status: 'ACTIVE' }] : [] }));
  assert.equal((await app.inject({ url: url + 'invalid', headers: headers() })).statusCode, 400);
  assert.equal(db.mock.callCount(), 1);
  const response = await app.inject({ url: url + id, headers: headers() });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'Report not found' });
});

test('details batch-sign only selected report photos with 15 minute expiry and remove storage keys', async () => {
  sign = async (keys, ttl) => {
    assert.deepEqual(keys, ['report/one.jpg', 'report/two.png']);
    assert.equal(ttl, 900);
    return { 'report/one.jpg': 'https://storage.example/signed-one' };
  };
  mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.deepEqual(params, [id]);
    assert.match(sql, /WHERE r.id = \$1/);
    assert.match(sql, /ORDER BY media.display_order, media.id/);
    assert.doesNotMatch(sql, /citizen_id|nin|email|password/);
    return { rows: [{ report: { id, publicId: 'CR-1', photos: [
      { id: 'one', storageKey: 'report/one.jpg', mediaType: 'image/jpeg', displayOrder: 0 },
      { id: 'two', storageKey: 'report/two.png', mediaType: 'image/png', displayOrder: 1 },
    ] } }] };
  });
  const response = await app.inject({ url: url + id, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().photosExpireInSeconds, 900);
  assert.equal(response.json().report.photos[0].url, 'https://storage.example/signed-one');
  assert.equal(response.json().report.photos[1].url, null);
  assert.doesNotMatch(response.body, /storageKey|report\/one.jpg/);
});

test('photo signing failure preserves report metadata and exposes unavailable photos', async () => {
  sign = async () => { throw new Error('Private storage credentials'); };
  mock.method(pool, 'query', async (sql: string) => ({ rows: sql.startsWith('SELECT role, status')
    ? [{ role: 'OPERATOR', status: 'ACTIVE' }]
    : [{ report: { id, description: 'Observation', photos: [{ id: 'photo', storageKey: 'private', mediaType: 'image/jpeg', displayOrder: 0 }] } }] }));
  const response = await app.inject({ url: url + id, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().report.description, 'Observation');
  assert.equal(response.json().report.photos[0].url, null);
  assert.doesNotMatch(response.body, /private|credentials/);
});

test('list and detail database failures return sanitized errors', async () => {
  mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    throw new Error('Private database connection');
  });
  for (const path of [url, url + id]) {
    const response = await app.inject({ url: path, headers: headers() });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal Server Error' });
  }
});
