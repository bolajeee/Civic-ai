import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GovernmentApi } from '../src/api';

const session = { accessToken: 'access', refreshToken: 'refresh', user: { id: 'operator', role: 'OPERATOR' } };
test('reports client encodes search, date filters and pagination without dropping numeric values', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    const parsed = new URL(String(url), 'https://civic.example');
    assert.equal(parsed.pathname, '/api/gov/reports/');
    assert.deepEqual(Object.fromEntries(parsed.searchParams), { page: '2', limit: '20', q: 'pothole & %_',
      category: 'POTHOLE', grouping: 'unassigned', location: 'missing', from: '2026-10-01', to: '2026-10-07' });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    assert.equal(init?.cache, 'no-store');
    return new Response(JSON.stringify({ total: 42, reports: [] }));
  });
  await api.login('operator@example.gov', 'password');
  assert.equal((await api.reports({ page: 2, limit: 20, q: 'pothole & %_', category: 'POTHOLE', status: '',
    grouping: 'unassigned', location: 'missing', from: '2026-10-01', to: '2026-10-07' })).total, 42);
});

test('details use the authenticated government route and escape path input', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    assert.equal(String(url), '/api/gov/reports/a%2Fb%3Ftest');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return new Response(JSON.stringify({ report: { publicId: 'CR-1', photos: [] } }));
  });
  await api.login('operator@example.gov', 'password');
  assert.equal((await api.report('a/b?test')).report.publicId, 'CR-1');
});
