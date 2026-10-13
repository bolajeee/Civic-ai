import crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { revokeAllRefreshTokens } from '../lib/tokens';
import { govAccountStatusSchema, govInviteCreateSchema } from '../schemas/gov';
import { governmentAdminAccess } from './gov-access';

const idSchema = z.string().uuid();

export default async function govAdminRoutes(app: FastifyInstance) {
  const access = [app.authenticate, governmentAdminAccess(app)];
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.get('/', { preHandler: access }, async (_request, reply) => {
    try {
      const [accounts, invitations] = await Promise.all([
        query(`SELECT id, public_id, email, role, status, created_at, updated_at
               FROM users WHERE role IN ('ADMIN', 'OPERATOR')
               ORDER BY created_at DESC, id DESC`),
        query(`SELECT i.id, i.role, i.expires_at, i.created_at, i.used_at, i.revoked_at,
                      creator.email AS created_by_email, consumer.email AS used_by_email
               FROM gov_invite_codes i
               LEFT JOIN users creator ON creator.id = i.created_by
               LEFT JOIN users consumer ON consumer.id = i.used_by
               ORDER BY i.created_at DESC, i.id DESC
               LIMIT 100`),
      ]);
      return {
        generatedAt: new Date().toISOString(),
        accounts: accounts.rows.map(row => ({
          id: row.id, publicId: row.public_id, email: row.email, role: row.role,
          status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
        })),
        invitations: invitations.rows.map(row => ({
          id: row.id, role: row.role, expiresAt: row.expires_at, createdAt: row.created_at,
          usedAt: row.used_at, revokedAt: row.revoked_at,
          createdByEmail: row.created_by_email, usedByEmail: row.used_by_email,
        })),
      };
    } catch (error) { return internalError(app, reply, error); }
  });

  app.post('/invitations', { preHandler: access }, async (request, reply) => {
    try {
      const { role, expiresInHours } = govInviteCreateSchema.parse(request.body);
      const code = crypto.randomBytes(24).toString('hex');
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      const result = await query(
        `INSERT INTO gov_invite_codes (code_hash, role, created_by, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 hour'))
         RETURNING id, role, expires_at, created_at`,
        [codeHash, role, (request.user as { id: string }).id, expiresInHours],
      );
      const invitation = result.rows[0];
      return reply.status(201).send({
        invitation: { id: invitation.id, role: invitation.role, expiresAt: invitation.expires_at,
          createdAt: invitation.created_at },
        code,
      });
    } catch (error) { return requestError(app, reply, error); }
  });

  app.delete('/invitations/:id', { preHandler: access }, async (request, reply) => {
    try {
      const id = idSchema.parse((request.params as { id?: string }).id);
      const result = await query(
        `UPDATE gov_invite_codes SET revoked_at = NOW()
         WHERE id = $1 AND used_by IS NULL AND revoked_at IS NULL
         RETURNING id`, [id]);
      if (!result.rows[0]) return reply.status(404).send({ error: 'Unused invitation not found' });
      return reply.status(204).send();
    } catch (error) { return requestError(app, reply, error); }
  });

  app.patch('/accounts/:id/status', { preHandler: access }, async (request, reply) => {
    try {
      const id = idSchema.parse((request.params as { id?: string }).id);
      const actorId = (request.user as { id: string }).id;
      const { status } = govAccountStatusSchema.parse(request.body);
      if (id === actorId && status !== 'ACTIVE') {
        return reply.status(400).send({ error: 'You cannot suspend your own account' });
      }
      const result = await query(
        `UPDATE users SET status = $1
         WHERE id = $2 AND role IN ('ADMIN', 'OPERATOR')
         RETURNING id, public_id, email, role, status, created_at, updated_at`, [status, id]);
      const account = result.rows[0];
      if (!account) return reply.status(404).send({ error: 'Government account not found' });
      if (status === 'SUSPENDED') await revokeAllRefreshTokens(id);
      return { account: { id: account.id, publicId: account.public_id, email: account.email,
        role: account.role, status: account.status, createdAt: account.created_at, updatedAt: account.updated_at } };
    } catch (error) { return requestError(app, reply, error); }
  });
}

function requestError(app: FastifyInstance, reply: FastifyReply, error: unknown) {
  if (error instanceof z.ZodError) return reply.status(400).send({ error: error.issues });
  return internalError(app, reply, error);
}

function internalError(app: FastifyInstance, reply: FastifyReply, error: unknown) {
  app.log.error(error);
  return reply.status(500).send({ error: 'Internal Server Error' });
}
