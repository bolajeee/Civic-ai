import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import routes from '../src/routes/gov-map';
import { pool } from '../src/db';

const app = Fastify();
const url = '/api/gov/dashboard/map';
const userId = '22222222-2222-4222-8222-222222222222';
const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ id: userId, role: 'ADMIN' })}` });
before(async () => {
  await app.register(jwt, { secret: 'map-test-secret' });
  await app.register(authenticate);
  await app.register(routes, { prefix: '/api/gov/dashboard' });
  await app.ready();
});
afterEach(() => mock.restoreAll());
after(async () => { await app.close(); await pool.end(); });

test('map rejects invalid tokens before any database query', async () => {
  const db = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  for (const authorization of [undefined, 'Bearer invalid']) {
    assert.equal((await app.inject({ url: `${url}?bbox=2,4,5,8`, headers: authorization ? { authorization } : {} })).statusCode, 401);
  }
  assert.equal(db.mock.callCount(), 0);
});

test('map checks current government role and ACTIVE status', async () => {
  for (const user of [null, { role: 'CITIZEN', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }]) {
    const db = mock.method(pool, 'query', async () => ({ rows: user ? [user] : [] }));
    assert.equal((await app.inject({ url: `${url}?bbox=2,4,5,8`, headers: headers() })).statusCode, 403);
    assert.equal(db.mock.callCount(), 1);
    mock.restoreAll();
  }
});

test('map validates finite ordered geographic bounds and bounded filters', async () => {
  const db = mock.method(pool, 'query', async () => ({ rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] }));
  const invalid = ['', 'bbox=1,2,3', 'bbox=,2,3,4', 'bbox=NaN,2,3,4', 'bbox=Infinity,2,3,4',
    'bbox=181,2,182,4', 'bbox=1,-91,3,4', 'bbox=1,2,3,91', 'bbox=3,2,1,4', 'bbox=1,4,3,2',
    'bbox=1,2,1,4', 'bbox=1,2,3,4&limit=501', 'bbox=1,2,3,4&limit=0',
    'bbox=1,2,3,4&limit=1.5', 'bbox=1,2,3,4&layer=other', 'bbox=1,2,3,4&status=OPEN',
    'bbox=1,2,3,4&category=%27%3BDROP', 'bbox=1,2,3,4&citizenId=private'];
  for (const params of invalid) {
    const response = await app.inject({ url: `${url}?${params}`, headers: headers() });
    assert.equal(response.statusCode, 400, params);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(db.mock.callCount(), invalid.length);
});

test('map parameterizes spatial filters and returns bounded GeoJSON without identity', async () => {
  const snapshot = { reports: { type: 'FeatureCollection', features: [], total: 0, withoutGeometry: 2 },
    clusters: { type: 'FeatureCollection', features: [], total: 0, withoutGeometry: 1 } };
  const db = mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] };
    assert.deepEqual(params, [2, 4, 5, 8, 'PENDING', 'POTHOLE', 'reports', 10]);
    assert.match(sql, /ST_MakeEnvelope/);
    assert.match(sql, /l.geom &&/);
    assert.match(sql, /ic.centroid &&/);
    assert.match(sql, /ST_AsGeoJSON/);
    assert.match(sql, /LIMIT \$8/);
    assert.doesNotMatch(sql, /citizen_id|nin|email|password|report_media|priority_calculations/);
    return { rows: [{ map: snapshot }] };
  });
  const response = await app.inject({ url: `${url}?bbox=2,4,5,8&status=PENDING&category=POTHOLE&layer=reports&limit=10`, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), snapshot);
  assert.equal(db.mock.callCount(), 2);
});

test('map defaults both layers to 250 points and sanitizes database failures', async () => {
  mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.deepEqual(params, [-180, -90, 180, 90, null, null, 'all', 250]);
    throw new Error('private connection details');
  });
  const response = await app.inject({ url: `${url}?bbox=-180,-90,180,90`, headers: headers() });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Internal Server Error' });
});
