import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool, query } from '../db';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  socialLoginSchema,
  updateProfileSchema,
} from '../schemas/auth';
import {
  createRefreshToken,
  verifyRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../lib/tokens';
import { sendPasswordResetEmail } from '../lib/email';
import { verifyIdentityToken } from '../lib/identity-tokens';

const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const resetRequestBuckets = new Map<string, { count: number; resetsAt: number }>();

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
  // POST /api/auth/social
  // Verifies the provider-signed ID token, then links/signs in an existing
  // citizen. Social auth intentionally does not bypass the NIN-backed signup.
  // ---------------------------------------------------------------------------
  fastify.post('/social', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { provider, idToken, nonce } = socialLoginSchema.parse(request.body);
      let identity;
      try {
        identity = await verifyIdentityToken(provider, idToken, nonce);
      } catch (err: any) {
        if (String(err.message).endsWith('_CLIENT_IDS is not configured')) {
          fastify.log.error(err);
          return reply.status(503).send({ error: 'Social sign-in is not configured on the server.' });
        }
        fastify.log.warn(err);
        return reply.status(401).send({ error: 'Unable to verify the social sign-in. Please try again.' });
      }
      const client = await pool.connect();
      let user: any;

      try {
        await client.query('BEGIN');
        const linked = await client.query(
          `SELECT u.id, u.public_id, u.full_name, u.email, u.role, u.status
           FROM social_identities si
           JOIN users u ON u.id = si.user_id
           WHERE si.provider = $1 AND si.provider_user_id = $2
           FOR UPDATE OF u`,
          [identity.provider, identity.subject],
        );

        if (linked.rows.length > 0) {
          user = linked.rows[0];
        } else {
          if (!identity.email) {
            await client.query('ROLLBACK');
            return reply.status(403).send({
              error: 'Apple did not share an email. Sign in with the Apple ID first used to link this account.',
            });
          }

          const account = await client.query(
            `SELECT id, public_id, full_name, email, role, status
             FROM users WHERE LOWER(email) = $1 FOR UPDATE`,
            [identity.email],
          );
          if (account.rows.length === 0 || account.rows[0].role !== 'CITIZEN') {
            await client.query('ROLLBACK');
            return reply.status(403).send({
              error: 'No citizen account matches this email. Create an account first, then sign in socially.',
            });
          }

          user = account.rows[0];
          const existingProvider = await client.query(
            'SELECT provider_user_id FROM social_identities WHERE user_id = $1 AND provider = $2',
            [user.id, identity.provider],
          );
          if (
            existingProvider.rows.length > 0 &&
            existingProvider.rows[0].provider_user_id !== identity.subject
          ) {
            await client.query('ROLLBACK');
            return reply.status(409).send({ error: 'This account is linked to a different provider identity.' });
          }

          await client.query(
            `INSERT INTO social_identities (user_id, provider, provider_user_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (provider, provider_user_id) DO NOTHING`,
            [user.id, identity.provider, identity.subject],
          );
        }

        if (user.role !== 'CITIZEN') {
          await client.query('ROLLBACK');
          return reply.status(403).send({ error: 'Access denied' });
        }
        if (user.status !== 'ACTIVE') {
          await client.query('ROLLBACK');
          return reply.status(403).send({ error: `Account is ${user.status.toLowerCase()}` });
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      return reply.status(200).send(await createSession(fastify, user));
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Unable to complete social sign-in. Please try again.' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/forgot-password
  // Always returns the same public message so callers cannot enumerate emails.
  // ---------------------------------------------------------------------------
  fastify.post('/forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email } = forgotPasswordSchema.parse(request.body);
      const bucketKey = `${request.ip}:${email}`;
      if (
        !consumeResetRequest(`ip:${request.ip}`, 20) ||
        !consumeResetRequest(`account:${bucketKey}`, 5)
      ) {
        return reply.status(429).send({ error: 'Too many reset requests. Please wait and try again.' });
      }

      const result = await query(
        `SELECT id FROM users
         WHERE LOWER(email) = $1 AND role = 'CITIZEN' AND status = 'ACTIVE'`,
        [email],
      );
      let debugCode: string | undefined;

      if (result.rows.length > 0) {
        const userId = result.rows[0].id;
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        const codeHash = hashResetCode(email, code);
        const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);
        const inserted = await query(
          `INSERT INTO password_reset_tokens (user_id, code_hash, expires_at)
           VALUES ($1, $2, $3) RETURNING id`,
          [userId, codeHash, expiresAt],
        );

        try {
          await sendPasswordResetEmail(email, code);
        } catch (error) {
          await query('DELETE FROM password_reset_tokens WHERE id = $1', [inserted.rows[0].id]);
          throw error;
        }
        if (process.env.NODE_ENV !== 'production') debugCode = code;
      }

      return reply.status(200).send({
        message: 'If an active citizen account exists for that email, a reset code has been sent.',
        ...(debugCode ? { debugCode } : {}),
      });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
      fastify.log.error(err);
      return reply.status(503).send({ error: 'Unable to send a reset code right now. Please try again.' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/reset-password
  // Consumes the newest valid code and revokes every existing device session.
  // ---------------------------------------------------------------------------
  fastify.post('/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email, code, password } = resetPasswordSchema.parse(request.body);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT prt.id, prt.user_id, prt.code_hash, prt.attempts
           FROM password_reset_tokens prt
           JOIN users u ON u.id = prt.user_id
           WHERE LOWER(u.email) = $1
             AND prt.used_at IS NULL
             AND prt.expires_at > NOW()
           ORDER BY prt.created_at DESC
           LIMIT 1
           FOR UPDATE OF prt`,
          [email],
        );

        if (result.rows.length === 0 || result.rows[0].attempts >= 5) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'The reset code is invalid or has expired.' });
        }

        const token = result.rows[0];
        const suppliedHash = hashResetCode(email, code);
        const matches = crypto.timingSafeEqual(
          Buffer.from(token.code_hash, 'hex'),
          Buffer.from(suppliedHash, 'hex'),
        );
        if (!matches) {
          await client.query(
            'UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = $1',
            [token.id],
          );
          await client.query('COMMIT');
          return reply.status(400).send({ error: 'The reset code is invalid or has expired.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, token.user_id]);
        await client.query(
          'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
          [token.user_id],
        );
        await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [token.user_id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      return reply.status(200).send({ message: 'Password reset successfully. You can now sign in.' });
    } catch (err: any) {
      if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Unable to reset the password. Please try again.' });
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

  // Identity fields such as email, NIN, role and status remain server-owned.
  fastify.patch(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = request.user as { id: string };
        const input = updateProfileSchema.parse(request.body);
        const result = await query(
          `UPDATE users
           SET full_name = $2, phone = $3
           WHERE id = $1 AND role = 'CITIZEN'
           RETURNING id, public_id, full_name, email, phone, nin, role, status, created_at`,
          [payload.id, input.fullName, input.phone || null],
        );
        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'User not found' });
        }
        return reply.status(200).send({ user: result.rows[0] });
      } catch (err: any) {
        if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}

async function createSession(fastify: FastifyInstance, user: any) {
  const accessToken = fastify.jwt.sign(
    { id: user.id, public_id: user.public_id, email: user.email, role: user.role },
    { expiresIn: '15m' },
  );
  const refreshToken = await createRefreshToken(user.id);
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      public_id: user.public_id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
  };
}

function hashResetCode(email: string, code: string): string {
  const pepper = process.env.PASSWORD_RESET_PEPPER || process.env.JWT_SECRET || 'local-development-only';
  return crypto.createHash('sha256').update(`${email}:${code}:${pepper}`).digest('hex');
}

function consumeResetRequest(key: string, limit: number): boolean {
  const now = Date.now();
  if (resetRequestBuckets.size > 10_000) {
    for (const [candidate, bucket] of resetRequestBuckets) {
      if (bucket.resetsAt <= now) resetRequestBuckets.delete(candidate);
    }
  }
  const current = resetRequestBuckets.get(key);
  if (!current || current.resetsAt <= now) {
    resetRequestBuckets.set(key, { count: 1, resetsAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
