import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import authenticatePlugin from '../src/plugins/authenticate';

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
const { default: authRoutes } = await import('../src/routes/auth');
const { pool } = await import('../src/db');

const app = Fastify();
const citizenId = '11111111-1111-4111-8111-111111111111';

before(async () => {
  await app.register(fastifyJwt, { secret: 'profile-test-secret' });
  await app.register(authenticatePlugin);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
});

after(async () => {
  await app.close();
  await pool.end();
});

test('profile update requires authentication and validates before querying', async () => {
  const query = mock.method(pool, 'query', async () => {
    throw new Error('Database must not be reached');
  });
  try {
    const unauthorized = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { fullName: 'Ada Okafor' },
    });
    assert.equal(unauthorized.statusCode, 401);

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${app.jwt.sign({ id: citizenId, role: 'CITIZEN' })}` },
      payload: { fullName: 'A' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(query.mock.callCount(), 0);
  } finally {
    query.mock.restore();
  }
});

test('profile update changes only editable citizen fields', async () => {
  const row = {
    id: citizenId,
    public_id: 'citizen-public-id',
    full_name: 'Ada Okafor',
    email: 'ada@example.com',
    phone: '+2348000000000',
    nin: '12345678901',
    role: 'CITIZEN',
    status: 'ACTIVE',
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
  const query = mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    assert.match(sql, /UPDATE users/);
    assert.match(sql, /WHERE id = \$1 AND role = 'CITIZEN'/);
    const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
    assert.doesNotMatch(setClause, /\b(email|nin|role|status)\s*=/i);
    assert.deepEqual(params, [citizenId, 'Ada Okafor', '+2348000000000']);
    return { rows: [row] };
  });
  try {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${app.jwt.sign({ id: citizenId, role: 'CITIZEN' })}` },
      payload: {
        fullName: '  Ada Okafor  ',
        phone: '+2348000000000',
        email: 'attacker@example.com',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { user: { ...row, created_at: row.created_at.toISOString() } });
  } finally {
    query.mock.restore();
  }
});
