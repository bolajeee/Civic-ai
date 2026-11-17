import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import authenticatePlugin from '../src/plugins/authenticate';

process.env.GEOAPIFY_API_KEY = 'test-key';
const { default: sosRoutes } = await import('../src/routes/sos');
const { pool } = await import('../src/db');

const citizen = '11111111-1111-4111-8111-111111111111';
const contactId = '33333333-3333-4333-8333-333333333333';
const alertId = '44444444-4444-4444-8444-444444444444';
const clientAlertId = '55555555-5555-4555-8555-555555555555';
const app = Fastify({ logger: false });

before(async () => {
  await app.register(fastifyJwt, { secret: 'sos-test-secret' });
  await app.register(authenticatePlugin);
  await app.register(sosRoutes, { prefix: '/api/sos' });
  await app.ready();
});
after(async () => { await app.close(); await pool.end(); });
const savedEnv = { ...process.env };
// Most tests cover server-sent SMS; [withoutSmsProvider] switches to the
// default mode, where the citizen's phone sends the alert.
beforeEach(() => {
  process.env.SMS_PROVIDER = 'termii';
  process.env.TERMII_API_KEY = 'termii-test-key';
  process.env.TERMII_SENDER_ID = 'CivicAI';
  process.env.PUBLIC_BASE_URL = 'https://civic.example/';
});
afterEach(() => { mock.restoreAll(); process.env = { ...savedEnv }; });
const withoutSmsProvider = () => { delete process.env.SMS_PROVIDER; };
const token = 'AbCdEfGhIjKlMnOpQrStUv';

