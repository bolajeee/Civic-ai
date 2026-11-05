import crypto from 'crypto';

export type SocialProvider = 'google' | 'apple';

export interface VerifiedIdentity {
  provider: SocialProvider;
  subject: string;
  email?: string;
}

interface JsonWebKey extends crypto.webcrypto.JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface JwtClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  email?: unknown;
  email_verified?: unknown;
  nonce?: unknown;
}

const keyCache = new Map<string, { expiresAt: number; keys: JsonWebKey[] }>();

export async function verifyIdentityToken(
  provider: SocialProvider,
  token: string,
  rawNonce?: string,
): Promise<VerifiedIdentity> {
  const config = providerConfig(provider);
  if (config.audiences.length === 0) {
    throw new Error(`${provider.toUpperCase()}_CLIENT_IDS is not configured`);
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed identity token');

  const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
  const claims = decodeJson<JwtClaims>(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported identity token');

  const keys = await getKeys(config.jwksUrl);
  const jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!jwk) {
    keyCache.delete(config.jwksUrl);
    const refreshed = await getKeys(config.jwksUrl);
    const replacement = refreshed.find(
      (candidate) => candidate.kid === header.kid && candidate.kty === 'RSA',
    );
    if (!replacement) throw new Error('Identity provider signing key was not found');
    verifySignature(parts, replacement);
  } else {
    verifySignature(parts, jwk);
  }

  validateClaims(claims, config.issuers, config.audiences);

  if (provider === 'apple') {
    if (!rawNonce) throw new Error('Apple sign-in nonce is required');
    const expectedNonce = crypto.createHash('sha256').update(rawNonce).digest('hex');
    if (claims.nonce !== expectedNonce) throw new Error('Apple sign-in nonce is invalid');
  }

  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  return {
    provider,
    subject: claims.sub as string,
    email:
      typeof claims.email === 'string' && emailVerified
        ? claims.email.trim().toLowerCase()
        : undefined,
  };
}

function providerConfig(provider: SocialProvider) {
  if (provider === 'google') {
    return {
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
      audiences: readAudienceList('GOOGLE_CLIENT_IDS'),
    };
  }
  return {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    audiences: readAudienceList('APPLE_CLIENT_IDS'),
  };
}

function readAudienceList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function getKeys(url: string): Promise<JsonWebKey[]> {
  const cached = keyCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Unable to retrieve identity provider signing keys');
  const body = (await response.json()) as { keys?: JsonWebKey[] };
  if (!Array.isArray(body.keys)) throw new Error('Identity provider returned invalid signing keys');

  const cacheControl = response.headers.get('cache-control') ?? '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3600);
  keyCache.set(url, { keys: body.keys, expiresAt: Date.now() + maxAge * 1000 });
  return body.keys;
}

function verifySignature(parts: string[], jwk: JsonWebKey) {
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!valid) throw new Error('Identity token signature is invalid');
}

function validateClaims(claims: JwtClaims, issuers: string[], audiences: string[]) {
  const now = Math.floor(Date.now() / 1000);
  const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (typeof claims.iss !== 'string' || !issuers.includes(claims.iss)) {
    throw new Error('Identity token issuer is invalid');
  }
  if (!tokenAudiences.some((audience) => typeof audience === 'string' && audiences.includes(audience))) {
    throw new Error('Identity token audience is invalid');
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('Identity token subject is invalid');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= now - 30) {
    throw new Error('Identity token has expired');
  }
  if (typeof claims.iat === 'number' && claims.iat > now + 30) {
    throw new Error('Identity token issue time is invalid');
  }
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('Malformed identity token');
  }
}
