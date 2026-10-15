import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query } from '../db';

const deviceSchema = z.strictObject({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(['ANDROID', 'IOS']),
});
const preferenceSchema = z.strictObject({ reportUpdatesEnabled: z.boolean() });
const listSchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const idSchema = z.uuid();

function citizenId(request: FastifyRequest): string {
  return (request.user as { id: string }).id;
}

function invalid(reply: FastifyReply, error: unknown) {
  if (error instanceof z.ZodError) return reply.status(400).send({ error: error.issues });
  throw error;
}

export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get('/preferences', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const result = await query<{ report_updates_enabled: boolean }>(
        `SELECT report_updates_enabled FROM citizen_notification_preferences WHERE citizen_id = $1`,
        [citizenId(request)],
      );
      return reply.send({ reportUpdatesEnabled: result.rows[0]?.report_updates_enabled ?? true });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.patch('/preferences', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const body = preferenceSchema.parse(request.body);
      await query(
        `INSERT INTO citizen_notification_preferences (citizen_id, report_updates_enabled)
         VALUES ($1, $2)
         ON CONFLICT (citizen_id) DO UPDATE
         SET report_updates_enabled = EXCLUDED.report_updates_enabled, updated_at = NOW()`,
        [citizenId(request), body.reportUpdatesEnabled],
      );
      if (!body.reportUpdatesEnabled) {
        await query(
          `UPDATE citizen_push_deliveries d SET status = 'FAILED', error_code = 'PREFERENCE_DISABLED', updated_at = NOW()
           FROM citizen_notifications n
           WHERE d.notification_id = n.id AND n.citizen_id = $1 AND d.status IN ('PENDING', 'PROCESSING')`,
          [citizenId(request)],
        );
      }
      return reply.send(body);
    } catch (error) {
      try { return invalid(reply, error); } catch (cause) {
        fastify.log.error(cause);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  fastify.post('/devices', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const body = deviceSchema.parse(request.body);
      await query(
        `WITH cancelled_transferred_deliveries AS (
           UPDATE citizen_push_deliveries d
           SET status = 'FAILED', error_code = 'TOKEN_OWNER_CHANGED', updated_at = NOW()
           FROM citizen_push_devices p
           WHERE d.device_id = p.id AND p.token = $2 AND p.citizen_id <> $1
             AND d.status IN ('PENDING', 'PROCESSING')
         )
         INSERT INTO citizen_push_devices (citizen_id, token, platform)
         VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET citizen_id = EXCLUDED.citizen_id,
           platform = EXCLUDED.platform, disabled_at = NULL, last_seen_at = NOW()`,
        [citizenId(request), body.token, body.platform],
      );
      return reply.status(204).send();
    } catch (error) {
      try { return invalid(reply, error); } catch (cause) {
        fastify.log.error(cause);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  fastify.delete('/devices', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { token } = deviceSchema.pick({ token: true }).parse(request.body);
      await query(
        `UPDATE citizen_push_devices SET disabled_at = NOW(), last_seen_at = NOW()
         WHERE citizen_id = $1 AND token = $2`,
        [citizenId(request), token],
      );
      return reply.status(204).send();
    } catch (error) {
      try { return invalid(reply, error); } catch (cause) {
        fastify.log.error(cause);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const { limit } = listSchema.parse(request.query);
      const result = await query(
        `SELECT n.id, n.kind, n.report_status, n.title, n.body, n.data,
                n.created_at, n.read_at, r.public_id
         FROM citizen_notifications n
         JOIN reports r ON r.id = n.report_id
         WHERE n.citizen_id = $1
         ORDER BY n.created_at DESC, n.id DESC LIMIT $2`,
        [citizenId(request), limit],
      );
      return reply.send({ notifications: result.rows.map((row: any) => ({
        id: row.id, kind: row.kind, reportStatus: row.report_status,
        title: row.title, body: row.body, data: row.data,
        publicId: row.public_id, createdAt: row.created_at, readAt: row.read_at,
      })) });
    } catch (error) {
      try { return invalid(reply, error); } catch (cause) {
        fastify.log.error(cause);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  fastify.post('/:id/read', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const id = idSchema.parse((request.params as { id?: string }).id);
      const result = await query(
        `UPDATE citizen_notifications SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND citizen_id = $2 RETURNING id`,
        [id, citizenId(request)],
      );
      if (!result.rowCount) return reply.status(404).send({ error: 'Notification not found' });
      return reply.status(204).send();
    } catch (error) {
      try { return invalid(reply, error); } catch (cause) {
        fastify.log.error(cause);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    }
  });
}
