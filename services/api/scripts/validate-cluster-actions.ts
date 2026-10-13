import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import actionRoutes from '../src/routes/gov-cluster-actions';
import clusterRoutes from '../src/routes/gov-clusters';
import { pool } from '../src/db';

// Runs the real review-action SQL against PostgreSQL/PostGIS inside one outer
// transaction that is always rolled back: the audit migration and every fixture
// vanish afterwards. Route-level BEGIN/COMMIT/ROLLBACK are neutralised so the
// handlers' own transactions nest inside it.
process.env.AI_PRIORITY_ENABLED = 'false';
const app = Fastify();
const originalQuery = pool.query;
const originalConnect = pool.connect;
let client: Awaited<ReturnType<typeof originalConnect>> | undefined;
try {
  await app.register(jwt, { secret: crypto.randomBytes(32).toString('hex') });
  await app.register(authenticate);
  await app.register(clusterRoutes, { prefix: '/api/gov/issue-clusters' });
  await app.register(actionRoutes, { prefix: '/api/gov/issue-clusters' });
  await app.ready();

  client = await originalConnect.call(pool);
  const db = client;
  await db.query('BEGIN');
  pool.query = db.query.bind(db) as typeof pool.query;
  const nested = new Proxy(db, {
    get(target, prop) {
      if (prop === 'release') return () => undefined;
      if (prop === 'query') return (sql: unknown, values?: unknown[]) =>
        typeof sql === 'string' && /^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/.test(sql)
          ? Promise.resolve({ rows: [], rowCount: 0 }) : target.query(sql as string, values);
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  pool.connect = (async () => nested) as unknown as typeof pool.connect;

  await db.query(fs.readFileSync(path.resolve(process.cwd(), '../../supabase/migrations/20261014120000_add_cluster_review_actions.sql'), 'utf8'));

  const suffix = crypto.randomBytes(4).toString('hex');
  const nin = String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
  const admin = (await db.query(
    `INSERT INTO users (public_id, email, password_hash, nin, role)
     VALUES ($1, $2, 'x', $3, 'ADMIN') RETURNING id, public_id`,
    [`USR-T${suffix}`, `reviewer-${suffix}@example.test`, nin])).rows[0];
  const operator = (await db.query(
    `INSERT INTO users (public_id, email, password_hash, nin, role)
     VALUES ($1, $2, 'x', $3, 'OPERATOR') RETURNING id`,
    [`USR-O${suffix}`, `operator-${suffix}@example.test`, String(Math.floor(Math.random() * 1e11)).padStart(11, '0')])).rows[0];
  const categories = (await db.query('SELECT id FROM report_categories ORDER BY display_order, slug LIMIT 2')).rows;
  assert.equal(categories.length, 2, 'Seed at least two report categories first.');
  const [category, otherCategory] = categories.map(row => row.id as string);

  async function report(offsetMinutes: number, withLocation = true) {
    const location = withLocation ? (await db.query(
      `INSERT INTO locations (latitude, longitude, geom) VALUES (6.5, 3.4, ST_SetSRID(ST_MakePoint(3.4, 6.5), 4326))
       RETURNING id`)).rows[0].id : null;
    return (await db.query(
      `INSERT INTO reports (citizen_id, category_id, description, location_id, submitted_at)
       VALUES ($1, $2, 'fixture', $3, NOW() - ($4 * INTERVAL '1 minute')) RETURNING id, public_id`,
      [admin.id, category, location, offsetMinutes])).rows[0] as { id: string; public_id: string };
  }
  async function cluster(categoryId = category) {
    return (await db.query('INSERT INTO issue_clusters (category_id) VALUES ($1) RETURNING id', [categoryId])).rows[0].id as string;
  }
  async function join(reportId: string, clusterId: string) {
    await db.query(`INSERT INTO issue_cluster_reports (report_id, issue_cluster_id, assignment_method)
                    VALUES ($1, $2, 'SYSTEM')`, [reportId, clusterId]);
  }
  async function propose(reportId: string, clusterId: string, candidateId: string) {
    await db.query(`INSERT INTO issue_cluster_review_candidates
      (report_id, issue_cluster_id, candidate_report_id, score, scoring_version, reason)
      VALUES ($1, $2, $3, 0.7, 'v1', 'LOW_SCORE')`, [reportId, clusterId, candidateId]);
  }
  const count = async (id: string) => Number((await db.query('SELECT report_count FROM issue_clusters WHERE id = $1', [id])).rows[0].report_count);
  const clusterOf = async (reportId: string) => (await db.query('SELECT issue_cluster_id, assignment_method FROM issue_cluster_reports WHERE report_id = $1', [reportId])).rows[0];
  const proposal = async (reportId: string, clusterId: string) => (await db.query(
    'SELECT status, reviewed_by, reviewed_at, review_reason FROM issue_cluster_review_candidates WHERE report_id = $1 AND issue_cluster_id = $2', [reportId, clusterId])).rows[0];

  const [r1, r2, r3, r4] = [await report(40), await report(30), await report(20), await report(10, false)];
  const [X, Y, Z, foreign] = [await cluster(), await cluster(), await cluster(), await cluster(otherCategory)];
  await join(r1.id, X); await join(r2.id, X); await join(r3.id, Y); await join(r4.id, Z);
  await propose(r3.id, X, r1.id); await propose(r4.id, X, r1.id); await propose(r4.id, Y, r3.id);

  const headers = { authorization: `Bearer ${app.jwt.sign({ id: admin.id }, { expiresIn: '5m' })}` };
  const operatorHeaders = { authorization: `Bearer ${app.jwt.sign({ id: operator.id }, { expiresIn: '5m' })}` };
  const base = '/api/gov/issue-clusters';
  const post = (url: string, payload: object, as = headers) => app.inject({ method: 'POST', url: base + url, headers: as, payload });

  assert.equal((await post(`/review-queue/${r3.id}/${X}/approve`, { reason: 'Same drain' }, operatorHeaders)).statusCode, 403);

  // Approve: r3 leaves its singleton Y and joins X.
  let response = await post(`/review-queue/${r3.id}/${X}/approve`, { reason: 'Same blocked drain' });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual([await count(X), await count(Y)], [3, 0]);
  assert.deepEqual(await clusterOf(r3.id), { issue_cluster_id: X, assignment_method: 'HUMAN' });
  const approved = await proposal(r3.id, X);
  assert.equal(approved.status, 'ACCEPTED');
  assert.equal(approved.reviewed_by, admin.id);
  assert.equal(approved.review_reason, 'Same blocked drain');
  assert.ok(approved.reviewed_at);
  assert.equal((await proposal(r4.id, Y)).status, 'DISMISSED', 'proposal into the emptied cluster is auto-dismissed');
  assert.equal((await post(`/review-queue/${r3.id}/${X}/approve`, { reason: 'again' })).statusCode, 409);

  // Dismiss: r4 stays in Z.
  response = await post(`/review-queue/${r4.id}/${X}/dismiss`, { reason: 'Different street' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal((await proposal(r4.id, X)).status, 'DISMISSED');
  assert.equal((await clusterOf(r4.id)).issue_cluster_id, Z);

  // The queue shows who reviewed, when and why.
  const queue = await app.inject({ url: `${base}/review-queue?status=ACCEPTED`, headers });
  assert.equal(queue.statusCode, 200, queue.body);
  const item = queue.json().items.find((entry: { reportId: string }) => entry.reportId === r3.id);
  assert.equal(item.reviewedBy, admin.public_id);
  assert.equal(item.reviewReason, 'Same blocked drain');
  assert.ok(item.reviewedAt);

  // Move r3 X -> Z; refuses a different-category target and a non-member.
  assert.equal((await post(`/${X}/reports/${r3.id}/move`, { targetClusterId: foreign, reason: 'x' })).statusCode, 409);
  assert.equal((await post(`/${Y}/reports/${r3.id}/move`, { targetClusterId: Z, reason: 'x' })).statusCode, 404);
  response = await post(`/${X}/reports/${r3.id}/move`, { targetClusterId: Z, reason: 'Belongs with r4' });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual([await count(X), await count(Z)], [2, 2]);

  // Remove r3 into its own cluster; a lone report cannot be removed.
  response = await post(`/${Z}/reports/${r3.id}/remove`, { reason: 'Unrelated after all' });
  assert.equal(response.statusCode, 200, response.body);
  const N = (await clusterOf(r3.id)).issue_cluster_id as string;
  assert.notEqual(N, Z);
  assert.deepEqual([await count(Z), await count(N)], [1, 1]);
  assert.equal((await post(`/${N}/reports/${r3.id}/remove`, { reason: 'x' })).statusCode, 409);
  assert.ok((await db.query('SELECT anchor_location_id FROM issue_clusters WHERE id = $1', [N])).rows[0].anchor_location_id);

  // Merge N into X, then split r1 back out. Merging across categories is refused.
  assert.equal((await post(`/${X}/merge`, { sourceClusterId: foreign, reason: 'x' })).statusCode, 409);
  response = await post(`/${X}/merge`, { sourceClusterId: N, reason: 'Same issue' });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual([await count(X), await count(N)], [3, 0]);
  assert.equal((await post(`/${X}/split`, { reportIds: [r1.id, r2.id, r3.id], reason: 'x' })).statusCode, 409);
  response = await post(`/${X}/split`, { reportIds: [r1.id], reason: 'Separate issue' });
  assert.equal(response.statusCode, 200, response.body);
  const S = (await clusterOf(r1.id)).issue_cluster_id as string;
  assert.notEqual(S, X);
  assert.deepEqual([await count(X), await count(S)], [2, 1]);

  // Append-only audit trail with reviewer, reason and timestamp for every action.
  const audit = (await db.query(
    `SELECT action, actor_id, reason, created_at FROM issue_cluster_review_actions ORDER BY created_at, id`)).rows;
  // NOW() is fixed inside this outer transaction, so timestamps tie here; compare as a set.
  assert.deepEqual(audit.map(row => row.action).sort(), ['APPROVE_CANDIDATE', 'DISMISS_CANDIDATE', 'MERGE_CLUSTERS',
    'MOVE_REPORT', 'REMOVE_REPORT', 'SPLIT_CLUSTER']);
  assert.ok(audit.every(row => row.actor_id === admin.id && row.reason && row.created_at));
  await db.query('SAVEPOINT immutable');
  await assert.rejects(db.query(`UPDATE issue_cluster_review_actions SET reason = 'edited'`), /append-only/);
  await db.query('ROLLBACK TO SAVEPOINT immutable');
  await db.query('SAVEPOINT immutable2');
  await assert.rejects(db.query('DELETE FROM issue_cluster_review_actions'), /append-only/);
  await db.query('ROLLBACK TO SAVEPOINT immutable2');

  const history = await app.inject({ url: `${base}/${X}/review-actions`, headers: operatorHeaders });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().total, 5);
  assert.equal(history.json().actions[0].reviewer, admin.public_id);

  console.log('Cluster review actions validated against PostgreSQL (rolled back, nothing persisted).');
} finally {
  if (client) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
  pool.query = originalQuery;
  pool.connect = originalConnect;
  await app.close();
  await pool.end();
}
