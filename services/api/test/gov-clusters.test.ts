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
let sign: (keys: string[], ttl: number) => Promise<Record<string, string>>;

before(async () => {
  await app.register(jwt, { secret: 'clusters-test-secret' });
  await app.register(authenticate);
  await app.register(routes, { prefix: '/api/gov/issue-clusters', signPhotos: (keys, ttl) => sign(keys, ttl) });
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
  for (const path of [url, url + id, `${url}${id}/evidence`]) {
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
    for (const path of [url, url + id, `${url}${id}/evidence`]) assert.equal((await app.inject({ url: path, headers: headers() })).statusCode, 403);
    assert.equal(db.mock.callCount(), 3);
    mock.restoreAll();
  }
});

test('list rejects unknown, invalid and unbounded filters', async () => {
  const db = mock.method(pool, 'query', async () => ({ rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] }));
  for (const value of ['page=0', 'page=1000001', 'limit=101', 'page=1.2', 'status=OPEN',
    'category=%27%3BDROP', `q=${'a'.repeat(201)}`, 'review=maybe', 'assignment=ai',
    'location=unknown', 'citizenId=someone']) {
    assert.equal((await app.inject({ url: `${url}?${value}`, headers: headers() })).statusCode, 400, value);
  }
  assert.equal(db.mock.callCount(), 11);
});

test('disabled-priority list binds literal search and paginates a consistent non-empty snapshot', async () => {
  process.env.AI_PRIORITY_ENABLED = 'false';
  const listing = { page: 2, limit: 20, total: 21, priorityEnabled: false, categories: [], clusters: [] };
  mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] };
    assert.deepEqual(values, ['IN_PROGRESS', 'POTHOLE', '%_literal', 'pending', 'AI', 'missing', 20, 20, 2, false]);
    assert.match(sql, /ic\.report_count > 0/);
    assert.match(sql, /strpos\(lower\(concat_ws/);
    assert.match(sql, /search_report\.description/);
    assert.match(sql, /search_review/);
    assert.match(sql, /assignment_filter\.assignment_method = \$5/);
    assert.match(sql, /location_report\.location_id IS NULL/);
    assert.match(sql, /ORDER BY updated_at DESC, id DESC LIMIT \$7 OFFSET \$8/);
    assert.doesNotMatch(sql, /issue_cluster_priority_jobs|citizen_id|email|nin|storage_key/);
    return { rows: [{ listing }] };
  });
  const response = await app.inject({ url: `${url}?page=2&status=IN_PROGRESS&category=POTHOLE&q=%20%25_literal%20&review=pending&assignment=AI&location=missing`, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), listing);
});

test('enabled list includes current priority state without returning calculation evidence', async () => {
  process.env.AI_PRIORITY_ENABLED = 'true';
  mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.deepEqual(values, [null, null, null, 'all', 'all', 'all', 20, 0, 1, true]);
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

test('evidence validates bounded pagination and rejects identity overrides', async () => {
  const db = mock.method(pool, 'query', async () => ({ rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] }));
  for (const value of ['page=0', 'page=1000001', 'page=1.2', 'limit=0', 'limit=51', 'citizenId=someone']) {
    assert.equal((await app.inject({ url: `${url}${id}/evidence?${value}`, headers: headers() })).statusCode, 400, value);
  }
  assert.equal((await app.inject({ url: `${url}invalid/evidence`, headers: headers() })).statusCode, 400);
  assert.equal(db.mock.callCount(), 7);
});

test('evidence paginates reports, batch-signs ordered photos and removes storage keys', async () => {
  sign = async (keys, ttl) => {
    assert.deepEqual(keys, ['reports/one.jpg', 'reports/two.jpg']);
    assert.equal(ttl, 900);
    return { 'reports/one.jpg': 'https://storage.example/one' };
  };
  const evidence = { generatedAt: '2026-10-13T12:00:00Z', page: 2, limit: 20, total: 25,
    cluster: { id, publicId: 'IC-1000' }, reports: [{ id: 'report', publicId: 'CR-1', photos: [
      { id: 'one', storageKey: 'reports/one.jpg', mediaType: 'image/jpeg', displayOrder: 0 },
      { id: 'two', storageKey: 'reports/two.jpg', mediaType: 'image/jpeg', displayOrder: 1 },
    ] }] };
  mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.deepEqual(values, [id, 20, 20, 2]);
    assert.match(sql, /JOIN issue_cluster_reports/);
    assert.match(sql, /ORDER BY "submittedAt" DESC, id DESC LIMIT \$2 OFFSET \$3/);
    assert.match(sql, /ORDER BY media\.display_order, media\.id/);
    assert.match(sql, /report_cluster_decisions/);
    assert.match(sql, /report_duplicate_candidates/);
    assert.match(sql, /issue_cluster_review_candidates/);
    assert.match(sql, /'visualSignalStatus', 'not_implemented'/);
    assert.doesNotMatch(sql, /citizen_id|email|nin|phone/);
    return { rows: [{ evidence }] };
  });
  const response = await app.inject({ url: `${url}${id}/evidence?page=2`, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().photosExpireInSeconds, 900);
  assert.equal(response.json().reports[0].photos[0].url, 'https://storage.example/one');
  assert.equal(response.json().reports[0].photos[1].url, null);
  assert.doesNotMatch(response.body, /storageKey|reports\/one\.jpg/);
});

