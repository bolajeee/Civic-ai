import crypto from 'node:crypto';

export const VISUAL_EMBEDDING_DIMENSIONS = 1408;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png']);
let cachedToken: { value: string; expiresAt: number } | undefined;

export class VisualEmbeddingError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = 'VisualEmbeddingError';
  }
}

export function visualEmbeddingModel(): string {
  return process.env.VERTEX_AI_IMAGE_EMBEDDING_MODEL?.trim() || 'multimodalembedding@001';
}

export function visualEmbeddingLocation(): string {
  return process.env.VERTEX_AI_LOCATION?.trim() || 'us-central1';
}

export function supportedVisualEmbeddingTypes(): string[] {
  return [...SUPPORTED_TYPES];
}

export function isSupportedVisualEmbeddingType(mimeType: string): boolean {
  return SUPPORTED_TYPES.has(mimeType);
}

export function isVisualEmbeddingEnabled(): boolean {
  return process.env.AI_IMAGE_EMBEDDINGS_ENABLED?.trim().toLowerCase() === 'true' &&
    Boolean(process.env.VERTEX_AI_PROJECT_ID?.trim()) &&
    Boolean(process.env.VERTEX_AI_CLIENT_EMAIL?.trim()) &&
    Boolean(process.env.VERTEX_AI_PRIVATE_KEY?.trim());
}

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const email = process.env.VERTEX_AI_CLIENT_EMAIL?.trim();
  const privateKey = process.env.VERTEX_AI_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new VisualEmbeddingError('VERTEX_CREDENTIALS_MISSING', false);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({
    iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;
  let signature: string;
  try {
    signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  } catch {
    throw new VisualEmbeddingError('VERTEX_PRIVATE_KEY_INVALID', false);
  }
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
  } catch {
    throw new VisualEmbeddingError('VERTEX_AUTH_CONNECTION_FAILED', true);
  }
  if (!response.ok) {
    throw new VisualEmbeddingError(
      `VERTEX_AUTH_HTTP_${response.status}`,
      response.status === 429 || response.status >= 500,
    );
  }
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new VisualEmbeddingError('VERTEX_AUTH_INVALID_RESPONSE', true);
  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

export async function generateVisualEmbedding(input: {
  image: Buffer;
  mimeType: string;
  model: string;
}): Promise<{ vector: number[]; modelVersion: string }> {
  if (!isSupportedVisualEmbeddingType(input.mimeType)) {
    throw new VisualEmbeddingError('UNSUPPORTED_IMAGE_TYPE', false);
  }
  if (input.image.length === 0) throw new VisualEmbeddingError('EMPTY_IMAGE', false);
  const project = process.env.VERTEX_AI_PROJECT_ID?.trim();
  const location = visualEmbeddingLocation();
  if (!project || !/^[a-z0-9-]+$/.test(location)) {
    throw new VisualEmbeddingError('VERTEX_CONFIGURATION_INVALID', false);
  }
  const token = await accessToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}` +
    `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(input.model)}:predict`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        instances: [{ image: {
          bytesBase64Encoded: input.image.toString('base64'),
          mimeType: input.mimeType,
        } }],
        parameters: { dimension: VISUAL_EMBEDDING_DIMENSIONS },
      }),
    });
  } catch {
    throw new VisualEmbeddingError('VERTEX_CONNECTION_FAILED', true);
  }
  if (!response.ok) {
    if (response.status === 401) cachedToken = undefined;
    throw new VisualEmbeddingError(
      `VERTEX_HTTP_${response.status}`,
      response.status === 401 || response.status === 408 ||
        response.status === 429 || response.status >= 500,
    );
  }
  const payload = await response.json() as {
    deployedModelId?: string;
    predictions?: Array<{ imageEmbedding?: unknown }>;
  };
  const vector = payload.predictions?.[0]?.imageEmbedding;
  if (!Array.isArray(vector) || vector.length !== VISUAL_EMBEDDING_DIMENSIONS ||
      !vector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new VisualEmbeddingError('VERTEX_INVALID_RESULT', true);
  }
  return { vector: vector as number[], modelVersion: payload.deployedModelId ?? input.model };
}
