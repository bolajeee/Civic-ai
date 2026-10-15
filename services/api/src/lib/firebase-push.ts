import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
let cachedToken: { value: string; expiresAt: number } | undefined;

export class PushDeliveryError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly invalidToken = false) {
    super(code);
  }
}

export function isPushDeliveryEnabled(): boolean {
  return process.env.PUSH_NOTIFICATIONS_ENABLED?.toLowerCase() === 'true' &&
    Boolean(process.env.FIREBASE_PROJECT_ID?.trim()) &&
    Boolean(process.env.FIREBASE_CLIENT_EMAIL?.trim()) &&
    Boolean(process.env.FIREBASE_PRIVATE_KEY?.trim());
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const email = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new PushDeliveryError('FIREBASE_CREDENTIALS_MISSING', false);
  const now = Math.floor(Date.now() / 1000);
  const header = encoded({ alg: 'RS256', typ: 'JWT' });
  const claims = encoded({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const unsigned = `${header}.${claims}`;
  let signature: string;
  try { signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url'); }
  catch { throw new PushDeliveryError('FIREBASE_PRIVATE_KEY_INVALID', false); }

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
  } catch { throw new PushDeliveryError('FIREBASE_AUTH_CONNECTION_FAILED', true); }
  if (!response.ok) throw new PushDeliveryError(`FIREBASE_AUTH_HTTP_${response.status}`, response.status >= 500 || response.status === 429);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new PushDeliveryError('FIREBASE_AUTH_INVALID_RESPONSE', true);
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

export async function sendFirebasePush(input: {
  token: string; title: string; body: string; data: Record<string, unknown>;
}): Promise<string> {
  const project = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!project) throw new PushDeliveryError('FIREBASE_PROJECT_ID_MISSING', false);
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: {
        token: input.token,
        notification: { title: input.title, body: input.body },
        data: Object.fromEntries(Object.entries(input.data).map(([key, value]) => [key, String(value)])),
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      } }),
    });
  } catch { throw new PushDeliveryError('FCM_CONNECTION_FAILED', true); }
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const status = payload?.error?.status;
    const invalid = status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT';
    throw new PushDeliveryError(`FCM_${status ?? response.status}`, !invalid && (response.status === 429 || response.status >= 500), invalid);
  }
  if (typeof payload.name !== 'string') throw new PushDeliveryError('FCM_INVALID_RESPONSE', true);
  return payload.name;
}
