import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, mock, test } from 'node:test';
import {
  generateVisualEmbedding,
  isVisualEmbeddingEnabled,
  VISUAL_EMBEDDING_DIMENSIONS,
  VisualEmbeddingError,
} from '../src/ai/visual_embedding';

const savedEnv = { ...process.env };
afterEach(() => { mock.restoreAll(); process.env = { ...savedEnv }; });

test('visual embeddings require an explicit flag and complete Vertex credentials', () => {
  process.env.AI_IMAGE_EMBEDDINGS_ENABLED = 'true';
  process.env.VERTEX_AI_PROJECT_ID = 'project';
  process.env.VERTEX_AI_CLIENT_EMAIL = 'worker@example.test';
  process.env.VERTEX_AI_PRIVATE_KEY = 'key';
  assert.equal(isVisualEmbeddingEnabled(), true);
  delete process.env.VERTEX_AI_PROJECT_ID;
  assert.equal(isVisualEmbeddingEnabled(), false);
});

test('unsupported images fail before authentication or network access', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response('{}'));
  await assert.rejects(
    generateVisualEmbedding({ image: Buffer.from('image'), mimeType: 'image/heic', model: 'model' }),
    (error: unknown) => error instanceof VisualEmbeddingError && error.code === 'UNSUPPORTED_IMAGE_TYPE',
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test('Vertex response is validated and records its deployed model', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.VERTEX_AI_PROJECT_ID = 'civic-project';
  process.env.VERTEX_AI_LOCATION = 'us-central1';
  process.env.VERTEX_AI_CLIENT_EMAIL = 'worker@example.test';
  process.env.VERTEX_AI_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
    String(url).includes('oauth2.googleapis.com')
      ? Response.json({ access_token: 'token', expires_in: 3600 })
      : Response.json({ deployedModelId: 'deployed-1', predictions: [{
          imageEmbedding: new Array(VISUAL_EMBEDDING_DIMENSIONS).fill(0.25),
        }] }));

  const result = await generateVisualEmbedding({
    image: Buffer.from('image'), mimeType: 'image/jpeg', model: 'multimodalembedding@001',
  });
  assert.equal(result.vector.length, VISUAL_EMBEDDING_DIMENSIONS);
  assert.equal(result.modelVersion, 'deployed-1');
  assert.equal(fetch.mock.callCount(), 2);
  const request = fetch.mock.calls[1].arguments[1] as RequestInit;
  const body = JSON.parse(String(request.body));
  assert.equal(body.parameters.dimension, VISUAL_EMBEDDING_DIMENSIONS);
  assert.equal(body.instances[0].image.mimeType, 'image/jpeg');
});
