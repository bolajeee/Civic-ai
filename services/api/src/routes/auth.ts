import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from '../db';
import { registerSchema, loginSchema, refreshSchema } from '../schemas/auth';
import {
  createRefreshToken,
  verifyRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../lib/tokens';

export default async function authRoutes(fastify: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // POST /api/auth/register
  // ---------------------------------------------------------------------------
  fastify.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { fullName, email, password, phone, nin } = registerSchema.parse(request.body);

      const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return reply.status(400).send({ error: 'User with this email already exists' });
      }

      const existingNin = await query('SELECT id FROM users WHERE nin = $1', [nin]);
      if (existingNin.rows.length > 0) {
        return reply.status(400).send({ error: 'An account with this NIN already exists' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const publicId = crypto.randomUUID();

      const result = await query(
        `INSERT INTO users (public_id, full_name, email, phone, password_hash, nin, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'CITIZEN')
         RETURNING id, public_id, full_name, email, role`,
        [publicId, fullName, email, phone ?? null, passwordHash, nin],
      );

      const user = result.rows[0];

      const accessToken = fastify.jwt.sign(
        { id: user.id, public_id: user.public_id, email: user.email, role: user.role },
        { expiresIn: '15m' },
      );
      const refreshToken = await createRefreshToken(user.id);

      return reply.status(201).send({ accessToken, refreshToken, user });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/login
  // ---------------------------------------------------------------------------
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email, password } = loginSchema.parse(request.body);

      const result = await query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      const user = result.rows[0];

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
          full_name: user.full_name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/refresh
  // Accepts { userId, refreshToken }, verifies, rotates, and issues new tokens.
  // ---------------------------------------------------------------------------
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, refreshToken: rawToken } = refreshSchema.parse(request.body);

      // Will throw if token is invalid, revoked, or expired
      await verifyRefreshToken(rawToken, userId);

      // Fetch current user to include up-to-date role/status in new JWT
      const result = await query(
        'SELECT id, public_id, email, role, status FROM users WHERE id = $1',
        [userId],
      );
      if (result.rows.length === 0) {
        return reply.status(401).send({ error: 'User not found' });
      }

      const user = result.rows[0];
      if (user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: `Account is ${user.status.toLowerCase()}` });
      }

      // Rotate: revoke old token, issue new one
      const newRefreshToken = await rotateRefreshToken(rawToken, userId);

      const accessToken = fastify.jwt.sign(
        { id: user.id, public_id: user.public_id, email: user.email, role: user.role },
        { expiresIn: '15m' },
      );

      return reply.status(200).send({ accessToken, refreshToken: newRefreshToken });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
      if (err.message === 'Invalid or expired refresh token') {
        return reply.status(401).send({ error: err.message });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/logout
  // Revokes the supplied refresh token (single-device logout).
  // ---------------------------------------------------------------------------
  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { refreshToken: rawToken } = refreshSchema
          .pick({ refreshToken: true })
          .parse(request.body);

        await revokeRefreshToken(rawToken);
        return reply.status(200).send({ message: 'Logged out successfully' });
      } catch (err: any) {
        if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/auth/me  — protected
  // Returns the authenticated user's profile.
  // ---------------------------------------------------------------------------
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = request.user as { id: string };

        const result = await query(
          `SELECT id, public_id, full_name, email, phone, nin, role, status, created_at
           FROM users
           WHERE id = $1`,
          [payload.id],
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'User not found' });
        }

        return reply.status(200).send({ user: result.rows[0] });
      } catch (err: any) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
