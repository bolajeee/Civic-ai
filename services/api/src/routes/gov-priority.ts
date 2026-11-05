import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { isPriorityEnabled } from '../ai/priority';

const paramsSchema = z.object({ id: z.uuid() });
const contextValue = z.object({ score: z.number().min(0).max(1), source: z.string().trim().min(1).max(1000) }).strict();
const contextSchema = z.object({ population: contextValue.nullable(), locationImportance: contextValue.nullable(),
  reason: z.string().trim().min(1).max(1000) }).strict();

export default async function govPriorityRoutes(app: FastifyInstance) {
  async function requireGovernment(request: FastifyRequest, reply: FastifyReply) {
    const user = await query<{ role: string; status: string }>('SELECT role, status FROM users WHERE id = $1',
      [(request.user as { id: string }).id]);
    if (!user.rows[0] || !['OPERATOR', 'ADMIN'].includes(user.rows[0].role) || user.rows[0].status !== 'ACTIVE') {
      return reply.status(403).send({ error: 'Access denied' });
    }
  }
  const preHandler = [app.authenticate, requireGovernment];
  app.get('/:id/priority', { preHandler }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid cluster id' });
    if (!isPriorityEnabled()) return { status: 'disabled', priority: null };
    try {
      const rows = await query<{
        id: string; error_code: string | null; stale: boolean; result: unknown;
        input_snapshot: unknown; calculated_at: Date | null; calculation_id: string | null;
      }>(`SELECT ic.id, j.error_code,
          (j.evaluated_revision IS DISTINCT FROM j.revision OR j.next_run_at <= NOW()) AS stale,
          p.id AS calculation_id, p.result, p.input_snapshot, p.calculated_at
         FROM issue_clusters ic LEFT JOIN issue_cluster_priority_jobs j ON j.issue_cluster_id = ic.id
         LEFT JOIN issue_cluster_priority_calculations p ON p.id = j.last_calculation_id
         WHERE ic.id = $1`, [params.data.id]);
      const row = rows.rows[0];
      if (!row) return reply.status(404).send({ error: 'Cluster not found' });
      const status = row.error_code ? 'failed' : !row.calculation_id || row.stale ? 'pending' : 'ready';
      return { status, priority: status === 'ready' ? row.result : null,
        calculationId: row.calculation_id, calculatedAt: row.calculated_at,
        // Only active government accounts can inspect evidence from all members.
        lastCalculation: row.calculation_id ? { result: row.result, inputSnapshot: row.input_snapshot } : null };
    } catch (err) { app.log.error(err); return reply.status(500).send({ error: 'Internal Server Error' }); }
  });
  app.put('/:id/priority-context', { preHandler }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = contextSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Invalid priority context' });
    if (!isPriorityEnabled()) return reply.status(503).send({ error: 'Priority calculation is disabled' });
    try {
      const { population, locationImportance, reason } = body.data;
      // A single statement checks existence and writes context; triggers audit and enqueue atomically.
      const result = await query(
        `INSERT INTO issue_cluster_priority_context
          (issue_cluster_id, population_score, population_source, location_importance_score,
           location_importance_source, updated_by, reason)
         SELECT id, $2, $3, $4, $5, $6, $7 FROM issue_clusters WHERE id = $1
         ON CONFLICT (issue_cluster_id) DO UPDATE SET population_score = EXCLUDED.population_score,
           population_source = EXCLUDED.population_source,
           location_importance_score = EXCLUDED.location_importance_score,
           location_importance_source = EXCLUDED.location_importance_source,
           updated_by = EXCLUDED.updated_by, reason = EXCLUDED.reason, updated_at = NOW()
         RETURNING issue_cluster_id`,
        [params.data.id, population?.score ?? null, population?.source ?? null,
          locationImportance?.score ?? null, locationImportance?.source ?? null,
          (request.user as { id: string }).id, reason]);
      if (!result.rowCount) return reply.status(404).send({ error: 'Cluster not found' });
      return reply.status(202).send({ status: 'pending' });
    } catch (err) { app.log.error(err); return reply.status(500).send({ error: 'Internal Server Error' }); }
  });
}