const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ id: citizen, role: 'CITIZEN' })}` });

type Call = { sql: string; params: any[] };
type Result = { rows?: any[]; rowCount?: number } | undefined;

/** Fakes pool.query and pool.connect, answering each statement via [handler]. */
function fakeDb(handler: (sql: string, params: any[]) => Result) {
  const calls: Call[] = [];
  const exec = async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/.test(sql)) return { rows: [], rowCount: 0 };
    const result = handler(sql, params) ?? {};
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
  };
  mock.method(pool, 'query', exec as any);
  mock.method(pool, 'connect', (async () => ({ query: exec, release() {} })) as any);
  const find = (pattern: RegExp) => calls.filter((call) => pattern.test(call.sql));
  return { calls, find };
}

const user = { full_name: 'Ada Obi', phone: '08031234567' };

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: alertId, public_id: 'SOS-1000', emergency_type: 'MEDICAL', status: 'ACTIVE',
    latitude: 6.6018, longitude: 3.3515, accuracy: 10, address: null, note: null,
    update_interval_minutes: 15, last_pinged_at: new Date(Date.now() - 20 * 60_000),
    last_pinged_lat: 6.6018, last_pinged_lon: 3.3515, ping_count: 1, updates_stopped_at: null,
    created_at: new Date(Date.now() - 30 * 60_000), resolved_at: null, share_token: token,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test('every SOS route requires a token before touching the database', async () => {
  const db = fakeDb(() => { throw new Error('must not query'); });
  for (const request of [
    { method: 'GET', url: '/api/sos/contacts' },
    { method: 'POST', url: '/api/sos/contacts', payload: {} },
    { method: 'PATCH', url: `/api/sos/contacts/${contactId}`, payload: {} },
    { method: 'DELETE', url: `/api/sos/contacts/${contactId}` },
    { method: 'GET', url: '/api/sos/nearby?type=MEDICAL&lat=6.6&lon=3.3' },
    { method: 'GET', url: '/api/sos/alerts/active' },
    { method: 'POST', url: '/api/sos/alerts', payload: {} },
    { method: 'POST', url: '/api/sos/alerts/SOS-1000/location', payload: {} },
    { method: 'POST', url: '/api/sos/alerts/SOS-1000/safe' },
  ] as const) {
    assert.equal((await app.inject(request)).statusCode, 401, request.url);
  }
  assert.equal(db.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

test('adding a contact normalizes the number and scopes it to the citizen', async () => {
  const db = fakeDb((sql, params) => {
    if (sql.includes('COUNT(*)')) return { rows: [{ count: 2 }] };
    if (sql.includes('FROM users')) return { rows: [user] };
    if (sql.includes('INSERT INTO trusted_contacts')) {
      return { rows: [{ id: contactId, name: params[1], phone_e164: params[2], relationship: params[3] }] };
    }
  });
  const response = await app.inject({
    method: 'POST', url: '/api/sos/contacts', headers: headers(),
    payload: { name: 'Chidi Obi', phone: '0805 555 1234', relationship: 'Brother' },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json().contact,
    { id: contactId, name: 'Chidi Obi', phone: '+2348055551234', relationship: 'Brother' });
  assert.deepEqual(db.find(/INSERT INTO trusted_contacts/)[0].params,
    [citizen, 'Chidi Obi', '+2348055551234', 'Brother']);
});

test('listing contacts says whether the server sends SMS', async () => {
  fakeDb((sql) => (sql.includes('FROM trusted_contacts')
    ? { rows: [{ id: contactId, name: 'Chidi Obi', phone_e164: '+2348055551234', relationship: null }] } : undefined));
  const withProvider = await app.inject({ method: 'GET', url: '/api/sos/contacts', headers: headers() });
  assert.equal(withProvider.json().smsEnabled, true);
  assert.equal(withProvider.json().contacts.length, 1);
  withoutSmsProvider();
  const withoutProvider = await app.inject({ method: 'GET', url: '/api/sos/contacts', headers: headers() });
  assert.equal(withoutProvider.json().smsEnabled, false);
});

test('contacts are capped at five', async () => {
  const db = fakeDb((sql) => (sql.includes('COUNT(*)') ? { rows: [{ count: 5 }] } : undefined));
  const response = await app.inject({
    method: 'POST', url: '/api/sos/contacts', headers: headers(),
    payload: { name: 'Sixth', phone: '08055551234' },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(db.find(/INSERT/).length, 0);
});

test('invalid, own and duplicate numbers are rejected', async () => {
  let duplicate = false;
  fakeDb((sql) => {
    if (sql.includes('COUNT(*)')) return { rows: [{ count: 0 }] };
    if (sql.includes('FROM users')) return { rows: [user] };
    if (sql.includes('INSERT INTO trusted_contacts') && duplicate) {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    }
  });
  const post = (phone: string) => app.inject({
    method: 'POST', url: '/api/sos/contacts', headers: headers(), payload: { name: 'X', phone },
  });
  assert.equal((await post('12345')).statusCode, 400);
  const own = await post('+234 803 123 4567');
  assert.equal(own.statusCode, 400);
  assert.match(own.json().error, /own number/);
  duplicate = true;
  assert.equal((await post('08055551234')).statusCode, 409);
});

test('editing or deleting someone else\'s contact is a 404', async () => {
  const db = fakeDb((sql) => {
    if (sql.includes('UPDATE trusted_contacts')) return { rows: [] };
    if (sql.includes('DELETE FROM trusted_contacts')) return { rowCount: 0 };
  });
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/sos/contacts/${contactId}`, headers: headers(),
    payload: { name: 'New' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/sos/contacts/${contactId}`,
    headers: headers() })).statusCode, 404);
  for (const call of db.find(/trusted_contacts/)) assert.equal(call.params[1], citizen);
});

// ---------------------------------------------------------------------------
// Help nearby
// ---------------------------------------------------------------------------

function places(features: object[]) {
  return mock.method(globalThis, 'fetch', async () => Response.json({ features }));
}

test('nearby merges curated and OSM facilities, de-duplicates and sorts by distance', async () => {
  const fetch = places([
    { properties: { place_id: 'osm-1', name: 'Ikeja General Hospital', lat: 6.6100, lon: 3.3515,
      categories: ['healthcare.hospital'], contact: { phone: '0801 000 0001; 0801 000 0002' } } },
    // Same name as the curated row and ~30 m away: a duplicate.
    { properties: { place_id: 'osm-2', name: 'Lagos State Command', lat: 6.6021, lon: 3.3515,
      categories: ['healthcare.hospital'] } },
    { properties: { place_id: 'osm-3', lat: 6.6030, lon: 3.3515, categories: ['healthcare.clinic_or_praxis'] } },
  ]);
  const db = fakeDb((sql) => {
    if (sql.includes('FROM emergency_facilities')) {
      return { rows: [{ id: 'cur-1', kind: 'HOSPITAL', agency: 'LASG', name: 'Lagos State Command',
        address: 'Alausa', phones: ['0802 000 0000'], latitude: 6.6019, longitude: 3.3515 }] };
    }
  });

  const response = await app.inject({ url: '/api/sos/nearby?type=MEDICAL&lat=6.6018&lon=3.3515', headers: headers() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.partial, false);
  assert.deepEqual(body.facilities.map((f: any) => [f.id, f.source]),
    [['cur-1', 'CURATED'], ['osm-3', 'OSM'], ['osm-1', 'OSM']]);
  assert.equal(body.facilities[1].name, 'Hospital');
  assert.deepEqual(body.facilities[2].phones, ['0801 000 0001', '0801 000 0002']);
  assert.ok(body.facilities[2].distanceMeters > 800 && body.facilities[2].distanceMeters < 1000);
  assert.equal(body.hotlines[0].number, '112');

  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.searchParams.get('categories'), 'healthcare.hospital,healthcare.clinic_or_praxis');
  assert.equal(url.searchParams.get('filter'), 'circle:3.3515,6.6018,25000');
  assert.deepEqual(db.find(/emergency_facilities/)[0].params.slice(2, 4), [['HOSPITAL'], null]);
});

test('road accidents look for FRSC among curated facilities', async () => {
  places([]);
  const db = fakeDb(() => ({ rows: [] }));
  await app.inject({ url: '/api/sos/nearby?type=ACCIDENT&lat=6.6&lon=3.3', headers: headers() });
  assert.deepEqual(db.find(/emergency_facilities/)[0].params.slice(2, 4), [['PARAMILITARY'], ['FRSC']]);
});

test('a Geoapify outage still returns curated facilities and hotlines, flagged partial', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('down', { status: 503 }));
  fakeDb((sql) => (sql.includes('FROM emergency_facilities')
    ? { rows: [{ id: 'cur-1', kind: 'POLICE', agency: 'NPF', name: 'Ikeja Division', address: null,
      phones: [], latitude: 6.6, longitude: 3.35 }] }
    : undefined));
  const response = await app.inject({ url: '/api/sos/nearby?type=SECURITY&lat=6.6&lon=3.35', headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().partial, true);
  assert.equal(response.json().facilities.length, 1);
  assert.equal(response.json().hotlines.length > 0, true);
});

test('nearby rejects a missing type or coordinates', async () => {
  fakeDb(() => { throw new Error('must not query'); });
  assert.equal((await app.inject({ url: '/api/sos/nearby?lat=6.6&lon=3.3', headers: headers() })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/sos/nearby?type=MEDICAL&lat=95&lon=3.3', headers: headers() })).statusCode, 400);
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

const alertPayload = { clientAlertId, type: 'MEDICAL', updateIntervalMinutes: 15, lat: 6.6018, lon: 3.3515, accuracy: 9 };

test('raising an alert stores it and queues one SMS per contact', async () => {
  const db = fakeDb((sql, params) => {
    if (sql.includes('WHERE client_alert_id')) return { rows: [] };
    if (sql.includes("status = 'ACTIVE' FOR UPDATE")) return { rows: [] };
    if (sql.includes('INSERT INTO sos_alerts')) return { rows: [alertRow({ last_pinged_at: new Date(), ping_count: 0 })] };
    if (sql.includes('FROM users')) return { rows: [user] };
    if (sql.includes('INSERT INTO sos_sms_deliveries')) {
      assert.equal(params[2], 'ALERT');
      return { rowCount: 2 };
    }
  });
  const response = await app.inject({ method: 'POST', url: '/api/sos/alerts', headers: headers(), payload: alertPayload });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.contactsQueued, 2);
  assert.equal(body.smsEnabled, true);
  assert.equal(body.alert.publicId, 'SOS-1000');
  assert.equal(body.alert.updateIntervalMinutes, 15);
  assert.match(body.message, /SOS from Ada Obi via CivicAI: MEDICAL emergency/);
  assert.match(body.message, /Call them: \+2348031234567/);
  assert.equal(body.alert.trackingUrl, `https://civic.example/t/${token}`);

  const insert = db.find(/INSERT INTO sos_alerts/)[0];
  assert.deepEqual(insert.params.slice(0, 5), [citizen, clientAlertId, 'MEDICAL', 6.6018, 3.3515]);
  assert.equal(insert.params[8], 15);
  assert.match(insert.params[9], /^[A-Za-z0-9_-]{22}$/);
  assert.equal(db.find(/INSERT INTO sos_location_updates/).length, 1);
  const queued = db.find(/INSERT INTO sos_sms_deliveries/)[0];
  assert.deepEqual(queued.params.slice(0, 3), [alertId, citizen, 'ALERT']);
  assert.match(queued.params[3], /maps\.google\.com\/\?q=6\.60180,3\.35150/);
  assert.match(queued.params[3], /Live location: https:\/\/civic\.example\/t\/AbCdEfGhIjKlMnOpQrStUv$/);
  assert.equal(db.find(/^COMMIT$/).length, 1);
});

