import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';

const { processOneSms, SMS_RETRIES_MS } = await import('../src/notifications/sms_worker');
const { pool } = await import('../src/db');

const logger = { error() {}, info() {}, warn() {} } as any;
const saved = { ...process.env };

beforeEach(() => {
  process.env.SMS_PROVIDER = 'termii';
  process.env.TERMII_API_KEY = 'termii-test-key';
  process.env.TERMII_SENDER_ID = 'CivicAI';
  process.env.TERMII_CHANNEL = 'dnd';
  delete process.env.TERMII_BASE_URL;
});
afterEach(() => { mock.restoreAll(); process.env = { ...saved }; });
after(async () => { await pool.end(); });

const job = { id: 'del-1', phone_e164: '+2348055551234', body: 'SOS from Ada Obi via CivicAI', kind: 'ALERT' };

/** Fakes the claim transaction and records the follow-up status update. */
function queue(rows: object[]) {
  const claim: string[] = [];
  mock.method(pool, 'connect', (async () => ({
    async query(sql: string) {
      claim.push(sql.trim().split(/\s+/)[0]);
      return { rows: sql.includes('SELECT id, phone_e164') ? rows : [] };
    },
    release() {},
  })) as any);
  const updates = mock.method(pool, 'query', (async () => ({ rows: [], rowCount: 1 })) as any);
  return { claim, updates };
}

test('an empty queue sends nothing', async () => {
  const { updates } = queue([]);
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not send'); });
  assert.equal(await processOneSms(logger), false);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(updates.mock.callCount(), 0);
});

test('a queued SMS is sent through Termii and marked sent', async () => {
  const { claim, updates } = queue([{ ...job, attempt_count: 0 }]);
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ message_id: '9122821270554876574', message: 'Successfully Sent' }));

  assert.equal(await processOneSms(logger), true);
  assert.deepEqual(claim, ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);

  const [url, init] = fetch.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(url, 'https://v3.api.termii.com/api/sms/send');
  assert.deepEqual(JSON.parse(String(init.body)), {
    api_key: 'termii-test-key', to: '2348055551234', from: 'CivicAI',
    sms: job.body, type: 'plain', channel: 'dnd',
  });
  const [sql, params] = updates.mock.calls[0].arguments as [string, unknown[]];
  assert.match(sql, /status = 'SENT'/);
  assert.deepEqual(params, ['del-1', '9122821270554876574']);
});

test('a provider outage is retried with backoff', async () => {
  const { updates } = queue([{ ...job, attempt_count: 0 }]);
  mock.method(globalThis, 'fetch', async () => new Response('busy', { status: 503 }));
  await processOneSms(logger);
  assert.deepEqual((updates.mock.calls[0].arguments as [string, unknown[]])[1],
    ['del-1', 'PENDING', 'SMS_HTTP_503', SMS_RETRIES_MS[0]]);
});

test('a network failure is retried too', async () => {
  const { updates } = queue([{ ...job, attempt_count: 2 }]);
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await processOneSms(logger);
  assert.deepEqual((updates.mock.calls[0].arguments as [string, unknown[]])[1],
    ['del-1', 'PENDING', 'SMS_NETWORK', SMS_RETRIES_MS[2]]);
});

test('a rejected request fails immediately', async () => {
  const { updates } = queue([{ ...job, attempt_count: 0 }]);
  mock.method(globalThis, 'fetch', async () => new Response('bad sender id', { status: 400 }));
  await processOneSms(logger);
  assert.deepEqual((updates.mock.calls[0].arguments as [string, unknown[]])[1], ['del-1', 'FAILED', 'SMS_HTTP_400', 0]);
});

test('the final attempt fails instead of retrying again', async () => {
  const { updates } = queue([{ ...job, attempt_count: SMS_RETRIES_MS.length }]);
  mock.method(globalThis, 'fetch', async () => new Response('busy', { status: 503 }));
  await processOneSms(logger);
  assert.equal((updates.mock.calls[0].arguments as [string, unknown[]])[1][1], 'FAILED');
});

