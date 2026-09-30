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
      total: 44, pending: 10, inProgress: 15, resolved: 17, rejected: 2,
    });
    const empty = await app.inject({ url: '/api/reports/summary', headers: headers(otherCitizenId) });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), {
      total: 0, pending: 0, inProgress: 0, resolved: 0, rejected: 0,
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
