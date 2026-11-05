import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import routes from '../src/routes/gov-cluster-actions';
import { pool } from '../src/db';

const app = Fastify();
const base = '/api/gov/issue-clusters';
const userId = '22222222-2222-4222-8222-222222222222';
const clusterA = '33333333-3333-4333-8333-333333333333';
const clusterB = '44444444-4444-4444-8444-444444444444';
const clusterC = '66666666-6666-4666-8666-666666666666';
const reportId = '55555555-5555-4555-8555-555555555555';
const reportId2 = '77777777-7777-4777-8777-777777777777';
const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ id: userId, role: 'ADMIN' })}` });

type Row = Record<string, unknown>;
const cluster = (id: string, over: Row = {}) => ({
  id, public_id: `IC-${id.slice(0, 2)}`, category_id: 'cat', status: 'PENDING', report_count: 2, ...over });

/** A fake pooled client: `handlers` pick rows by SQL fragment; every statement is recorded. */
function fakeClient(handlers: Array<[RegExp, (values?: unknown[]) => Row[]]>) {
  const log: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      log.push({ sql, values });
      const handler = handlers.find(([pattern]) => pattern.test(sql));
      return { rows: handler ? handler[1](values) : [], rowCount: 0 };
    },
    release: () => { log.push({ sql: 'RELEASE' }); },
  };
  mock.method(pool, 'connect', async () => client);
  return log;
}
const asAdmin = (role = 'ADMIN') => mock.method(pool, 'query', async (sql: string) => {
  if (sql.startsWith('SELECT role, status')) return { rows: [{ role, status: 'ACTIVE' }] };
  throw new Error(`Unexpected query: ${sql}`);
});
const statements = (log: Array<{ sql: string }>) => log.map(entry => entry.sql.trim().split(/\s+/)[0]);

before(async () => {
  await app.register(jwt, { secret: 'cluster-actions-test-secret' });
  await app.register(authenticate);
  await app.register(routes, { prefix: base });
  await app.ready();
});
afterEach(() => mock.restoreAll());
after(async () => { await app.close(); await pool.end(); });

const mutations: Array<[string, string, object]> = [
  [`${base}/review-queue/${reportId}/${clusterB}/approve`, 'approve', { reason: 'Same drain' }],
  [`${base}/review-queue/${reportId}/${clusterB}/dismiss`, 'dismiss', { reason: 'Different street' }],
  [`${base}/${clusterA}/reports/${reportId}/move`, 'move', { targetClusterId: clusterB, reason: 'Same issue' }],
  [`${base}/${clusterA}/reports/${reportId}/remove`, 'remove', { reason: 'Unrelated' }],
  [`${base}/${clusterA}/merge`, 'merge', { sourceClusterId: clusterB, reason: 'Duplicates' }],
  [`${base}/${clusterA}/split`, 'split', { reportIds: [reportId], reason: 'Two issues' }],
];

test('every review action requires authentication before database access', async () => {
  const db = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  const connect = mock.method(pool, 'connect', async () => { throw new Error('Unexpected connect'); });
  for (const [url, , payload] of mutations) {
    const response = await app.inject({ method: 'POST', url, payload });
    assert.equal(response.statusCode, 401, url);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(db.mock.callCount(), 0);
  assert.equal(connect.mock.callCount(), 0);
});

test('operators and stale admin tokens cannot change grouping', async () => {
  for (const role of ['OPERATOR', 'CITIZEN']) {
    asAdmin(role);
    const connect = mock.method(pool, 'connect', async () => { throw new Error('Unexpected connect'); });
    for (const [url, , payload] of mutations) {
      const response = await app.inject({ method: 'POST', url, headers: headers(), payload });
      assert.equal(response.statusCode, 403, `${role} ${url}`);
    }
    assert.equal(connect.mock.callCount(), 0);
    mock.restoreAll();
  }
});

test('a reason is required and bodies are strict', async () => {
  asAdmin();
  const connect = mock.method(pool, 'connect', async () => { throw new Error('Unexpected connect'); });
  for (const [url, , payload] of mutations) {
    for (const bad of [{ ...payload, reason: '   ' }, { ...payload, reason: 'x'.repeat(1001) }, { ...payload, extra: 1 },
      Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'reason'))]) {
      const response = await app.inject({ method: 'POST', url, headers: headers(), payload: bad });
      assert.equal(response.statusCode, 400, `${url} ${JSON.stringify(bad)}`);
    }
  }
  assert.equal((await app.inject({ method: 'POST', url: `${base}/not-a-uuid/merge`, headers: headers(),
    payload: { sourceClusterId: clusterB, reason: 'x' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${clusterA}/split`, headers: headers(),
    payload: { reportIds: [], reason: 'x' } })).statusCode, 400);
  assert.equal(connect.mock.callCount(), 0);
});