test('missing evidence cluster returns 404 and signing failure preserves original report metadata', async () => {
  let evidence: EvidenceFixture = { cluster: null, reports: [] };
  sign = async () => { throw new Error('private storage credentials'); };
  mock.method(pool, 'query', async (sql: string) => sql.startsWith('SELECT role, status')
    ? { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] } : { rows: [{ evidence }] });
  assert.equal((await app.inject({ url: `${url}${id}/evidence`, headers: headers() })).statusCode, 404);
  evidence = { cluster: { id, publicId: 'IC-1000' }, reports: [{ publicId: 'CR-7', description: 'Original text',
    photos: [{ id: 'photo', storageKey: 'private-key', mediaType: 'image/png', displayOrder: 0 }] }] };
  const response = await app.inject({ url: `${url}${id}/evidence`, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().reports[0].description, 'Original text');
  assert.equal(response.json().reports[0].photos[0].url, null);
  assert.doesNotMatch(response.body, /private-key|credentials/);
});

type EvidenceFixture = { cluster: { id: string; publicId: string } | null; reports: Array<Record<string, unknown>> };

test('list, summary and evidence database failures are sanitized', async () => {
  mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    throw new Error('private database details');
  });
  for (const path of [url, url + id, `${url}${id}/evidence`]) {
    const response = await app.inject({ url: path, headers: headers() });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal Server Error' });
  }
});

test('review queue requires authentication and current government access', async () => {
  const db = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  for (const authorization of [undefined, 'Bearer invalid']) {
    const response = await app.inject({ url: `${url}review-queue`, headers: authorization ? { authorization } : {} });
    assert.equal(response.statusCode, 401);
  }
  assert.equal(db.mock.callCount(), 0);
  mock.restoreAll();
  mock.method(pool, 'query', async () => ({ rows: [{ role: 'CITIZEN', status: 'ACTIVE' }] }));
  assert.equal((await app.inject({ url: `${url}review-queue`, headers: headers() })).statusCode, 403);
});

test('review queue rejects unknown, invalid and unbounded filters', async () => {
  mock.method(pool, 'query', async () => ({ rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] }));
  for (const value of ['page=0', 'limit=101', 'status=OPEN', 'status=pending', 'reason=other',
    'category=%27%3BDROP', `q=${'a'.repeat(201)}`, 'citizenId=someone']) {
    assert.equal((await app.inject({ url: `${url}review-queue?${value}`, headers: headers() })).statusCode, 400, value);
  }
});

test('review queue defaults to pending oldest-first and binds literal filters', async () => {
  const queue = { page: 1, limit: 20, total: 0, counts: { pending: 0, accepted: 0, dismissed: 0 }, categories: [], items: [] };
  mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] };
    assert.deepEqual(values, ['PENDING', 'all', null, null, 20, 0, 1]);
    assert.match(sql, /ORDER BY created_at ASC, report_id, issue_cluster_id LIMIT \$5 OFFSET \$6/);
    assert.match(sql, /strpos\(lower\(concat_ws/);
    assert.doesNotMatch(sql, /citizen_id|email|nin|storage_key/);
    return { rows: [{ queue }] };
  });
  const response = await app.inject({ url: `${url}review-queue`, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), queue);
});

test('review queue passes status, reason, category, search and pagination as bound values', async () => {
  mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.deepEqual(values, ['all', 'AMBIGUOUS_MATCH', 'POTHOLE', '%_x', 50, 100, 3]);
    return { rows: [{ queue: { items: [] } }] };
  });
  const response = await app.inject({ url: `${url}review-queue?status=all&reason=AMBIGUOUS_MATCH&category=POTHOLE&q=%20%25_x%20&limit=50&page=3`, headers: headers() });
  assert.equal(response.statusCode, 200);
});

test('review queue database failures are sanitized', async () => {
  mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    throw new Error('private database details');
  });
  const response = await app.inject({ url: `${url}review-queue`, headers: headers() });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Internal Server Error' });
});
