import assert from 'node:assert/strict';
import { after, before, test, mock } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import authenticatePlugin from '../src/plugins/authenticate';

// These tests never contact storage or a database.
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
const { default: reportRoutes } = await import('../src/routes/reports');
const { pool } = await import('../src/db');
const app = Fastify();
const citizenId = '11111111-1111-4111-8111-111111111111';
const otherCitizenId = '22222222-2222-4222-8222-222222222222';

before(async () => {
  await app.register(fastifyJwt, { secret: 'summary-test-secret' });
  await app.register(authenticatePlugin);
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.ready();
});

after(async () => {
  await app.close();
  await pool.end();
});

function headers(id = citizenId) {
  return { authorization: `Bearer ${app.jwt.sign({ id, role: 'CITIZEN' })}` };
}

test('requires a valid, unexpired token before querying reports', async () => {
  const query = mock.method(pool, 'query', async () => {
    throw new Error('Database must not be reached');
  });
  try {
    const expiredToken = app.jwt.sign({ id: citizenId, exp: 1 });
    for (const authorization of [undefined, 'Bearer invalid', `Bearer ${expiredToken}`]) {
      const response = await app.inject({
        url: '/api/reports/summary',
        headers: authorization ? { authorization } : {},
      });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: 'Unauthorized' });
    }
    assert.equal(query.mock.callCount(), 0);
  } finally {
    query.mock.restore();
  }
});

test('returns numeric aggregates scoped only by JWT owner, ignoring pagination and owner overrides', async () => {
  const query = mock.method(pool, 'query', async (sql: string, params: string[]) => {
    assert.match(sql, /FROM reports\s+WHERE citizen_id = \$1\s*$/);
    assert.doesNotMatch(sql, /\b(LIMIT|OFFSET|JOIN|GROUP BY)\b/i);
    assert.match(sql, /COUNT\(\*\) AS total/);
    for (const status of ['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']) {
      assert.ok(sql.includes(`COUNT(*) FILTER (WHERE status = '${status}')`));
    }
    assert.equal(params.length, 1);
    assert.ok([citizenId, otherCitizenId].includes(params[0]));
    return { rows: [params[0] === citizenId
      ? { total: '44', pending: '10', in_progress: '15', resolved: '17', rejected: '2' }
      : { total: '0', pending: '0', in_progress: '0', resolved: '0', rejected: '0' }] };
  });
  try {
    const response = await app.inject({
      url: `/api/reports/summary?limit=1&offset=40&citizenId=${otherCitizenId}&status=PENDING`,
      headers: headers(),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      total: 44, pending: 10, inProgress: 15, resolved: 17, rejected: 2, impactScore: 65,
    });
    const empty = await app.inject({ url: '/api/reports/summary', headers: headers(otherCitizenId) });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), {
      total: 0, pending: 0, inProgress: 0, resolved: 0, rejected: 0, impactScore: 0,
    });
    assert.equal(query.mock.callCount(), 2);
  } finally {
    query.mock.restore();
  }
});

test('database failures return the standard error without leaking details', async () => {
  const query = mock.method(pool, 'query', async () => {
    throw new Error('private database details');
  });
  try {
    const response = await app.inject({ url: '/api/reports/summary', headers: headers() });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal Server Error' });
  } finally {
    query.mock.restore();
  }
});

test('history applies owner-scoped status and literal search before pagination', async () => {
  const query = mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    assert.match(sql, /WHERE r\.citizen_id = \$1/);
    assert.match(sql, /r\.status = \$4::report_status/);
    assert.match(sql, /strpos\(lower\(concat_ws/);
    assert.match(sql, /ORDER BY r\.submitted_at DESC, r\.id DESC/);
    assert.deepEqual(params, [citizenId, 3, 20, 'RESOLVED', '%_ flooded']);
    return { rows: [1, 2, 3].map((value) => ({
      id: `report-${value}`, public_id: `CR-${value}`, status: 'RESOLVED',
      description: 'Flooded road', submitted_at: new Date('2026-10-15T10:00:00Z'),
      category_id: '44444444-4444-4444-8444-444444444444',
      category_slug: 'FLOODING', category_label: 'Flooding', latitude: null,
      longitude: null, accuracy: null, address: null, photo_count: '0',
      thumbnail_key: null, ai_analysis_status: null, severity_status: null,
    })) };
  });
  try {
    const response = await app.inject({
      url: '/api/reports?limit=2&offset=20&status=RESOLVED&q=%25_%20flooded',
      headers: headers(),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().pagination, { limit: 2, offset: 20, hasMore: true });
    assert.equal(response.json().reports.length, 2);
  } finally { query.mock.restore(); }
});

test('history rejects invalid filters before querying', async () => {
  const query = mock.method(pool, 'query', async () => {
    throw new Error('must not query');
  });
  try {
    for (const suffix of ['status=OPEN', 'limit=101', `q=${'a'.repeat(101)}`]) {
      assert.equal((await app.inject({
        url: `/api/reports?${suffix}`,
        headers: headers(),
      })).statusCode, 400);
    }
    assert.equal(query.mock.callCount(), 0);
  } finally { query.mock.restore(); }
});

test('report detail is owner-scoped and returns recorded metadata and events', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('FROM reports r')) {
      assert.match(sql, /r\.public_id = \$1 AND r\.citizen_id = \$2/);
      assert.deepEqual(params, ['CR-1000', citizenId]);
      return { rows: [{
        id: '33333333-3333-4333-8333-333333333333', public_id: 'CR-1000', status: 'IN_PROGRESS',
        description: 'Flooded road', submitted_at: '2026-10-13T08:00:00.000Z',
        assigned_agency: 'Lagos Public Works', citizen_reference: 'USR-42',
        category_id: '44444444-4444-4444-8444-444444444444', category_slug: 'FLOODING', category_label: 'Flooding',
        latitude: 6.5, longitude: 3.3, accuracy: 8, address: 'Ikeja', cluster_public_id: 'IC-1000',
        priority_band: 'HIGH', ai_analysis_status: null,
      }] };
    }
    if (sql.includes('FROM report_media')) return { rows: [] };
    assert.match(sql, /FROM report_status_events/);
    return { rows: [
      { id: '55555555-5555-4555-8555-555555555555', status: 'PENDING', occurred_at: '2026-10-13T08:00:00.000Z' },
      { id: '66666666-6666-4666-8666-666666666666', status: 'IN_PROGRESS', occurred_at: '2026-10-13T09:00:00.000Z' },
    ] };
  });
  try {
    const response = await app.inject({ url: '/api/reports/CR-1000', headers: headers() });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    const report = response.json().report;
    assert.equal(report.priority, 'HIGH');
    assert.equal(report.assignedAgency, 'Lagos Public Works');
    assert.equal(report.citizenReference, 'USR-42');
    assert.equal(report.events.length, 2);
    assert.deepEqual(report.photos, []);
    assert.equal(calls.length, 3);
  } finally { query.mock.restore(); }
});

test('report detail validates references before querying and hides missing or foreign reports', async () => {
  let calls = 0;
  const query = mock.method(pool, 'query', async (_sql: string, params: unknown[]) => {
    calls++;
    assert.deepEqual(params, ['CR-9999', citizenId]);
    return { rows: [] };
  });
  try {
    const invalid = await app.inject({ url: '/api/reports/not-a-report', headers: headers() });
    assert.equal(invalid.statusCode, 400);
    assert.equal(calls, 0);
    const missing = await app.inject({ url: '/api/reports/CR-9999', headers: headers() });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: 'Report not found' });
    assert.equal(calls, 1);
  } finally { query.mock.restore(); }
});