test('without an SMS provider, raising queues nothing and returns the text for the phone to send', async () => {
  withoutSmsProvider();
  const db = fakeDb((sql) => {
    if (sql.includes('WHERE client_alert_id')) return { rows: [] };
    if (sql.includes("status = 'ACTIVE' FOR UPDATE")) return { rows: [] };
    if (sql.includes('INSERT INTO sos_alerts')) return { rows: [alertRow({ last_pinged_at: new Date(), ping_count: 0 })] };
    if (sql.includes('FROM users')) return { rows: [user] };
  });
  const response = await app.inject({ method: 'POST', url: '/api/sos/alerts', headers: headers(), payload: alertPayload });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.smsEnabled, false);
  assert.equal(body.contactsQueued, 0);
  assert.match(body.message, /Live location: https:\/\/civic\.example\/t\/AbCdEfGhIjKlMnOpQrStUv$/);
  assert.doesNotMatch(body.message, /Updates every/);
  assert.equal(db.find(/INSERT INTO sos_sms_deliveries/).length, 0);
});

test('the tracking link falls back to the request origin without PUBLIC_BASE_URL', async () => {
  delete process.env.PUBLIC_BASE_URL;
  fakeDb((sql) => (sql.includes("status = 'ACTIVE' LIMIT 1") ? { rows: [alertRow()] } : undefined));
  const response = await app.inject({ method: 'GET', url: '/api/sos/alerts/active', headers: headers() });
  assert.equal(response.json().alert.trackingUrl, `http://localhost:80/t/${token}`);
});

