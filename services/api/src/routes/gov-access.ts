import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db';

/** Recheck account access in the database; JWT role claims may be stale. */
export function governmentAccess(app: FastifyInstance) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await query<{ role: string; status: string }>(
        'SELECT role, status FROM users WHERE id = $1', [(request.user as { id: string }).id]);
      const user = result.rows[0];
      if (!user || !['ADMIN', 'OPERATOR'].includes(user.role) || user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: 'Access denied' });
      }
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  };
}
