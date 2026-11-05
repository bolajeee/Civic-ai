import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { verifyIdentityToken } from '../src/lib/identity-tokens';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: 'jwk' });
const originalFetch = global.fetch;

global.fetch = async () =>
  new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] }), {
    status: 200,
    headers: { 'cache-control': 'max-age=3600' },
  });

test.after(() => {
  global.fetch = originalFetch;
  delete process.env.GOOGLE_CLIENT_IDS;
  delete process.env.APPLE_CLIENT_IDS;
});

test('accepts a signed Google token with a configured audience and verified email', async () => {
  process.env.GOOGLE_CLIENT_IDS = 'google-web-client';
  const token = sign({
    iss: 'https://accounts.google.com',
    aud: 'google-web-client',
    sub: 'google-user-1',
    exp: now() + 300,
    iat: now(),
    email: 'Citizen@Example.com',
    email_verified: true,
  });

  assert.deepEqual(await verifyIdentityToken('google', token), {
    provider: 'google',
    subject: 'google-user-1',
    email: 'citizen@example.com',
  });
});

test('rejects a provider token issued for another application', async () => {
  process.env.GOOGLE_CLIENT_IDS = 'expected-client';
  const token = sign({
    iss: 'https://accounts.google.com',
    aud: 'attacker-client',
    sub: 'google-user-1',
    exp: now() + 300,
  });

  await assert.rejects(verifyIdentityToken('google', token), /audience is invalid/);
});

test('Apple token requires the hash of the exact per-attempt nonce', async () => {
  process.env.APPLE_CLIENT_IDS = 'com.example.civicReport';
  const rawNonce = 'a-secure-random-nonce-for-this-test';
  const token = sign({
    iss: 'https://appleid.apple.com',
    aud: 'com.example.civicReport',
    sub: 'apple-user-1',
    exp: now() + 300,
    email: 'citizen@example.com',
    email_verified: 'true',
    nonce: crypto.createHash('sha256').update(rawNonce).digest('hex'),
  });

  const identity = await verifyIdentityToken('apple', token, rawNonce);
  assert.equal(identity.subject, 'apple-user-1');
  await assert.rejects(
    verifyIdentityToken('apple', token, 'a-different-secure-random-nonce'),
    /nonce is invalid/,
  );
});

function sign(payload: Record<string, unknown>): string {
  const header = encode({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const body = encode(payload);
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey);
  return `${header}.${body}.${signature.toString('base64url')}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}