test('approve moves the report, resolves proposals and records reviewer and reason in one transaction', async () => {
  asAdmin();
  const log = fakeClient([
    [/FROM issue_cluster_review_candidates review JOIN/, () => [{ status: 'PENDING', category_id: 'cat', public_id: 'RPT-1' }]],
    [/FROM issue_cluster_reports WHERE report_id/, () => [{ issue_cluster_id: clusterA }]],
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA), cluster(clusterB)]],
    [/INSERT INTO issue_cluster_review_actions/, () => [{ id: 'action-1', createdAt: '2026-10-14T10:00:00Z' }]],
    [/SELECT id, public_id AS "publicId"/, () => [{ id: clusterA, publicId: 'IC-A', reportCount: 1 }, { id: clusterB, publicId: 'IC-B', reportCount: 3 }]],
  ]);
  const response = await app.inject({ method: 'POST', url: mutations[0][0], headers: headers(), payload: { reason: '  Same drain  ' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().action.type, 'APPROVE_CANDIDATE');
  assert.equal(response.json().action.reason, 'Same drain');
  const order = statements(log);
  assert.equal(order[0], 'BEGIN');
  assert.equal(order.at(-2), 'COMMIT');
  assert.equal(order.at(-1), 'RELEASE');
  assert.match(log[1].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(log[1].values, [61005, 1]);
  const assign = log.find(entry => /SET issue_cluster_id = \$2, assignment_method = 'HUMAN'/.test(entry.sql))!;
  assert.deepEqual(assign.values, [[reportId], clusterB]);
  const resolve = log.find(entry => /review_reason = \$4/.test(entry.sql) && /ANY\(\$1/.test(entry.sql))!;
  assert.deepEqual(resolve.values, [[reportId], clusterB, userId, 'Same drain']);
  const audit = log.find(entry => /INSERT INTO issue_cluster_review_actions/.test(entry.sql))!;
  assert.deepEqual(audit.values!.slice(0, 5), ['APPROVE_CANDIDATE', userId, 'Same drain', clusterB, clusterA]);
});

test('approve refuses reviewed, missing, cross-category, closed and empty targets and rolls back', async () => {
  const cases: Array<[string, Row[] | null, Row[], number, RegExp]> = [
    ['missing proposal', [], [], 404, /not found/],
    ['already reviewed', [{ status: 'ACCEPTED', category_id: 'cat', public_id: 'R' }], [], 409, /already been reviewed/],
    ['different category', [{ status: 'PENDING', category_id: 'cat', public_id: 'R' }], [cluster(clusterA), cluster(clusterB, { category_id: 'other' })], 409, /different category/],
    ['closed target', [{ status: 'PENDING', category_id: 'cat', public_id: 'R' }], [cluster(clusterA), cluster(clusterB, { status: 'RESOLVED' })], 409, /not open/],
    ['empty target', [{ status: 'PENDING', category_id: 'cat', public_id: 'R' }], [cluster(clusterA), cluster(clusterB, { report_count: 0 })], 409, /no reports/],
  ];
  for (const [name, candidate, clusters, status, message] of cases) {
    asAdmin();
    const log = fakeClient([
      [/FROM issue_cluster_review_candidates review JOIN/, () => candidate ?? []],
      [/FROM issue_cluster_reports WHERE report_id/, () => [{ issue_cluster_id: clusterA }]],
      [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => clusters],
    ]);
    const response = await app.inject({ method: 'POST', url: mutations[0][0], headers: headers(), payload: { reason: 'r' } });
    assert.equal(response.statusCode, status, name);
    assert.match(response.json().error, message, name);
    assert.ok(statements(log).includes('ROLLBACK'), name);
    assert.ok(!statements(log).includes('COMMIT'), name);
    assert.ok(!log.some(entry => /INSERT INTO issue_cluster_review_actions|SET issue_cluster_id/.test(entry.sql)), name);
    mock.restoreAll();
  }
});

test('approve refuses a report already in the proposed cluster', async () => {
  asAdmin();
  fakeClient([
    [/FROM issue_cluster_review_candidates review JOIN/, () => [{ status: 'PENDING', category_id: 'cat', public_id: 'R' }]],
    [/FROM issue_cluster_reports WHERE report_id/, () => [{ issue_cluster_id: clusterB }]],
  ]);
  const response = await app.inject({ method: 'POST', url: mutations[0][0], headers: headers(), payload: { reason: 'r' } });
  assert.equal(response.statusCode, 409);
});

test('dismiss marks only that proposal and leaves the report where it is', async () => {
  asAdmin();
  const log = fakeClient([
    [/FROM issue_cluster_review_candidates review JOIN/, () => [{ status: 'PENDING', public_id: 'RPT-1' }]],
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterB)]],
    [/INSERT INTO issue_cluster_review_actions/, () => [{ id: 'a', createdAt: 'now' }]],
  ]);
  const response = await app.inject({ method: 'POST', url: mutations[1][0], headers: headers(), payload: { reason: 'Different street' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().action.type, 'DISMISS_CANDIDATE');
  assert.ok(!log.some(entry => /issue_cluster_reports/.test(entry.sql) && /UPDATE/.test(entry.sql)));
  const update = log.find(entry => /SET status = 'DISMISSED', reviewed_by = \$3/.test(entry.sql))!;
  assert.deepEqual(update.values, [reportId, clusterB, userId, 'Different street']);
});

test('move validates membership and destination, then audits both clusters', async () => {
  asAdmin();
  const log = fakeClient([
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA), cluster(clusterB)]],
    [/FROM issue_cluster_reports m JOIN reports r/, () => [{ report_id: reportId, public_id: 'RPT-1', category_id: 'cat', location_id: null }]],
    [/INSERT INTO issue_cluster_review_actions/, () => [{ id: 'a', createdAt: 'now' }]],
  ]);
  const response = await app.inject({ method: 'POST', url: mutations[2][0], headers: headers(), payload: mutations[2][2] });
  assert.equal(response.statusCode, 200, response.body);
  const audit = log.find(entry => /INSERT INTO issue_cluster_review_actions/.test(entry.sql))!;
  assert.deepEqual(audit.values!.slice(0, 5), ['MOVE_REPORT', userId, 'Same issue', clusterA, clusterB]);
  assert.equal((await app.inject({ method: 'POST', url: mutations[2][0], headers: headers(),
    payload: { targetClusterId: clusterA, reason: 'x' } })).statusCode, 409);
});