function useTwilio(from = '+15005550006') {
  process.env.SMS_PROVIDER = 'twilio';
  process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
  process.env.TWILIO_AUTH_TOKEN = 'twilio-test-token';
  process.env.TWILIO_FROM = from;
  delete process.env.TWILIO_BASE_URL;
}

test('a queued SMS is sent through Twilio and marked sent', async () => {
  useTwilio();
  const { updates } = queue([{ ...job, attempt_count: 0 }]);
  const fetch = mock.method(globalThis, 'fetch', async () =>
    Response.json({ sid: 'SM1234567890abcdef1234567890abcdef', status: 'queued' }, { status: 201 }));

  assert.equal(await processOneSms(logger), true);

  const [url, init] = fetch.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json');
  assert.equal(init.method, 'POST');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(headers.Authorization,
    `Basic ${Buffer.from('AC00000000000000000000000000000000:twilio-test-token').toString('base64')}`);
  // Twilio takes the number with its leading +, unlike Termii.
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init.body))),
    { To: '+2348055551234', Body: job.body, From: '+15005550006' });

  const [sql, params] = updates.mock.calls[0].arguments as [string, unknown[]];
  assert.match(sql, /status = 'SENT'/);
  assert.deepEqual(params, ['del-1', 'SM1234567890abcdef1234567890abcdef']);
});

test('a Twilio Messaging Service SID is sent as MessagingServiceSid', async () => {
  useTwilio('MG0123456789abcdef0123456789abcdef');
  queue([{ ...job, attempt_count: 0 }]);
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ sid: 'SM1' }, { status: 201 }));
  await processOneSms(logger);
  const body = new URLSearchParams(String((fetch.mock.calls[0].arguments[1] as RequestInit).body));
  assert.equal(body.get('MessagingServiceSid'), 'MG0123456789abcdef0123456789abcdef');
  assert.equal(body.get('From'), null);
});

test('a Twilio rejection fails immediately with Twilio\'s error code', async () => {
  useTwilio();
  const { updates } = queue([{ ...job, attempt_count: 0 }]);
  mock.method(globalThis, 'fetch', async () => Response.json(
    { code: 21608, message: 'The number is unverified. Trial accounts cannot send messages to unverified numbers', status: 400 },
    { status: 400 }));
  await processOneSms(logger);
  assert.deepEqual((updates.mock.calls[0].arguments as [string, unknown[]])[1], ['del-1', 'FAILED', 'SMS_TWILIO_21608', 0]);
});

test('Twilio rate limiting is retried', async () => {
  useTwilio();
  const { updates } = queue([{ ...job, attempt_count: 0 }]);
  mock.method(globalThis, 'fetch', async () => Response.json({ code: 20429, message: 'Too Many Requests' }, { status: 429 }));
  await processOneSms(logger);
  assert.deepEqual((updates.mock.calls[0].arguments as [string, unknown[]])[1],
    ['del-1', 'PENDING', 'SMS_TWILIO_20429', SMS_RETRIES_MS[0]]);
});

test('Twilio without all of its settings counts as no provider', async () => {
  useTwilio();
  delete process.env.TWILIO_AUTH_TOKEN;
  process.env.NODE_ENV = 'production';
  const { updates } = queue([{ ...job, attempt_count: 0 }]);
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not send'); });
  await processOneSms(logger);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual((updates.mock.calls[0].arguments as [string, unknown[]])[1], ['del-1', 'FAILED', 'SMS_NOT_CONFIGURED', 0]);
});

test('without a provider, a leftover queued text fails rather than pretending, in any environment', async () => {
  for (const env of ['development', 'production']) {
    mock.restoreAll();
    delete process.env.SMS_PROVIDER;
    process.env.NODE_ENV = env;
    const { updates } = queue([{ ...job, attempt_count: 0 }]);
    const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('must not send'); });
    await processOneSms(logger);
    assert.equal(fetch.mock.callCount(), 0, env);
    assert.deepEqual((updates.mock.calls[0].arguments as [string, unknown[]])[1], ['del-1', 'FAILED', 'SMS_NOT_CONFIGURED', 0], env);
  }
});
