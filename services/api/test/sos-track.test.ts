import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

const { default: sosTrackRoutes } = await import('../src/routes/sos-track');
const { pool } = await import('../src/db');

const app = Fastify({ logger: false });
before(async () => {
  await app.register(sosTrackRoutes);
  await app.ready();
});
after(async () => { await app.close(); await pool.end(); });
afterEach(() => mock.restoreAll());

const token = 'AbCdEfGhIjKlMnOpQrStUv';
const alertId = '44444444-4444-4444-8444-444444444444';
const recordedAt = new Date(Date.now() - 3 * 60_000);
const createdAt = new Date(Date.now() - 30 * 60_000);

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: alertId, emergency_type: 'MEDICAL', status: 'ACTIVE',
    created_at: createdAt, resolved_at: null, updates_stopped_at: null,
    full_name: 'Ada Obi',
    ...overrides,
  };
}

/** Fakes the two lookups; records every statement. */
function fakeDb(alert: Record<string, unknown> | null) {
  const sql: { text: string; params: unknown[] }[] = [];
  mock.method(pool, 'query', (async (text: string, params: unknown[] = []) => {
    sql.push({ text, params });
    if (text.includes('FROM sos_alerts')) return { rows: alert ? [alert] : [] };
    if (text.includes('FROM sos_location_updates')) {
      return { rows: [{ latitude: 6.6063, longitude: 3.3515, accuracy: 9.5, recorded_at: recordedAt }] };
    }
    throw new Error(`unexpected query: ${text}`);
  }) as any);
  return sql;
}

const track = () => app.inject({ method: 'GET', url: `/api/sos/track/${token}` });

test('an active alert shows the latest reported position and nothing private', async () => {
  const sql = fakeDb(alertRow());
  const response = await track();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    type: 'MEDICAL',
    typeLabel: 'Medical',
    status: 'ACTIVE',
    firstName: 'Ada',
    startedAt: createdAt.toISOString(),
    resolvedAt: null,
    sharingEnded: false,
    latest: { lat: 6.6063, lon: 3.3515, accuracy: 9.5, recordedAt: recordedAt.toISOString() },
  });
  assert.doesNotMatch(response.body, /Obi|phone|note|\+234/);
  assert.deepEqual(sql[0].params, [token]);
  assert.match(sql[1].text, /ORDER BY recorded_at DESC LIMIT 1/);
});

test('a resolved alert stops showing where the citizen is', async () => {
  const sql = fakeDb(alertRow({ status: 'RESOLVED', resolved_at: new Date() }));
  const body = (await track()).json();
  assert.equal(body.status, 'RESOLVED');
  assert.equal(body.sharingEnded, true);
  assert.equal(body.latest, null);
  assert.equal(sql.filter((q) => q.text.includes('sos_location_updates')).length, 0);
});

test('stopped or six-hour-old alerts stop showing a position too', async () => {
  for (const overrides of [
    { updates_stopped_at: new Date() },
    { created_at: new Date(Date.now() - 7 * 3_600_000) },
  ]) {
    mock.restoreAll();
    fakeDb(alertRow(overrides));
    const body = (await track()).json();
    assert.equal(body.status, 'ACTIVE');
    assert.equal(body.sharingEnded, true);
    assert.equal(body.latest, null);
  }
});

test('unknown and malformed tokens are 404 without leaking anything', async () => {
  fakeDb(null);
  assert.equal((await track()).statusCode, 404);
  mock.restoreAll();
  const sql = fakeDb(alertRow());
  for (const bad of ['short', 'AbCdEfGhIjKlMnOpQrStUv1', "AbCdEfGhIjKlMnOpQrSt'v"]) {
    assert.equal((await app.inject({ method: 'GET', url: `/api/sos/track/${encodeURIComponent(bad)}` })).statusCode, 404, bad);
  }
  assert.equal(sql.length, 0);
});

test('tracking responses are private: never cached, indexed or referred', async () => {
  fakeDb(alertRow());
  for (const url of [`/api/sos/track/${token}`, `/t/${token}`]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.headers['cache-control'], 'no-store', url);
    assert.equal(response.headers['referrer-policy'], 'no-referrer', url);
    assert.match(String(response.headers['x-robots-tag']), /noindex/, url);
  }
});

test('the page embeds the token and is locked down by a nonce-based CSP', async () => {
  const response = await app.inject({ method: 'GET', url: `/t/${token}` });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /^text\/html/);
  assert.match(response.body, new RegExp(`var token = "${token}"`));
  const csp = String(response.headers['content-security-policy']);
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce);
  assert.equal(response.body.split(`nonce="${nonce}"`).length - 1, 2);
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});

test('a malformed page token renders the not-found state', async () => {
  const response = await app.inject({ method: 'GET', url: '/t/nope' });
  assert.equal(response.statusCode, 404);
  assert.match(response.body, /var token = null/);
});

test('the tracking routes are rate limited per address', async () => {
  const limited = Fastify({ logger: false });
  await limited.register(rateLimit, { global: false });
  await limited.register(sosTrackRoutes);
  await limited.ready();
  fakeDb(null);
  try {
    const codes = [];
    for (let i = 0; i < 61; i++) {
      codes.push((await limited.inject({ method: 'GET', url: `/api/sos/track/${token}` })).statusCode);
    }
    assert.equal(codes[59], 404);
    assert.equal(codes[60], 429);
  } finally {
    await limited.close();
  }
});
