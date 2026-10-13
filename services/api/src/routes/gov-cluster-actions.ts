import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, query } from '../db';
import { governmentAccess, governmentAdminAccess } from './gov-access';

const reason = z.string().trim().min(1).max(1000);
const uuid = z.uuid();
const candidateParams = z.object({ reportId: uuid, clusterId: uuid }).strict();
const clusterParams = z.object({ id: uuid }).strict();
const memberParams = z.object({ id: uuid, reportId: uuid }).strict();
const reasonBody = z.object({ reason }).strict();
const moveBody = z.object({ targetClusterId: uuid, reason }).strict();
const mergeBody = z.object({ sourceClusterId: uuid, reason }).strict();
const splitBody = z.object({ reportIds: z.array(uuid).min(1).max(100), reason }).strict();
const historyFilters = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS'];
/** Same advisory lock as the clustering worker, so reviewers and the worker never interleave. */
const CLUSTERING_LOCK = [61005, 1];

type ActionName = 'APPROVE_CANDIDATE' | 'DISMISS_CANDIDATE' | 'MOVE_REPORT'
  | 'REMOVE_REPORT' | 'MERGE_CLUSTERS' | 'SPLIT_CLUSTER';
interface ClusterRow { id: string; public_id: string; category_id: string; status: string; report_count: number }
interface MemberRow { report_id: string; public_id: string; category_id: string; location_id: string | null }

class ActionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function transact<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', CLUSTERING_LOCK);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Lock clusters in a stable order; throws 404 if any is missing. */
async function lockClusters(client: PoolClient, ids: string[]) {
  const unique = [...new Set(ids)];
  const result = await client.query<ClusterRow>(
    `SELECT id, public_id, category_id, status, report_count FROM issue_clusters
     WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [unique]);
  if (result.rows.length !== unique.length) throw new ActionError(404, 'Cluster not found');
  return new Map(result.rows.map(row => [row.id, row]));
}

async function lockMembers(client: PoolClient, clusterId: string, reportIds: string[]) {
  const result = await client.query<MemberRow>(
    `SELECT m.report_id, r.public_id, r.category_id, r.location_id
     FROM issue_cluster_reports m JOIN reports r ON r.id = m.report_id
     WHERE m.issue_cluster_id = $1 AND m.report_id = ANY($2::uuid[])
     ORDER BY r.submitted_at, r.id FOR UPDATE OF m`, [clusterId, reportIds]);
  return result.rows;
}

function assertTarget(target: ClusterRow, categoryId: string) {
  if (target.category_id !== categoryId) throw new ActionError(409, 'The target cluster has a different category');
  if (!OPEN_STATUSES.includes(target.status)) throw new ActionError(409, 'The target cluster is not open');
  if (target.report_count < 1) throw new ActionError(409, 'The target cluster has no reports');
}

async function assignReports(client: PoolClient, reportIds: string[], clusterId: string) {
  await client.query(
    `UPDATE issue_cluster_reports SET issue_cluster_id = $2, assignment_method = 'HUMAN',
       confidence = NULL, assigned_at = NOW()
     WHERE report_id = ANY($1::uuid[])`, [reportIds, clusterId]);
}

async function createCluster(client: PoolClient, categoryId: string, anchorLocationId: string | null, status: string) {
  const created = await client.query<{ id: string }>(
    `INSERT INTO issue_clusters (category_id, anchor_location_id, status)
     VALUES ($1, $2, $3) RETURNING id`, [categoryId, anchorLocationId, status]);
  return created.rows[0].id;
}

/** A moved report's open proposals are stale: the one for the destination is accepted, the rest dismissed. */
async function resolveProposals(client: PoolClient, reportIds: string[], acceptedClusterId: string | null,
  actorId: string, why: string) {
  const result = await client.query(
    `UPDATE issue_cluster_review_candidates SET
       status = CASE WHEN issue_cluster_id = $2::uuid THEN 'ACCEPTED' ELSE 'DISMISSED' END,
       reviewed_by = $3, reviewed_at = NOW(), review_reason = $4
     WHERE report_id = ANY($1::uuid[]) AND status = 'PENDING'`,
    [reportIds, acceptedClusterId, actorId, why]);
  return result.rowCount ?? 0;
}

/** Proposals into a cluster left with no reports can never be applied. */
async function dismissEmptyTargets(client: PoolClient, actorId: string) {
  const result = await client.query(
    `UPDATE issue_cluster_review_candidates SET status = 'DISMISSED', reviewed_by = $1,
       reviewed_at = NOW(), review_reason = 'Dismissed automatically: the proposed cluster is now empty.'
     WHERE status = 'PENDING'
       AND issue_cluster_id IN (SELECT id FROM issue_clusters WHERE report_count = 0)`, [actorId]);
  return result.rowCount ?? 0;
}

async function record(client: PoolClient, entry: {
  action: ActionName; actorId: string; reason: string; clusterId: string;
  relatedClusterId?: string | null; details: Record<string, unknown>;
}) {
  const result = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO issue_cluster_review_actions
       (action, actor_id, reason, issue_cluster_id, related_cluster_id, details)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at AS "createdAt"`,
    [entry.action, entry.actorId, entry.reason, entry.clusterId, entry.relatedClusterId ?? null,
      JSON.stringify(entry.details)]);
  return { id: result.rows[0].id, type: entry.action, reason: entry.reason, createdAt: result.rows[0].createdAt };
}

