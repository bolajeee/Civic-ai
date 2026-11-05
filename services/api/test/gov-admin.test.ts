import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import routes from '../src/routes/gov-admin';
import { pool } from '../src/db';

const app = Fastify();
const adminId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const invitationId = '33333333-3333-4333-8333-333333333333';
const auth = () => ({ authorization: `Bearer ${app.jwt.sign({ id: adminId, role: 'ADMIN' })}` });

before(async () => {
  await app.register(jwt, { secret: 'government-admin-test-secret' });
  await app.register(authenticate);
  await app.register(routes, { prefix: '/api/gov/admin' });
  await app.ready();
});
afterEach(() => mock.restoreAll());
after(async () => { await app.close(); await pool.end(); });

test('administration requires a valid JWT before querying the database', async () => {
  const database = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  assert.equal((await app.inject({ url: '/api/gov/admin/' })).statusCode, 401);
  assert.equal(database.mock.callCount(), 0);
});

test('current database role and status must be an active administrator', async () => {
  for (const user of [{ role: 'OPERATOR', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }, null]) {
    const database = mock.method(pool, 'query', async () => ({ rows: user ? [user] : [] }));
    const response = await app.inject({ url: '/api/gov/admin/', headers: auth() });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'Administrator access required' });
    assert.equal(database.mock.callCount(), 1);
    mock.restoreAll();
  }
});

test('administrator can list government accounts and invitation metadata', async () => {
  mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    if (sql.includes("FROM users WHERE role IN")) return { rows: [{ id: accountId, public_id: 'GOV-1', email: 'operator@example.gov', role: 'OPERATOR', status: 'ACTIVE', created_at: '2026-10-01', updated_at: '2026-10-01' }] };
    assert.match(sql, /FROM gov_invite_codes/);
    return { rows: [{ id: invitationId, role: 'OPERATOR', expires_at: '2026-10-14', created_at: '2026-10-13', used_at: null, revoked_at: null, created_by_email: 'admin@example.gov', used_by_email: null }] };
  });
  const response = await app.inject({ url: '/api/gov/admin/', headers: auth() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.json().accounts[0].publicId, 'GOV-1');
  assert.equal(response.json().invitations[0].createdByEmail, 'admin@example.gov');
  assert.equal(JSON.stringify(response.json()).includes('code_hash'), false);
});

test('created invitation returns its raw code once and stores only its hash', async () => {
  let insertParams: unknown[] = [];
  mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.match(sql, /INSERT INTO gov_invite_codes/);
    insertParams = params || [];
    return { rows: [{ id: invitationId, role: 'ADMIN', expires_at: '2026-10-14', created_at: '2026-10-13' }] };
  });
  const response = await app.inject({ method: 'POST', url: '/api/gov/admin/invitations', headers: auth(), payload: { role: 'ADMIN', expiresInHours: 24 } });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.match(body.code, /^[a-f0-9]{48}$/);
  assert.equal(insertParams[0], await sha256(body.code));
  assert.equal(insertParams[1], 'ADMIN');
  assert.equal(insertParams[2], adminId);
  assert.equal(insertParams.includes(body.code), false);
});

test('administrator cannot suspend their own account', async () => {
  const database = mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    throw new Error('Unexpected mutation');
  });
  const response = await app.inject({ method: 'PATCH', url: `/api/gov/admin/accounts/${adminId}/status`, headers: auth(), payload: { status: 'SUSPENDED' } });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /own account/);
  assert.equal(database.mock.callCount(), 1);
});

test('revoking an invitation retains its audit record', async () => {
  mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    assert.match(sql, /UPDATE gov_invite_codes SET revoked_at = NOW\(\)/);
    assert.doesNotMatch(sql, /DELETE FROM/);
    return { rows: [{ id: invitationId }] };
  });
  const response = await app.inject({ method: 'DELETE', url: `/api/gov/admin/invitations/${invitationId}`, headers: auth() });
  assert.equal(response.statusCode, 204);
});

test('suspending an account also revokes all refresh sessions', async () => {
  const queries: string[] = [];
  mock.method(pool, 'query', async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'ADMIN', status: 'ACTIVE' }] };
    if (sql.includes('UPDATE users SET status')) return { rows: [{ id: accountId, public_id: 'GOV-2', email: 'staff@example.gov', role: 'OPERATOR', status: 'SUSPENDED', created_at: '2026-10-01', updated_at: '2026-10-13' }] };
    assert.match(sql, /UPDATE refresh_tokens SET revoked = TRUE/);
    return { rows: [] };
  });
  const response = await app.inject({ method: 'PATCH', url: `/api/gov/admin/accounts/${accountId}/status`, headers: auth(), payload: { status: 'SUSPENDED' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().account.status, 'SUSPENDED');
  assert.equal(queries.length, 3);
});

async function sha256(value: string) {
  const crypto = await import('node:crypto');
  return crypto.createHash('sha256').update(value).digest('hex');
}
