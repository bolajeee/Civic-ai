import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import overviewRoutes from '../src/routes/gov-dashboard';
import mapRoutes from '../src/routes/gov-map';
import { pool } from '../src/db';

// No password login, shared-data writes, AI workers or external model calls.
// A local test JWT verifies current account authorization on real endpoint handlers.
const app = Fastify();
const savedPriority = process.env.AI_PRIORITY_ENABLED;
const originalQuery = pool.query;
let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
try {
  await app.register(jwt, { secret: crypto.randomBytes(32).toString('hex') });
  await app.register(authenticate);
  await app.register(overviewRoutes, { prefix: '/api/gov/dashboard' });
  await app.register(mapRoutes, { prefix: '/api/gov/dashboard' });
  await app.ready();
  client = await pool.connect();
  pool.query = client.query.bind(client) as typeof pool.query;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const users = await client.query("SELECT id FROM users WHERE role IN ('ADMIN', 'OPERATOR') AND status = 'ACTIVE' ORDER BY id LIMIT 1");
  assert.ok(users.rows[0], 'Provision an active government account before live validation.');
  const headers = { authorization: `Bearer ${app.jwt.sign({ id: users.rows[0].id }, { expiresIn: '5m' })}` };
  async function read(path: string) {
    const response = await app.inject({ url: `/api/gov/dashboard/${path}`, headers });
    assert.equal(response.statusCode, 200, `Endpoint failed: ${path} ${response.body}`);
    assert.equal(response.headers['cache-control'], 'no-store');
    return response.json();
  }
  process.env.AI_PRIORITY_ENABLED = 'false';
  const counts = await client.query('SELECT count(*)::int AS total FROM reports');
  const overview = await read('overview');
  assert.equal(overview.reports.total, counts.rows[0].total);
  assert.equal(overview.priority.enabled, false);
  assert.ok(overview.recentReports.length <= 8);
  const map = await read('map?bbox=-180,-90,180,90&limit=1');
  const geometryCounts = await client.query(`SELECT count(*) FILTER (WHERE l.geom IS NOT NULL)::int AS mapped,
    count(*) FILTER (WHERE l.geom IS NULL)::int AS missing FROM reports r LEFT JOIN locations l ON l.id = r.location_id`);
  assert.equal(map.reports.total, geometryCounts.rows[0].mapped);
  assert.equal(map.reports.withoutGeometry, geometryCounts.rows[0].missing);
  assert.ok(map.reports.features.length <= 1 && map.clusters.features.length <= 1);
  for (const category of map.categories) {
    const filtered = await read(`map?bbox=-180,-90,180,90&layer=reports&status=PENDING&category=${encodeURIComponent(category.slug)}`);
    assert.equal(filtered.clusters.total, 0);
    assert.ok(filtered.reports.features.every((f: any) => f.properties.categorySlug === category.slug && f.properties.status === 'PENDING'));
  }
  const priorities = await client.query("SELECT to_regclass('public.issue_cluster_priority_jobs') IS NOT NULL AS present");
  if (priorities.rows[0].present) {
    process.env.AI_PRIORITY_ENABLED = 'true';
    assert.equal((await read('overview')).priority.enabled, true);
  }
  await client.query('ROLLBACK');
  console.log('Live database: overview counts, priority modes, active government authorization, map GeoJSON, layer/category/status filters and limits passed.');

  // Session-local fixture tables shadow public data and are dropped at rollback.
  // This exercises spatial SQL even if the shared database has no observations.
  await client.query('BEGIN');
  await client.query(`
    CREATE TEMP TABLE users (id uuid, role text, status text) ON COMMIT DROP;
    CREATE TEMP TABLE report_categories (id uuid PRIMARY KEY, slug text, label text, display_order int) ON COMMIT DROP;
    CREATE TEMP TABLE locations (id uuid, geom geometry(Point,4326), address text, accuracy float8) ON COMMIT DROP;
    CREATE TEMP TABLE reports (id uuid, public_id text, category_id uuid, location_id uuid, status text, submitted_at timestamptz) ON COMMIT DROP;
    CREATE TEMP TABLE issue_clusters (id uuid, public_id text, category_id uuid, status text, report_count int, centroid geometry(Point,4326), created_at timestamptz) ON COMMIT DROP;
    CREATE TEMP TABLE issue_cluster_reports (report_id uuid, issue_cluster_id uuid) ON COMMIT DROP;
    CREATE TEMP TABLE issue_cluster_review_candidates (report_id uuid, status text) ON COMMIT DROP;
  `);
  const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
  await client.query("INSERT INTO users VALUES ($1, 'OPERATOR', 'ACTIVE')", [users.rows[0].id]);
  await client.query("INSERT INTO report_categories VALUES ($1, 'pothole', 'Pothole', 1), ($2, 'flood', 'Flood', 2)", ids.slice(0, 2));
  await client.query(`INSERT INTO locations VALUES
    ($1, ST_SetSRID(ST_MakePoint(3,6),4326), 'Inside', 12),
    ($2, ST_SetSRID(ST_MakePoint(5,8),4326), 'Boundary', NULL),
    ($3, ST_SetSRID(ST_MakePoint(8,10),4326), 'Outside', 5)`, ids.slice(2, 5));
  await client.query(`INSERT INTO reports VALUES
    ($1, 'CR-inside', $5, $6, 'PENDING', '2026-10-01'),
    ($2, 'CR-boundary', $5, $7, 'RESOLVED', '2026-10-02'),
    ($3, 'CR-outside', $9, $8, 'PENDING', '2026-10-03'),
    ($4, 'CR-no-gps', $5, NULL, 'PENDING', '2026-10-04')`,
    [ids[5], ids[6], ids[7], ids[8], ids[0], ids[2], ids[3], ids[4], ids[1]]);
  await client.query(`INSERT INTO issue_clusters VALUES
    ($1, 'IC-inside', $2, 'PENDING', 1, ST_SetSRID(ST_MakePoint(3,6),4326), NOW()),
    ($3, 'IC-empty', $2, 'PENDING', 0, ST_SetSRID(ST_MakePoint(3,6),4326), NOW()),
    ($4, 'IC-no-gps', $2, 'PENDING', 1, NULL, NOW())`, [ids[9], ids[0], ids[5], ids[8]]);
  await client.query('INSERT INTO issue_cluster_reports VALUES ($1,$2)', [ids[5], ids[9]]);
  process.env.AI_PRIORITY_ENABLED = 'false';
  const fixtureOverview = await read('overview');
  assert.equal(fixtureOverview.reports.total, 4);
  assert.equal(fixtureOverview.reports.withoutLocation, 1);
  assert.equal(fixtureOverview.clusters.total, 2);
  const fixtureMap = await read('map?bbox=2,4,5,8&limit=1');
  assert.equal(fixtureMap.reports.total, 2, 'Includes points on viewport boundary, excludes outside');
  assert.equal(fixtureMap.reports.features.length, 1);
  assert.equal(fixtureMap.reports.features[0].properties.publicId, 'CR-boundary', 'Newest-first cap');
  assert.equal(fixtureMap.reports.withoutGeometry, 1);
  assert.equal(fixtureMap.clusters.total, 1, 'Excludes empty clusters');
  assert.equal(fixtureMap.clusters.withoutGeometry, 1);
  assert.deepEqual(fixtureMap.clusters.features[0].geometry.coordinates, [3, 6]);
  const pending = await read('map?bbox=2,4,5,8&layer=reports&status=PENDING&category=pothole');
  assert.equal(pending.reports.total, 1);
  assert.equal(pending.clusters.total, 0);
  assert.equal(pending.reports.features[0].properties.clusterPublicId, 'IC-inside');
  assert.equal(pending.reports.features[0].properties.accuracy, 12);
  const empty = await read('map?bbox=-10,-10,-5,-5');
  assert.deepEqual(empty.reports.features, []);
  assert.deepEqual(empty.clusters.features, []);
  await client.query('ROLLBACK');
  console.log('PostGIS temporary fixtures: boundaries, ordering, caps, missing GPS, empty clusters, memberships, accuracy and empty viewport passed; all fixtures rolled back.');
} finally {
  if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  pool.query = originalQuery;
  if (savedPriority === undefined) delete process.env.AI_PRIORITY_ENABLED;
  else process.env.AI_PRIORITY_ENABLED = savedPriority;
  await app.close();
  await pool.end();
}
