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
      review: 'pending', assignment: 'AI', location: 'missing',
    });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    assert.equal(init?.cache, 'no-store');
    return new Response(JSON.stringify({ total: 24, clusters: [] }));
  });
  await api.login('operator@example.gov', 'password');
  assert.equal((await api.clusters({ page: 2, limit: 50, q: 'flood & %_', status: 'IN_PROGRESS', category: 'FLOODING',
    review: 'pending', assignment: 'AI', location: 'missing' })).total, 24);
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

test('cluster compilation uses an authenticated escaped route', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    assert.equal(String(url), '/api/gov/issue-clusters/a%2Fb/compilation');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return new Response(JSON.stringify({ liveDraft: true, findings: [] }));
  });
  await api.login('operator@example.gov', 'password');
  assert.equal((await api.clusterCompilation('a/b')).liveDraft, true);
});

test('cluster PDF download returns a blob from the authenticated escaped route', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    assert.equal(String(url), '/api/gov/issue-clusters/a%2Fb/report.pdf');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      { headers: { 'Content-Type': 'application/pdf' } });
  });
  await api.login('operator@example.gov', 'password');
  const pdf = await api.clusterReportPdf('a/b');
  assert.equal(pdf.type, 'application/pdf');
  assert.equal(await pdf.text(), '%PDF-1.4');
});

test('review queue client sends bounded filters on the authenticated route', async () => {
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    const parsed = new URL(String(url), 'https://civic.example');
    assert.equal(parsed.pathname, '/api/gov/issue-clusters/review-queue');
    assert.deepEqual(Object.fromEntries(parsed.searchParams), {
      page: '2', limit: '50', status: 'PENDING', reason: 'LOW_SCORE', category: 'FLOODING', q: 'a & b',
    });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return new Response(JSON.stringify({ total: 51, items: [] }));
  });
  await api.login('operator@example.gov', 'password');
  assert.equal((await api.reviewQueue({ page: 2, limit: 50, status: 'PENDING', reason: 'LOW_SCORE',
    category: 'FLOODING', q: 'a & b' })).total, 51);
});

test('review actions post escaped, reason-bearing bodies to the authenticated routes', async () => {
  const calls: Array<{ url: string; method?: string; body: unknown; auth: string | null }> = [];
  const api = new GovernmentApi(() => {}, async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify({ ...session, user: { id: 'admin', role: 'ADMIN' } }));
    calls.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('Authorization') });
    return new Response(JSON.stringify({ action: { id: 'a', type: 'MOVE_REPORT', reason: 'why', createdAt: 'now' }, clusters: [] }));
  });
  await api.login('admin@example.gov', 'password');
  await api.approveProposal('r/1', 'c?1', 'same drain');
  await api.dismissProposal('r1', 'c1', 'different street');
  await api.moveReport('c/1', 'r1', 'c2', 'same issue');
  await api.removeReport('c1', 'r1', 'unrelated');
  await api.mergeClusters('c1', 'c2', 'duplicates');
  await api.splitCluster('c1', ['r1', 'r2'], 'two issues');
  assert.deepEqual(calls.map(call => [call.url, call.body]), [
    ['/api/gov/issue-clusters/review-queue/r%2F1/c%3F1/approve', { reason: 'same drain' }],
    ['/api/gov/issue-clusters/review-queue/r1/c1/dismiss', { reason: 'different street' }],
    ['/api/gov/issue-clusters/c%2F1/reports/r1/move', { targetClusterId: 'c2', reason: 'same issue' }],
    ['/api/gov/issue-clusters/c1/reports/r1/remove', { reason: 'unrelated' }],
    ['/api/gov/issue-clusters/c1/merge', { sourceClusterId: 'c2', reason: 'duplicates' }],
    ['/api/gov/issue-clusters/c1/split', { reportIds: ['r1', 'r2'], reason: 'two issues' }],
  ]);
  assert.ok(calls.every(call => call.method === 'POST' && call.auth === 'Bearer access'));
});

test('review actions surface server refusals and review history is paginated', async () => {
  const api = new GovernmentApi(() => {}, async (url) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(session));
    if (String(url).includes('review-actions')) {
      assert.equal(String(url), '/api/gov/issue-clusters/c%2F1/review-actions?page=2&limit=10');
      return new Response(JSON.stringify({ total: 11, actions: [] }));
    }
    return new Response(JSON.stringify({ error: 'This proposal has already been reviewed' }), { status: 409 });
  });
  await api.login('operator@example.gov', 'password');
  await assert.rejects(api.approveProposal('r1', 'c1', 'x'), /already been reviewed/);
  assert.equal((await api.reviewHistory('c/1', 2, 10)).total, 11);
});