test('move rejects a report that is not in the source cluster', async () => {
  asAdmin();
  fakeClient([[/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA), cluster(clusterB)]]]);
  const response = await app.inject({ method: 'POST', url: mutations[2][0], headers: headers(), payload: mutations[2][2] });
  assert.equal(response.statusCode, 404);
});

test('remove creates a new cluster for the report and refuses a lone report', async () => {
  asAdmin();
  const log = fakeClient([
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA)]],
    [/FROM issue_cluster_reports m JOIN reports r/, () => [{ report_id: reportId, public_id: 'RPT-1', category_id: 'cat', location_id: 'loc-1' }]],
    [/SELECT status FROM reports/, () => [{ status: 'IN_PROGRESS' }]],
    [/INSERT INTO issue_clusters/, () => [{ id: clusterC }]],
    [/SELECT id, public_id AS "publicId"/, () => [{ id: clusterC, publicId: 'IC-NEW', reportCount: 1 }]],
    [/INSERT INTO issue_cluster_review_actions/, () => [{ id: 'a', createdAt: 'now' }]],
  ]);
  const response = await app.inject({ method: 'POST', url: mutations[3][0], headers: headers(), payload: mutations[3][2] });
  assert.equal(response.statusCode, 200, response.body);
  const create = log.find(entry => /INSERT INTO issue_clusters/.test(entry.sql))!;
  assert.deepEqual(create.values, ['cat', 'loc-1', 'IN_PROGRESS']);
  mock.restoreAll();

  asAdmin();
  const lone = fakeClient([
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA, { report_count: 1 })]],
    [/FROM issue_cluster_reports m JOIN reports r/, () => [{ report_id: reportId, public_id: 'RPT-1', category_id: 'cat', location_id: null }]],
  ]);
  const refused = await app.inject({ method: 'POST', url: mutations[3][0], headers: headers(), payload: mutations[3][2] });
  assert.equal(refused.statusCode, 409);
  assert.ok(!lone.some(entry => /INSERT INTO issue_clusters/.test(entry.sql)));
});

