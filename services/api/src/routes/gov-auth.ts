import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from '../db';
import { govRegisterSchema, govLoginSchema } from '../schemas/gov';
import { refreshSchema } from '../schemas/auth';
import {
  createRefreshToken,
  verifyRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
} from '../lib/tokens';

/**
 * Government auth routes — mounted at /api/gov/auth
 *
 * Key difference from citizen auth:
 *  - Registration requires a valid, unused, non-expired invite code.
 *  - Only OPERATOR and ADMIN roles are accepted here.
 *  - Login enforces role guard: CITIZEN accounts cannot use this endpoint.
 *  - /logout-all revokes every session for the user (admin utility).
 */
export default async function govAuthRoutes(fastify: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // POST /api/gov/auth/register
  // Invite-only: validates invite code before creating the account.
  // ---------------------------------------------------------------------------
  fastify.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email, password, nin, inviteCode, role } = govRegisterSchema.parse(request.body);

      // Validate invite code
      const codeHash = hashCode(inviteCode);
      const inviteResult = await query(
        `SELECT id, role FROM gov_invite_codes
         WHERE code_hash = $1
           AND used_by   IS NULL
           AND expires_at > NOW()`,
        [codeHash],
      );

      if (inviteResult.rows.length === 0) {
        return reply.status(400).send({ error: 'Invalid or expired invite code' });
      }

      const invite = inviteResult.rows[0];

      // The role in the invite takes precedence — prevents escalation via payload
      const assignedRole: string = invite.role;

      // Check email uniqueness
      const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return reply.status(400).send({ error: 'User with this email already exists' });
      }

      // Check NIN uniqueness
      const existingNin = await query('SELECT id FROM users WHERE nin = $1', [nin]);
      if (existingNin.rows.length > 0) {
        return reply.status(400).send({ error: 'An account with this NIN already exists' });
      }

      const passwordHash = await bcrypt.hash(password, 12); // higher cost for gov accounts
      const publicId = crypto.randomUUID();

      const userResult = await query(
        `INSERT INTO users (public_id, email, password_hash, nin, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, public_id, email, role`,
        [publicId, email, passwordHash, nin, assignedRole],
      );

      const user = userResult.rows[0];

      // Mark invite as consumed
      await query(
        `UPDATE gov_invite_codes
         SET used_by = $1, used_at = NOW()
         WHERE id = $2`,
        [user.id, invite.id],
      );

      const accessToken = fastify.jwt.sign(
        { id: user.id, public_id: user.public_id, email: user.email, role: user.role },
        { expiresIn: '15m' },
      );
      const refreshToken = await createRefreshToken(user.id);

      return reply.status(201).send({ accessToken, refreshToken, user });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.errors });
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/gov/auth/login
  // Same flow as citizen login but enforces that the account is OPERATOR/ADMIN.
  // ---------------------------------------------------------------------------
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email, password } = govLoginSchema.parse(request.body);

      const result = await query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      const user = result.rows[0];

      // Role guard — citizens must not be able to log in via the gov endpoint
      if (user.role === 'CITIZEN') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      if (user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: `Account is ${user.status.toLowerCase()}` });
      }

      const accessToken = fastify.jwt.sign(
        { id: user.id, public_id: user.public_id, email: user.email, role: user.role },
        { expiresIn: '15m' },
      );
      const refreshToken = await createRefreshToken(user.id);

      return reply.status(200).send({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          public_id: user.public_id,
          email: user.email,
          role: user.role,
        },
      });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.errors });
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/gov/auth/refresh  (same mechanics as citizen, separate endpoint)
  // ---------------------------------------------------------------------------
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, refreshToken: rawToken } = refreshSchema.parse(request.body);

      await verifyRefreshToken(rawToken, userId);

      const result = await query(
        'SELECT id, public_id, email, role, status FROM users WHERE id = $1',
        [userId],
      );
      if (result.rows.length === 0) {
        return reply.status(401).send({ error: 'User not found' });
      }

      const user = result.rows[0];

      if (user.role === 'CITIZEN') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      if (user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: `Account is ${user.status.toLowerCase()}` });
      }

      const newRefreshToken = await rotateRefreshToken(rawToken, userId);
      const accessToken = fastify.jwt.sign(
        { id: user.id, public_id: user.public_id, email: user.email, role: user.role },
        { expiresIn: '15m' },
      );

      return reply.status(200).send({ accessToken, refreshToken: newRefreshToken });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.errors });
      if (err.message === 'Invalid or expired refresh token') {
        return reply.status(401).send({ error: err.message });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/gov/auth/logout  — single-device logout
  // ---------------------------------------------------------------------------
  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate, requireGovernmentAccount] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { refreshToken: rawToken } = refreshSchema
          .pick({ refreshToken: true })
          .parse(request.body);

        await revokeRefreshToken(rawToken);
        return reply.status(200).send({ message: 'Logged out successfully' });
      } catch (err: any) {
        if (err.name === 'ZodError') return reply.status(400).send({ error: err.errors });
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/gov/auth/logout-all  — revoke all sessions (admin utility)
  // ---------------------------------------------------------------------------
  fastify.post(
    '/logout-all',
    { preHandler: [fastify.authenticate, requireGovernmentAccount] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = request.user as { id: string };
        await revokeAllRefreshTokens(payload.id);
        return reply.status(200).send({ message: 'All sessions revoked' });
      } catch (err: any) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/gov/auth/me  — protected
  // ---------------------------------------------------------------------------
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate, requireGovernmentAccount] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = request.user as { id: string };

        const result = await query(
          `SELECT id, public_id, email, nin, role, status, created_at
           FROM users
           WHERE id = $1`,
          [payload.id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'User not found' });
        }

        const user = result.rows[0];

        return reply.status(200).send({ user });
      } catch (err: any) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Ensures protected government-auth routes remain inaccessible to citizen
 * accounts. The role is read from the database rather than trusting the JWT
 * claim, so a role change takes effect immediately for an existing token.
 */
async function requireGovernmentAccount(request: FastifyRequest, reply: FastifyReply) {
  const payload = request.user as { id: string };
  const result = await query('SELECT role, status FROM users WHERE id = $1', [payload.id]);

  if (result.rows.length === 0 || result.rows[0].role === 'CITIZEN') {
    return reply.status(403).send({ error: 'Access denied' });
  }

  if (result.rows[0].status !== 'ACTIVE') {
    return reply.status(403).send({ error: `Account is ${result.rows[0].status.toLowerCase()}` });
  }
}

function hashCode(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
