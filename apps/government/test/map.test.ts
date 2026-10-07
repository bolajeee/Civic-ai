import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GovernmentApi } from '../src/api';
import { geographicBounds } from '../src/map-utils';

test('map client encodes viewport and filters and uses government bearer authentication', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', user: { id: 'operator', role: 'OPERATOR' } }));
    const parsed = new URL(String(url), 'https://civic.example');
    assert.equal(parsed.pathname, '/api/gov/dashboard/map');
    assert.equal(parsed.searchParams.get('bbox'), '2,4,5,8');
    assert.equal(parsed.searchParams.get('layer'), 'clusters');
    assert.equal(parsed.searchParams.get('status'), 'IN_PROGRESS');
    assert.equal(parsed.searchParams.get('category'), 'POTHOLE');
    assert.equal(parsed.searchParams.get('limit'), '20');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    assert.equal(init?.cache, 'no-store');
    return new Response(JSON.stringify({ reports: { features: [] }, clusters: { features: [] } }));
  });
  await api.login('operator@example.gov', 'password');
  assert.deepEqual((await api.map({ bbox: [2, 4, 5, 8], layer: 'clusters', status: 'IN_PROGRESS', category: 'POTHOLE', limit: 20 })).clusters.features, []);
});

test('map clamps low-zoom geographic bounds without swapping longitude and latitude', () => {
  assert.deepEqual(geographicBounds(-240, -96, 240, 96), [-180, -90, 180, 90]);
  assert.deepEqual(geographicBounds(2, 4, 5, 8), [2, 4, 5, 8]);
});