test('merge moves every source report into the target and validates both clusters', async () => {
  asAdmin();
  const log = fakeClient([
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA), cluster(clusterB)]],
    [/SELECT report_id FROM issue_cluster_reports/, () => [{ report_id: reportId }, { report_id: reportId2 }]],
    [/FROM issue_cluster_reports m JOIN reports r/, () => [
      { report_id: reportId, public_id: 'R1', category_id: 'cat', location_id: null },
      { report_id: reportId2, public_id: 'R2', category_id: 'cat', location_id: null }]],
    [/INSERT INTO issue_cluster_review_actions/, () => [{ id: 'a', createdAt: 'now' }]],
  ]);
  const response = await app.inject({ method: 'POST', url: mutations[4][0], headers: headers(), payload: mutations[4][2] });
  assert.equal(response.statusCode, 200, response.body);
  const assign = log.find(entry => /assignment_method = 'HUMAN'/.test(entry.sql))!;
  assert.deepEqual(assign.values, [[reportId, reportId2], clusterA]);
  assert.ok(log.some(entry => /report_count = 0/.test(entry.sql)), 'proposals into the emptied cluster are dismissed');
  mock.restoreAll();

  for (const [name, source, status] of [
    ['category', cluster(clusterB, { category_id: 'other' }), /different categories/],
    ['status', cluster(clusterB, { status: 'RESOLVED' }), /Only open/],
    ['empty', cluster(clusterB, { report_count: 0 }), /empty cluster/],
  ] as const) {
    asAdmin();
    fakeClient([[/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA), source]]]);
    const refused = await app.inject({ method: 'POST', url: mutations[4][0], headers: headers(), payload: mutations[4][2] });
    assert.equal(refused.statusCode, 409, name);
    assert.match(refused.json().error, status, name);
    mock.restoreAll();
  }
  asAdmin();
  assert.equal((await app.inject({ method: 'POST', url: mutations[4][0], headers: headers(),
    payload: { sourceClusterId: clusterA, reason: 'x' } })).statusCode, 409);
});

test('split anchors the new cluster on the earliest located report and keeps one report behind', async () => {
  asAdmin();
  const log = fakeClient([
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA, { report_count: 3, status: 'IN_PROGRESS' })]],
    [/FROM issue_cluster_reports m JOIN reports r/, () => [
      { report_id: reportId, public_id: 'R1', category_id: 'cat', location_id: null },
      { report_id: reportId2, public_id: 'R2', category_id: 'cat', location_id: 'loc-2' }]],
    [/INSERT INTO issue_clusters/, () => [{ id: clusterC }]],
    [/SELECT id, public_id AS "publicId"/, () => [{ id: clusterC, publicId: 'IC-NEW', reportCount: 2 }]],
    [/INSERT INTO issue_cluster_review_actions/, () => [{ id: 'a', createdAt: 'now' }]],
  ]);
  const response = await app.inject({ method: 'POST', url: mutations[5][0], headers: headers(),
    payload: { reportIds: [reportId, reportId2, reportId], reason: 'Two issues' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(log.find(entry => /INSERT INTO issue_clusters/.test(entry.sql))!.values, ['cat', 'loc-2', 'IN_PROGRESS']);
  assert.deepEqual(log.find(entry => /assignment_method = 'HUMAN'/.test(entry.sql))!.values, [[reportId, reportId2], clusterC]);
  mock.restoreAll();

  asAdmin();
  fakeClient([
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA, { report_count: 1 })]],
    [/FROM issue_cluster_reports m JOIN reports r/, () => [{ report_id: reportId, public_id: 'R1', category_id: 'cat', location_id: null }]],
  ]);
  const all = await app.inject({ method: 'POST', url: mutations[5][0], headers: headers(), payload: mutations[5][2] });
  assert.equal(all.statusCode, 409);
  mock.restoreAll();

  asAdmin();
  fakeClient([
    [/FROM issue_clusters\s+WHERE id = ANY[\s\S]*FOR UPDATE/, () => [cluster(clusterA)]],
    [/FROM issue_cluster_reports m JOIN reports r/, () => []],
  ]);
  const foreign = await app.inject({ method: 'POST', url: mutations[5][0], headers: headers(), payload: mutations[5][2] });
  assert.equal(foreign.statusCode, 404);
});

test('a database failure rolls back, releases the client and hides details', async () => {
  asAdmin();
  const log = fakeClient([[/FROM issue_clusters\s+WHERE id = ANY/, () => { throw new Error('secret connection detail'); }]]);
  const response = await app.inject({ method: 'POST', url: mutations[4][0], headers: headers(), payload: mutations[4][2] });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'Internal Server Error' });
  assert.deepEqual(statements(log).slice(-2), ['ROLLBACK', 'RELEASE']);
});

test('review history is readable by operators, strict and paginated', async () => {
  asAdmin('OPERATOR');
  const history = { page: 2, limit: 10, total: 11, actions: [] };
  mock.restoreAll();
  mock.method(pool, 'query', async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT role, status')) return { rows: [{ role: 'OPERATOR', status: 'ACTIVE' }] };
    assert.deepEqual(values, [clusterA, 10, 10, 2]);
    assert.doesNotMatch(sql, /email|nin\b|citizen_id/);
    return { rows: [{ history }] };
  });
  const url = `${base}/${clusterA}/review-actions`;
  const response = await app.inject({ url: `${url}?page=2&limit=10`, headers: headers() });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), history);
  for (const bad of ['limit=51', 'page=0', 'x=1']) {
    assert.equal((await app.inject({ url: `${url}?${bad}`, headers: headers() })).statusCode, 400, bad);
  }
});
