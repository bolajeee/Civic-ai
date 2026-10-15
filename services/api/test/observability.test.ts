import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import Fastify from 'fastify';

process.env.METRICS_TOKEN = 'metrics-test-token';
const { default: observabilityRoutes } = await import('../src/routes/observability');
const { pool } = await import('../src/db');
const app = Fastify({ logger: false });

before(async () => {
  await app.register(observabilityRoutes);
  await app.ready();
});

after(async () => {
  await app.close();
  await pool.end();
});

test('liveness responds without touching the database and returns a request id', async () => {
  const query = mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  try {
    const response = await app.inject({ url: '/api/health/live' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'ok');
    assert.ok(response.headers['x-request-id']);
    assert.equal(query.mock.callCount(), 0);
  } finally { query.mock.restore(); }
});

test('readiness reflects database availability without leaking errors', async () => {
  const query = mock.method(pool, 'query', async () => ({ rows: [{ value: 1 }] }));
  try {
    const ready = await app.inject({ url: '/api/health/ready' });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: 'ready', database: 'ok' });
  } finally { query.mock.restore(); }

  const failingQuery = mock.method(pool, 'query', async () => { throw new Error('private details'); });
  try {
    const unavailable = await app.inject({ url: '/api/health/ready' });
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.json(), { status: 'not_ready', database: 'unavailable' });
    assert.doesNotMatch(unavailable.body, /private details/);
  } finally { failingQuery.mock.restore(); }
});

test('metrics require a bearer token and use Prometheus text format', async () => {
  assert.equal((await app.inject({ url: '/api/metrics' })).statusCode, 401);
  const response = await app.inject({
    url: '/api/metrics',
    headers: { authorization: 'Bearer metrics-test-token' },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /text\/plain/);
  assert.match(response.body, /civicai_http_requests_total/);
  assert.match(response.body, /civicai_process_resident_memory_bytes/);
});