async function summaries(client: PoolClient, ids: string[]) {
  const result = await client.query<{ id: string; publicId: string; reportCount: number }>(
    `SELECT id, public_id AS "publicId", report_count AS "reportCount"
     FROM issue_clusters WHERE id = ANY($1::uuid[]) ORDER BY public_id`, [[...new Set(ids)]]);
  return result.rows;
}

const ref = (cluster: ClusterRow) => ({ id: cluster.id, publicId: cluster.public_id });
const reportRefs = (members: MemberRow[]) => members.map(m => ({ id: m.report_id, publicId: m.public_id }));

export default async function govClusterActionRoutes(app: FastifyInstance) {
  const read = [app.authenticate, governmentAccess(app)];
  const write = [app.authenticate, governmentAdminAccess(app)];
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  const actor = (request: { user: unknown }) => (request.user as { id: string }).id;
  function fail(reply: FastifyReply, error: unknown) {
    if (error instanceof ActionError) return reply.status(error.status).send({ error: error.message });
    if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request', details: error.flatten() });
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }

  app.post('/review-queue/:reportId/:clusterId/approve', { preHandler: write }, async (request, reply) => {
    try {
      const { reportId, clusterId } = candidateParams.parse(request.params);
      const { reason: why } = reasonBody.parse(request.body);
      const actorId = actor(request);
      return await transact(async client => {
        const candidate = await client.query<{ status: string; category_id: string; public_id: string }>(
          `SELECT review.status, source.category_id, source.public_id
           FROM issue_cluster_review_candidates review JOIN reports source ON source.id = review.report_id
           WHERE review.report_id = $1 AND review.issue_cluster_id = $2 FOR UPDATE OF review`, [reportId, clusterId]);
        if (!candidate.rows[0]) throw new ActionError(404, 'Review proposal not found');
        if (candidate.rows[0].status !== 'PENDING') throw new ActionError(409, 'This proposal has already been reviewed');
        const membership = await client.query<{ issue_cluster_id: string }>(
          'SELECT issue_cluster_id FROM issue_cluster_reports WHERE report_id = $1 FOR UPDATE', [reportId]);
        const fromId = membership.rows[0]?.issue_cluster_id;
        if (!fromId) throw new ActionError(409, 'The report is not in any cluster');
        if (fromId === clusterId) throw new ActionError(409, 'The report is already in the proposed cluster');
        const clusters = await lockClusters(client, [fromId, clusterId]);
        assertTarget(clusters.get(clusterId)!, candidate.rows[0].category_id);
        await assignReports(client, [reportId], clusterId);
        const resolved = await resolveProposals(client, [reportId], clusterId, actorId, why);
        const autoDismissed = await dismissEmptyTargets(client, actorId);
        const action = await record(client, {
          action: 'APPROVE_CANDIDATE', actorId, reason: why, clusterId, relatedClusterId: fromId,
          details: { report: { id: reportId, publicId: candidate.rows[0].public_id },
            fromCluster: ref(clusters.get(fromId)!), toCluster: ref(clusters.get(clusterId)!),
            resolvedProposals: resolved, autoDismissedProposals: autoDismissed },
        });
        return { action, clusters: await summaries(client, [fromId, clusterId]) };
      });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/review-queue/:reportId/:clusterId/dismiss', { preHandler: write }, async (request, reply) => {
    try {
      const { reportId, clusterId } = candidateParams.parse(request.params);
      const { reason: why } = reasonBody.parse(request.body);
      const actorId = actor(request);
      return await transact(async client => {
        const candidate = await client.query<{ status: string; public_id: string }>(
          `SELECT review.status, source.public_id
           FROM issue_cluster_review_candidates review JOIN reports source ON source.id = review.report_id
           WHERE review.report_id = $1 AND review.issue_cluster_id = $2 FOR UPDATE OF review`, [reportId, clusterId]);
        if (!candidate.rows[0]) throw new ActionError(404, 'Review proposal not found');
        if (candidate.rows[0].status !== 'PENDING') throw new ActionError(409, 'This proposal has already been reviewed');
        await client.query(
          `UPDATE issue_cluster_review_candidates SET status = 'DISMISSED', reviewed_by = $3,
             reviewed_at = NOW(), review_reason = $4
           WHERE report_id = $1 AND issue_cluster_id = $2`, [reportId, clusterId, actorId, why]);
        const clusters = await lockClusters(client, [clusterId]);
        const action = await record(client, {
          action: 'DISMISS_CANDIDATE', actorId, reason: why, clusterId,
          details: { report: { id: reportId, publicId: candidate.rows[0].public_id },
            proposedCluster: ref(clusters.get(clusterId)!) },
        });
        return { action, clusters: await summaries(client, [clusterId]) };
      });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/:id/reports/:reportId/move', { preHandler: write }, async (request, reply) => {
    try {
      const { id, reportId } = memberParams.parse(request.params);
      const { targetClusterId, reason: why } = moveBody.parse(request.body);
      if (targetClusterId === id) throw new ActionError(409, 'Choose a different target cluster');
      const actorId = actor(request);
      return await transact(async client => {
        const clusters = await lockClusters(client, [id, targetClusterId]);
        const [member] = await lockMembers(client, id, [reportId]);
        if (!member) throw new ActionError(404, 'The report is not in this cluster');
        assertTarget(clusters.get(targetClusterId)!, member.category_id);
        await assignReports(client, [reportId], targetClusterId);
        const resolved = await resolveProposals(client, [reportId], targetClusterId, actorId, why);
        const autoDismissed = await dismissEmptyTargets(client, actorId);
        const action = await record(client, {
          action: 'MOVE_REPORT', actorId, reason: why, clusterId: id, relatedClusterId: targetClusterId,
          details: { reports: reportRefs([member]), fromCluster: ref(clusters.get(id)!),
            toCluster: ref(clusters.get(targetClusterId)!),
            resolvedProposals: resolved, autoDismissedProposals: autoDismissed },
        });
        return { action, clusters: await summaries(client, [id, targetClusterId]) };
      });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/:id/reports/:reportId/remove', { preHandler: write }, async (request, reply) => {
    try {
      const { id, reportId } = memberParams.parse(request.params);
      const { reason: why } = reasonBody.parse(request.body);
      const actorId = actor(request);
      return await transact(async client => {
        const clusters = await lockClusters(client, [id]);
        const source = clusters.get(id)!;
        const [member] = await lockMembers(client, id, [reportId]);
        if (!member) throw new ActionError(404, 'The report is not in this cluster');
        if (source.report_count < 2) throw new ActionError(409, 'The report is already alone in its cluster');
        const report = await client.query<{ status: string }>('SELECT status FROM reports WHERE id = $1', [reportId]);
        const newId = await createCluster(client, member.category_id, member.location_id, report.rows[0].status);
        await assignReports(client, [reportId], newId);
        const resolved = await resolveProposals(client, [reportId], null, actorId, why);
        const autoDismissed = await dismissEmptyTargets(client, actorId);
        const [created] = await summaries(client, [newId]);
        const action = await record(client, {
          action: 'REMOVE_REPORT', actorId, reason: why, clusterId: id, relatedClusterId: newId,
          details: { reports: reportRefs([member]), fromCluster: ref(source),
            toCluster: { id: newId, publicId: created.publicId },
            resolvedProposals: resolved, autoDismissedProposals: autoDismissed },
        });
        return { action, clusters: await summaries(client, [id, newId]) };
      });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/:id/merge', { preHandler: write }, async (request, reply) => {
    try {
      const { id } = clusterParams.parse(request.params);
      const { sourceClusterId, reason: why } = mergeBody.parse(request.body);
      if (sourceClusterId === id) throw new ActionError(409, 'A cluster cannot be merged into itself');
      const actorId = actor(request);
      return await transact(async client => {
        const clusters = await lockClusters(client, [id, sourceClusterId]);
        const target = clusters.get(id)!;
        const source = clusters.get(sourceClusterId)!;
        if (source.category_id !== target.category_id) throw new ActionError(409, 'Clusters with different categories cannot be merged');
        if (!OPEN_STATUSES.includes(source.status) || !OPEN_STATUSES.includes(target.status)) {
          throw new ActionError(409, 'Only open clusters can be merged');
        }
        if (source.report_count < 1 || target.report_count < 1) throw new ActionError(409, 'An empty cluster cannot be merged');
        const all = await client.query<{ report_id: string }>(
          'SELECT report_id FROM issue_cluster_reports WHERE issue_cluster_id = $1', [sourceClusterId]);
        const members = await lockMembers(client, sourceClusterId, all.rows.map(row => row.report_id));
        const ids = members.map(member => member.report_id);
        await assignReports(client, ids, id);
        const resolved = await resolveProposals(client, ids, id, actorId, why);
        const autoDismissed = await dismissEmptyTargets(client, actorId);
        const action = await record(client, {
          action: 'MERGE_CLUSTERS', actorId, reason: why, clusterId: id, relatedClusterId: sourceClusterId,
          details: { reports: reportRefs(members), fromCluster: ref(source), toCluster: ref(target),
            resolvedProposals: resolved, autoDismissedProposals: autoDismissed },
        });
        return { action, clusters: await summaries(client, [id, sourceClusterId]) };
      });
    } catch (error) { return fail(reply, error); }
  });

  app.post('/:id/split', { preHandler: write }, async (request, reply) => {
    try {
      const { id } = clusterParams.parse(request.params);
      const { reportIds, reason: why } = splitBody.parse(request.body);
      const wanted = [...new Set(reportIds)];
      const actorId = actor(request);
      return await transact(async client => {
        const clusters = await lockClusters(client, [id]);
        const source = clusters.get(id)!;
        const members = await lockMembers(client, id, wanted);
        if (members.length !== wanted.length) throw new ActionError(404, 'Some reports are not in this cluster');
        if (members.length >= source.report_count) throw new ActionError(409, 'At least one report must stay in the original cluster');
        // Members are ordered oldest first, so the anchor is the earliest report that has a location.
        const newId = await createCluster(client, source.category_id,
          members.find(member => member.location_id)?.location_id ?? null, source.status);
        await assignReports(client, wanted, newId);
        const resolved = await resolveProposals(client, wanted, null, actorId, why);
        const autoDismissed = await dismissEmptyTargets(client, actorId);
        const [created] = await summaries(client, [newId]);
        const action = await record(client, {
          action: 'SPLIT_CLUSTER', actorId, reason: why, clusterId: id, relatedClusterId: newId,
          details: { reports: reportRefs(members), fromCluster: ref(source),
            toCluster: { id: newId, publicId: created.publicId },
            resolvedProposals: resolved, autoDismissedProposals: autoDismissed },
        });
        return { action, clusters: await summaries(client, [id, newId]) };
      });
    } catch (error) { return fail(reply, error); }
  });

  app.get('/:id/review-actions', { preHandler: read }, async (request, reply) => {
    try {
      const { id } = clusterParams.parse(request.params);
      const { page, limit } = historyFilters.parse(request.query);
      const result = await query<{ history: unknown }>(`
        WITH matches AS (
          SELECT a.* FROM issue_cluster_review_actions a
          WHERE a.issue_cluster_id = $1 OR a.related_cluster_id = $1
        ), page AS (
          SELECT matches.id, matches.action AS type, matches.reason, matches.details,
            matches.created_at AS "createdAt", actor.public_id AS "reviewer",
            matches.issue_cluster_id AS "clusterId", matches.related_cluster_id AS "relatedClusterId"
          FROM matches JOIN users actor ON actor.id = matches.actor_id
          ORDER BY matches.created_at DESC, matches.id DESC LIMIT $2 OFFSET $3
        )
        SELECT jsonb_build_object('generatedAt', NOW(), 'page', $4::int, 'limit', $2::int,
          'total', (SELECT count(*)::int FROM matches),
          'actions', (SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY "createdAt" DESC, id DESC), '[]'::jsonb) FROM page)
        ) AS history`, [id, limit, (page - 1) * limit, page]);
      return result.rows[0].history;
    } catch (error) { return fail(reply, error); }
  });
}
