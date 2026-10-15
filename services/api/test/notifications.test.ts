import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import authenticatePlugin from '../src/plugins/authenticate';

const { default: notificationRoutes } = await import('../src/routes/notifications');
const { pool } = await import('../src/db');
const app = Fastify({ logger: false });
const citizen = '11111111-1111-4111-8111-111111111111';

before(async () => {
  await app.register(fastifyJwt, { secret: 'notification-test-secret' });
  await app.register(authenticatePlugin);
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.ready();
});
after(async () => { await app.close(); await pool.end(); });
const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ id: citizen, role: 'CITIZEN' })}` });

test('notification routes reject unauthenticated requests before database access', async () => {
  const db = mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  try {
    for (const request of [
      { method: 'GET', url: '/api/notifications/' },
      { method: 'GET', url: '/api/notifications/preferences' },
      { method: 'POST', url: '/api/notifications/devices', payload: {} },
    ] as const) assert.equal((await app.inject(request)).statusCode, 401);
    assert.equal(db.mock.callCount(), 0);
  } finally { db.mock.restore(); }
});

test('device registration is strict and always scoped to the JWT citizen', async () => {
  const db = mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    assert.match(sql, /INSERT INTO citizen_push_devices/);
    assert.deepEqual(params, [citizen, 'a'.repeat(40), 'ANDROID']);
    return { rows: [], rowCount: 1 };
  });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/notifications/devices', headers: headers(),
      payload: { token: 'a'.repeat(40), platform: 'ANDROID' } });
    assert.equal(response.statusCode, 204);
    assert.equal((await app.inject({ method: 'POST', url: '/api/notifications/devices', headers: headers(),
      payload: { token: 'short', platform: 'WEB', citizenId: 'other' } })).statusCode, 400);
    assert.equal(db.mock.callCount(), 1);
  } finally { db.mock.restore(); }
});

test('preferences default on and updates cancel queued deliveries when disabled', async () => {
  const db = mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    assert.equal(params[0], citizen);
    if (sql.includes('SELECT report_updates_enabled')) return { rows: [] };
    return { rows: [], rowCount: 1 };
  });
  try {
    const current = await app.inject({ url: '/api/notifications/preferences', headers: headers() });
    assert.deepEqual(current.json(), { reportUpdatesEnabled: true });
    const updated = await app.inject({ method: 'PATCH', url: '/api/notifications/preferences', headers: headers(),
      payload: { reportUpdatesEnabled: false } });
    assert.deepEqual(updated.json(), { reportUpdatesEnabled: false });
    assert.equal(db.mock.callCount(), 3);
  } finally { db.mock.restore(); }
});

test('inbox and read mutation expose only the authenticated citizen records', async () => {
  const notificationId = '22222222-2222-4222-8222-222222222222';
  const db = mock.method(pool, 'query', async (sql: string, params: unknown[]) => {
    assert.ok(params.includes(citizen));
    if (sql.includes('SELECT n.id')) return { rows: [{ id: notificationId, kind: 'REPORT_STATUS_CHANGED',
      report_status: 'RESOLVED', title: 'Report update', body: 'CR-1 is now resolved.', data: {},
      public_id: 'CR-1', created_at: '2026-10-15T10:00:00Z', read_at: null }] };
    return { rows: [{ id: notificationId }], rowCount: 1 };
  });
  try {
    const inbox = await app.inject({ url: '/api/notifications/?limit=20', headers: headers() });
    assert.equal(inbox.statusCode, 200);
    assert.equal(inbox.json().notifications[0].publicId, 'CR-1');
    assert.equal((await app.inject({ method: 'POST', url: `/api/notifications/${notificationId}/read`, headers: headers() })).statusCode, 204);
  } finally { db.mock.restore(); }
});
