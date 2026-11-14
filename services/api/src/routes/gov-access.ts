import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db';
import type { GovAccount } from '../lib/gov-scope';

declare module 'fastify' {
  interface FastifyRequest {
    govAccount?: GovAccount;
  }
}

interface GovUserRow {
  role: string;
  status: string;
  government_level: 'STATE' | 'FEDERAL' | null;
  state_id: string | null;
}

async function loadGovUser(id: string): Promise<GovUserRow | undefined> {
  const result = await query<GovUserRow>(
    'SELECT role, status, government_level, state_id FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

/** Recheck account access in the database; JWT role claims may be stale. */
export function governmentAccess(app: FastifyInstance) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const id = (request.user as { id: string }).id;
      const user = await loadGovUser(id);
      if (!user || !['ADMIN', 'OPERATOR'].includes(user.role) || user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: 'Access denied' });
      }
      request.govAccount = {
        id,
        role: user.role as 'ADMIN' | 'OPERATOR',
        governmentLevel: (user.government_level ?? 'FEDERAL') as 'STATE' | 'FEDERAL',
        stateId: user.state_id,
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  };
}

/** Require a currently active administrator, without trusting a JWT role claim. */
export function governmentAdminAccess(app: FastifyInstance) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const id = (request.user as { id: string }).id;
      const user = await loadGovUser(id);
      if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: 'Administrator access required' });
      }
      request.govAccount = {
        id,
        role: 'ADMIN',
        governmentLevel: (user.government_level ?? 'FEDERAL') as 'STATE' | 'FEDERAL',
        stateId: user.state_id,
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  };
}