test('alerts raised before tracking links existed have none', async () => {
  fakeDb((sql) => (sql.includes("status = 'ACTIVE' LIMIT 1") ? { rows: [alertRow({ share_token: null })] } : undefined));
  const response = await app.inject({ method: 'GET', url: '/api/sos/alerts/active', headers: headers() });
  assert.equal(response.json().alert.trackingUrl, null);
});

test('retrying the same alert request returns the original without queuing again', async () => {
  const db = fakeDb((sql) => {
    if (sql.includes('WHERE client_alert_id')) return { rows: [alertRow()] };
    if (sql.includes("kind = 'ALERT'")) return { rows: [{ count: 3 }] };
  });
  const response = await app.inject({ method: 'POST', url: '/api/sos/alerts', headers: headers(), payload: alertPayload });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().contactsQueued, 3);
  assert.equal(db.find(/INSERT/).length, 0);
});

test('a second alert while one is active returns the active one', async () => {
  const db = fakeDb((sql) => {
    if (sql.includes('WHERE client_alert_id')) return { rows: [] };
    if (sql.includes("status = 'ACTIVE' FOR UPDATE")) return { rows: [alertRow({ public_id: 'SOS-999' })] };
  });
  const response = await app.inject({ method: 'POST', url: '/api/sos/alerts', headers: headers(),
    payload: { ...alertPayload, clientAlertId: '66666666-6666-4666-8666-666666666666' } });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'ALERT_ALREADY_ACTIVE');
  assert.equal(response.json().alert.publicId, 'SOS-999');
  assert.equal(db.find(/INSERT/).length, 0);
});

test('half a location or an unsupported update interval is rejected', async () => {
  fakeDb(() => { throw new Error('must not query'); });
  const bad = await app.inject({ method: 'POST', url: '/api/sos/alerts', headers: headers(),
    payload: { clientAlertId, type: 'FIRE', lat: 6.6 } });
  assert.equal(bad.statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/sos/alerts', headers: headers(),
    payload: { ...alertPayload, updateIntervalMinutes: 5 } })).statusCode, 400);
});

// ---------------------------------------------------------------------------
// Location updates
// ---------------------------------------------------------------------------

