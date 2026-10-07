import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authenticate from '../src/plugins/authenticate';
import overviewRoutes from '../src/routes/gov-dashboard';
import mapRoutes from '../src/routes/gov-map';
import reportsRoutes from '../src/routes/gov-reports';
import { pool } from '../src/db';

// No password login, shared-data writes, AI workers or external model calls.
// A local test JWT verifies current account authorization on real endpoint handlers.
const app = Fastify();
const savedPriority = process.env.AI_PRIORITY_ENABLED;
const originalQuery = pool.query;
const validateStorage = process.argv.includes('--storage');
let fixtureMode = false;
let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
try {
  await app.register(jwt, { secret: crypto.randomBytes(32).toString('hex') });
  await app.register(authenticate);
  await app.register(overviewRoutes, { prefix: '/api/gov/dashboard' });
  await app.register(mapRoutes, { prefix: '/api/gov/dashboard' });
  await app.register(reportsRoutes, { prefix: '/api/gov/reports',
    // Object storage is checked only with --storage; fixtures always use a stub.
    signPhotos: async (keys: string[], ttl: number) => {
      assert.equal(ttl, 900);
      if (validateStorage && !fixtureMode) return (await import('../src/lib/storage')).getImageUrls(keys, ttl);
      return Object.fromEntries(keys.map(key => [key, 'https://storage.example/test-signed-photo']));
    } });
  await app.ready();
  client = await pool.connect();
  pool.query = client.query.bind(client) as typeof pool.query;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const users = await client.query("SELECT id FROM users WHERE role IN ('ADMIN', 'OPERATOR') AND status = 'ACTIVE' ORDER BY id LIMIT 1");
  assert.ok(users.rows[0], 'Provision an active government account before live validation.');
  const headers = { authorization: `Bearer ${app.jwt.sign({ id: users.rows[0].id }, { expiresIn: '5m' })}` };
  async function read(path: string) {
    const response = await app.inject({ url: path.startsWith('reports') ? `/api/gov/${path}` : `/api/gov/dashboard/${path}`, headers });
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
  const liveReports = await read('reports/?limit=20');
  assert.equal(liveReports.total, counts.rows[0].total);
  assert.ok(liveReports.reports.length <= 20);
  if (liveReports.reports.length) {
    const detail = await read(`reports/${liveReports.reports[0].id}`);
    assert.equal(detail.report.id, liveReports.reports[0].id);
    assert.equal(detail.report.photos.length, liveReports.reports[0].photoCount);
    assert.ok(detail.report.photos.every((photo: any) => !('storageKey' in photo)));
  }
  if (validateStorage) {
    const media = await client.query('SELECT report_id FROM report_media ORDER BY created_at DESC, id DESC LIMIT 1');
    if (media.rows[0]) {
      try {
        const detail = await read(`reports/${media.rows[0].report_id}`);
        const photo = detail.report.photos.find((photo: any) => photo.url);
        assert.ok(photo, 'No photo could be signed');
        const image = await fetch(photo.url, { signal: AbortSignal.timeout(15000) });
        assert.equal(image.ok, true);
        assert.ok(image.headers.get('content-type')?.startsWith('image/'));
        assert.ok((await image.arrayBuffer()).byteLength > 0);
        console.log('Live storage: report photo signing and signed-image retrieval passed.');
      } catch {
        throw new Error('Live photo signing/retrieval failed; check the configured reports bucket and storage credentials.');
      }
    } else console.log('Live storage check skipped: no attached report photos exist in this database.');
  }
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
  console.log(`Live database: overview counts, priority modes, active government authorization, map GeoJSON/filters, and reports list/detail database contracts passed (photo signing ${validateStorage ? 'live' : 'stubbed'}).`);

  // Session-local fixture tables shadow public data and are dropped at rollback.
  // This exercises spatial SQL even if the shared database has no observations.
  await client.query('BEGIN');
  fixtureMode = true;
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
  await client.query(`
    ALTER TABLE reports ADD COLUMN description text, ADD COLUMN updated_at timestamptz DEFAULT NOW();
    ALTER TABLE locations ADD COLUMN latitude float8, ADD COLUMN longitude float8;
    UPDATE locations SET latitude = ST_Y(geom), longitude = ST_X(geom);
    CREATE TEMP TABLE report_media (id uuid, report_id uuid, storage_key text, media_type text, display_order int) ON COMMIT DROP;
  `);
  await client.query("UPDATE reports SET description = '100%_ certainty' WHERE id = $1", [ids[8]]);
  await client.query(`INSERT INTO report_media VALUES ($1,$2,'fixture/photo.jpg','image/jpeg',0)`, [crypto.randomUUID(), ids[5]]);
  await client.query(`INSERT INTO reports (id,public_id,category_id,status,submitted_at)
    SELECT ('00000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
      'CR-page-' || g, $1, 'PENDING', '2026-10-06T23:30:00Z' FROM generate_series(1,25) g`, [ids[0]]);
  await client.query(`INSERT INTO reports (id,public_id,category_id,status,submitted_at) VALUES
    ($1,'CR-before-wat',$3,'PENDING','2026-10-06T22:59:59Z'),
    ($2,'CR-after-wat',$3,'PENDING','2026-10-07T23:00:00Z')`, [crypto.randomUUID(), crypto.randomUUID(), ids[0]]);
  const first = await read('reports/?limit=20');
  const second = await read('reports/?limit=20&page=2');
  assert.equal(first.total, 31);
  assert.equal(first.reports.length, 20);
  assert.equal(second.reports.length, 11);
  assert.ok(second.reports.every((r: any) => !first.reports.some((other: any) => r.id === other.id)));
  assert.equal((await read('reports/?grouping=assigned')).total, 1);
  assert.equal((await read('reports/?grouping=unassigned')).total, 30);
  assert.equal((await read('reports/?location=present')).total, 3);
  assert.equal((await read('reports/?location=missing')).total, 28);
  const literal = await read('reports/?q=%25_');
  assert.equal(literal.total, 1, 'Percent and underscore are literal search characters');
  assert.equal(literal.reports[0].id, ids[8]);
  assert.equal((await read('reports/?q=IC-inside')).total, 1);
  assert.equal((await read('reports/?q=Boundary')).total, 1);
  assert.equal((await read('reports/?category=flood&status=PENDING')).total, 1);
  const wat = await read('reports/?from=2026-10-07&to=2026-10-07&limit=100');
  assert.equal(wat.total, 25, 'WAT inclusive day excludes observations outside either UTC boundary');
  assert.equal(wat.reports[0].publicId, 'CR-page-25', 'UUID breaks equal-time ties deterministically');
  assert.equal((await read('reports/?q=nonexistent')).total, 0);
  const beyond = await read('reports/?page=100');
  assert.equal(beyond.total, 31);
  assert.deepEqual(beyond.reports, []);
  const detail = await read(`reports/${ids[5]}`);
  assert.equal(detail.report.cluster.publicId, 'IC-inside');
  assert.equal(detail.report.location.accuracy, 12);
  assert.equal(detail.report.photos[0].url, 'https://storage.example/test-signed-photo');
  assert.equal(detail.report.photos[0].storageKey, undefined);
  const noGps = await read(`reports/${ids[8]}`);
  assert.equal(noGps.report.location, null);
  assert.equal(noGps.report.cluster, null);
  assert.deepEqual(noGps.report.photos, []);
  await client.query('ROLLBACK');
  console.log('Temporary fixtures: PostGIS boundaries, reports pagination/ties, literal search, WAT date boundaries, grouping/GPS/category/status filters, details and photo metadata passed; all fixtures rolled back.');
} finally {
  if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  pool.query = originalQuery;
  if (savedPriority === undefined) delete process.env.AI_PRIORITY_ENABLED;
  else process.env.AI_PRIORITY_ENABLED = savedPriority;
  await app.close();
  await pool.end();
}
