import crypto from 'crypto';
import { query } from '../db';

// How long a refresh token lives (30 days)
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Generates a cryptographically random opaque refresh token,
 * stores its SHA-256 hash in the DB, and returns the raw token
 * to be sent to the client once (never stored in plain text).
 */
export async function createRefreshToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(64).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );

  return rawToken;
}

/**
 * Validates a raw refresh token:
 *  - looks up its hash in the DB
 *  - checks it belongs to the given user
 *  - checks it is not revoked
 *  - checks it has not expired
 *
 * Returns the DB row if valid, throws an error otherwise.
 */
export async function verifyRefreshToken(rawToken: string, userId: string) {
  const tokenHash = hashToken(rawToken);

  const result = await query(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1
       AND user_id    = $2
       AND revoked    = FALSE
       AND expires_at > NOW()`,
    [tokenHash, userId],
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid or expired refresh token');
  }

  return result.rows[0];
}

/**
 * Rotates a refresh token: revokes the old one and issues a fresh one.
 * This is the core of the "refresh token rotation" strategy — each use
 * produces a new token, so replayed / stolen tokens are detected quickly.
 */
export async function rotateRefreshToken(
  oldRawToken: string,
  userId: string,
): Promise<string> {
  const tokenHash = hashToken(oldRawToken);

  // Revoke the old token
  await query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
    [tokenHash],
  );

  // Issue a new one
  return createRefreshToken(userId);
}

/**
 * Revokes a single refresh token (used on explicit logout).
 */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
    [tokenHash],
  );
}

/**
 * Revokes ALL refresh tokens for a user (used on password change,
 * account suspension, or "logout from all devices").
 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`,
    [userId],
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
