import assert from 'node:assert/strict';
import { after, before, afterEach, test, mock } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import authenticatePlugin from '../src/plugins/authenticate';
import geoRoutes from '../src/routes/geo';

const citizenId = '11111111-1111-4111-8111-111111111111';
const app = Fastify();

before(async () => {
  process.env.GEOAPIFY_API_KEY = 'test-key';
  await app.register(fastifyJwt, { secret: 'geo-test-secret' });
  await app.register(authenticatePlugin);
  await app.register(geoRoutes, { prefix: '/api/geo' });
  await app.ready();
});

after(async () => {
  await app.close();
});

afterEach(() => {
  mock.restoreAll();
});

function headers() {
  return { authorization: `Bearer ${app.jwt.sign({ id: citizenId, role: 'CITIZEN' })}` };
}

function mockFetch(response: Response | Error) {
  return mock.method(globalThis, 'fetch', async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

function geoapifyResponse(features: object[]) {
  return Response.json({ features });
}

test('requires a valid token before calling Geoapify', async () => {
  const fetch = mockFetch(new Error('Geoapify must not be reached'));
  const response = await app.inject({ url: '/api/geo/search?q=Wuse' });
  assert.equal(response.statusCode, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test('rejects a query that is too short before calling Geoapify', async () => {
  const fetch = mockFetch(new Error('Geoapify must not be reached'));
  const response = await app.inject({ url: '/api/geo/search?q=a', headers: headers() });
  assert.equal(response.statusCode, 400);
  assert.equal(fetch.mock.callCount(), 0);
});

test('rejects lat without lon', async () => {
  const fetch = mockFetch(new Error('Geoapify must not be reached'));
  const response = await app.inject({
    url: '/api/geo/search?q=Wuse+2&lat=9.05',
    headers: headers(),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(fetch.mock.callCount(), 0);
});

test('restricts the search to Nigeria and applies a proximity bias', async () => {
  const fetch = mockFetch(geoapifyResponse([]));
  const response = await app.inject({
    url: '/api/geo/search?q=Wuse+2&lat=9.05&lon=7.49&limit=3',
    headers: headers(),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(fetch.mock.callCount(), 1);
  const requestedUrl = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(requestedUrl.searchParams.get('text'), 'Wuse 2');
  assert.equal(requestedUrl.searchParams.get('filter'), 'countrycode:ng');
  assert.equal(requestedUrl.searchParams.get('limit'), '3');
  assert.equal(requestedUrl.searchParams.get('bias'), 'proximity:7.49,9.05');
  assert.equal(requestedUrl.searchParams.get('apiKey'), 'test-key');
});

test('maps Geoapify suggestions into the response shape', async () => {
  mockFetch(geoapifyResponse([
    {
      properties: {
        place_id: 'p1',
        formatted: 'Wuse 2, Abuja, Nigeria',
        address_line2: 'Abuja, Nigeria',
        lat: 9.0765,
        lon: 7.4512,
        category: 'commercial.shopping_mall',
      },
    },
  ]));
  const response = await app.inject({ url: '/api/geo/search?q=Wuse+2', headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    results: [{
      id: 'p1',
      label: 'Wuse 2, Abuja, Nigeria',
      address: 'Abuja, Nigeria',
      latitude: 9.0765,
      longitude: 7.4512,
      category: 'commercial.shopping_mall',
    }],
  });
});

test('upstream failures return 503 without leaking details', async () => {
  mockFetch(new Error('network down'));
  const response = await app.inject({ url: '/api/geo/search?q=Wuse+2', headers: headers() });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'Location search is temporarily unavailable' });
});

test('missing API key configuration returns 500 without leaking details', async () => {
  const fetch = mockFetch(new Error('Geoapify must not be reached'));
  delete process.env.GEOAPIFY_API_KEY;
  try {
    const response = await app.inject({ url: '/api/geo/search?q=Wuse+2', headers: headers() });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal Server Error' });
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    process.env.GEOAPIFY_API_KEY = 'test-key';
  }
});