/** Runs one location update against [alert]; returns the response and DB. */
async function postLocation(alert: Record<string, unknown>, to: { lat: number; lon: number }) {
  const db = fakeDb((sql) => {
    if (sql.includes('WHERE public_id')) return { rows: [alert] };
    if (sql.includes('INSERT INTO sos_location_updates')) return { rows: [{ id: 'upd-1' }] };
    if (sql.includes('FROM users')) return { rows: [user] };
    if (sql.includes('INSERT INTO sos_sms_deliveries')) return { rowCount: 2 };
  });
  const response = await app.inject({ method: 'POST', url: '/api/sos/alerts/SOS-1000/location',
    headers: headers(), payload: { ...to, accuracy: 8 } });
  const kinds = db.find(/INSERT INTO sos_sms_deliveries/).map((call) => call.params[2]);
  return { response, db, kinds };
}

const here = { lat: 6.6018, lon: 3.3515 };
const fiftyMetres = { lat: 6.60225, lon: 3.3515 };
const fiveHundredMetres = { lat: 6.6063, lon: 3.3515 };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

test('an update before the interval is recorded without an SMS', async () => {
  const { response, db, kinds } = await postLocation(alertRow({ last_pinged_at: minutesAgo(5) }), fiveHundredMetres);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().pinged, false);
  assert.equal(response.json().stopUpdates, false);
  assert.deepEqual(kinds, []);
  assert.equal(db.find(/INSERT INTO sos_location_updates/).length, 1);
});

test('an update after the interval without moving 100 m sends nothing', async () => {
  const { response, kinds } = await postLocation(alertRow({ last_pinged_at: minutesAgo(20) }), fiftyMetres);
  assert.equal(response.json().pinged, false);
  assert.deepEqual(kinds, []);
});

test('an update after the interval having moved pings every contact', async () => {
  const { response, db, kinds } = await postLocation(alertRow({ last_pinged_at: minutesAgo(20) }), fiveHundredMetres);
  assert.equal(response.json().pinged, true);
  assert.deepEqual(kinds, ['UPDATE']);
  const bump = db.find(/UPDATE sos_alerts SET last_pinged_at/)[0];
  assert.deepEqual(bump.params, [alertId, fiveHundredMetres.lat, fiveHundredMetres.lon, 2]);
  assert.equal(db.find(/SET pinged = TRUE/).length, 1);
  assert.ok(Date.parse(response.json().nextUpdateAfter) > Date.now() + 14 * 60_000);
});

test('the 30-minute setting is honoured', async () => {
  const slow = await postLocation(alertRow({ update_interval_minutes: 30, last_pinged_at: minutesAgo(20) }), fiveHundredMetres);
  assert.equal(slow.response.json().pinged, false);
  const fast = await postLocation(alertRow({ update_interval_minutes: 15, last_pinged_at: minutesAgo(20) }), fiveHundredMetres);
  assert.equal(fast.response.json().pinged, true);
});

test('the twelfth update is sent, then updates stop with a final notice', async () => {
  const { response, kinds, db } = await postLocation(alertRow({ ping_count: 11 }), fiveHundredMetres);
  assert.equal(response.json().pinged, true);
  assert.equal(response.json().stopUpdates, true);
  assert.deepEqual(kinds, ['UPDATE', 'UPDATES_STOPPED']);
  assert.equal(db.find(/SET updates_stopped_at = NOW\(\)/).length, 1);
});

test('after six hours updates stop even without movement', async () => {
  const { response, kinds } = await postLocation(alertRow({ created_at: new Date(Date.now() - 7 * 3_600_000) }), here);
  assert.equal(response.json().stopUpdates, true);
  assert.deepEqual(kinds, ['UPDATES_STOPPED']);
});

test('without an SMS provider, a move is recorded for the tracking page but texts no one', async () => {
  withoutSmsProvider();
  const { response, db, kinds } = await postLocation(alertRow({ last_pinged_at: minutesAgo(20) }), fiveHundredMetres);
  assert.equal(response.json().pinged, false);
  assert.equal(response.json().stopUpdates, false);
  assert.deepEqual(kinds, []);
  assert.equal(db.find(/INSERT INTO sos_location_updates/).length, 1);
  assert.equal(db.find(/UPDATE sos_alerts SET last_pinged_at/).length, 0);
});

