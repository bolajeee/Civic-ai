import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GovernmentApi } from '../src/api';

const session = { accessToken: 'access', refreshToken: 'refresh', user: { id: 'operator', role: 'OPERATOR' } };

test('clusters client encodes filters and keeps zero-free pagination values', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    const parsed = new URL(String(url), 'https://civic.example');
    assert.equal(parsed.pathname, '/api/gov/issue-clusters/');
    assert.deepEqual(Object.fromEntries(parsed.searchParams), {
      page: '2', limit: '50', q: 'flood & %_', status: 'IN_PROGRESS', category: 'FLOODING',
    });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    assert.equal(init?.cache, 'no-store');
    return new Response(JSON.stringify({ total: 24, clusters: [] }));
  });
  await api.login('operator@example.gov', 'password');
  assert.equal((await api.clusters({ page: 2, limit: 50, q: 'flood & %_', status: 'IN_PROGRESS', category: 'FLOODING' })).total, 24);
});

test('cluster summary uses an authenticated escaped route', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    assert.equal(String(url), '/api/gov/issue-clusters/a%2Fb%3Fcluster');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return new Response(JSON.stringify({ cluster: { publicId: 'IC-1000' } }));
  });
  await api.login('operator@example.gov', 'password');
  assert.equal((await api.cluster('a/b?cluster')).cluster.publicId, 'IC-1000');
});

test('cluster evidence uses bounded pagination on the authenticated route', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    assert.equal(String(url), '/api/gov/issue-clusters/a%2Fb/evidence?page=3&limit=20');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return new Response(JSON.stringify({ total: 41, reports: [] }));
  });
  await api.login('operator@example.gov', 'password');
  assert.equal((await api.clusterEvidence('a/b', 3, 20)).total, 41);
});