test('without an SMS provider, sharing still stops after six hours', async () => {
  withoutSmsProvider();
  const { response, db, kinds } = await postLocation(alertRow({ created_at: new Date(Date.now() - 7 * 3_600_000) }), here);
  assert.equal(response.json().stopUpdates, true);
  assert.deepEqual(kinds, []);
  assert.equal(db.find(/SET updates_stopped_at = NOW\(\)/).length, 1);
});

test('updates to an ended alert are refused and tell the phone to stop', async () => {
  const { response, kinds } = await postLocation(alertRow({ status: 'RESOLVED' }), fiveHundredMetres);
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().stopUpdates, true);
  assert.deepEqual(kinds, []);
});

// ---------------------------------------------------------------------------
// Safe
// ---------------------------------------------------------------------------

test('marking safe resolves the alert, cancels pending updates and tells contacts', async () => {
  const db = fakeDb((sql) => {
    if (sql.includes('WHERE public_id')) return { rows: [alertRow()] };
    if (sql.includes("SET status = 'RESOLVED'")) return { rows: [alertRow({ status: 'RESOLVED', resolved_at: new Date() })] };
    if (sql.includes('FROM users')) return { rows: [user] };
    if (sql.includes('INSERT INTO sos_sms_deliveries')) return { rowCount: 2 };
  });
  const response = await app.inject({ method: 'POST', url: '/api/sos/alerts/SOS-1000/safe', headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().alert.status, 'RESOLVED');
  assert.equal(response.json().smsEnabled, true);
  assert.match(response.json().message, /^Ada Obi has marked themselves safe via CivicAI/);
  assert.equal(db.find(/SET status = 'CANCELLED'/).length, 1);
  assert.deepEqual(db.find(/INSERT INTO sos_sms_deliveries/).map((c) => c.params[2]), ['SAFE']);
  assert.deepEqual(db.find(/WHERE public_id/)[0].params, ['SOS-1000', citizen]);
});

test('without an SMS provider, marking safe returns the text for the phone to send', async () => {
  withoutSmsProvider();
  const db = fakeDb((sql) => {
    if (sql.includes('WHERE public_id')) return { rows: [alertRow()] };
    if (sql.includes("SET status = 'RESOLVED'")) return { rows: [alertRow({ status: 'RESOLVED', resolved_at: new Date() })] };
    if (sql.includes('FROM users')) return { rows: [user] };
  });
  const response = await app.inject({ method: 'POST', url: '/api/sos/alerts/SOS-1000/safe', headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().smsEnabled, false);
  assert.match(response.json().message, /marked themselves safe/);
  assert.equal(db.find(/INSERT INTO sos_sms_deliveries/).length, 0);
});

test('marking safe on an unknown or ended alert changes nothing', async () => {
  fakeDb((sql) => (sql.includes('WHERE public_id') ? { rows: [] } : undefined));
  assert.equal((await app.inject({ method: 'POST', url: '/api/sos/alerts/SOS-1000/safe', headers: headers() })).statusCode, 404);
  mock.restoreAll();
  const db = fakeDb((sql) => (sql.includes('WHERE public_id') ? { rows: [alertRow({ status: 'RESOLVED' })] } : undefined));
  assert.equal((await app.inject({ method: 'POST', url: '/api/sos/alerts/SOS-1000/safe', headers: headers() })).statusCode, 409);
  assert.equal(db.find(/INSERT|UPDATE sos/).length, 0);
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

test('raising alerts is limited to five per ten minutes per citizen', async () => {
  const limited = Fastify({ logger: false });
  await limited.register(fastifyJwt, { secret: 'sos-test-secret' });
  await limited.register(rateLimit, { global: false });
  await limited.register(authenticatePlugin);
  await limited.register(sosRoutes, { prefix: '/api/sos' });
  await limited.ready();
  fakeDb(() => { throw new Error('must not query'); });
  try {
    const token = { authorization: `Bearer ${limited.jwt.sign({ id: citizen, role: 'CITIZEN' })}` };
    const codes = [];
    // Invalid bodies: counted by the limiter, rejected before any database work.
    for (let i = 0; i < 6; i++) {
      codes.push((await limited.inject({ method: 'POST', url: '/api/sos/alerts', headers: token, payload: {} })).statusCode);
    }
    assert.deepEqual(codes, [400, 400, 400, 400, 400, 429]);
  } finally {
    await limited.close();
  }
});
