import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, mock } from 'node:test';
import {
  ClassificationError,
  classificationConfidenceThreshold,
  classifyReportImage,
  isClassificationEnabled,
  isSupportedClassificationImageType,
} from '../src/ai/classification';
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingError,
  generateEmbedding,
  isEmbeddingEnabled,
} from '../src/ai/embedding';

// No test contacts OpenAI: fetch is replaced for each one.
const categories = [
  { id: 'c1', slug: 'POTHOLE', label: 'Pothole' },
  { id: 'c2', slug: 'FLOODING', label: 'Flooding' },
];
const image = { image: Buffer.from('x'), mimeType: 'image/jpeg', model: 'm' };
const savedEnv = { ...process.env };

function mockFetch(response: Response | Error) {
  return mock.method(globalThis, 'fetch', async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

function chatResponse(content: unknown, extra: object = {}) {
  return Response.json({
    model: 'm-2026',
    choices: [
      { message: { content: JSON.stringify(content), ...extra } },
    ],
  });
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected the promise to reject');
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  mock.restoreAll();
  process.env = { ...savedEnv };
});

test('classification is enabled only with the flag and a key', () => {
  process.env.AI_CLASSIFICATION_ENABLED = 'true';
  assert.equal(isClassificationEnabled(), true);
  process.env.OPENAI_API_KEY = '  ';
  assert.equal(isClassificationEnabled(), false);
  process.env.OPENAI_API_KEY = 'k';
  process.env.AI_CLASSIFICATION_ENABLED = 'false';
  assert.equal(isClassificationEnabled(), false);
});

test('confidence threshold defaults to 0.65 and is clamped to 0-1', () => {
  delete process.env.AI_CLASSIFICATION_MIN_CONFIDENCE;
  assert.equal(classificationConfidenceThreshold(), 0.65);
  process.env.AI_CLASSIFICATION_MIN_CONFIDENCE = '4';
  assert.equal(classificationConfidenceThreshold(), 1);
  process.env.AI_CLASSIFICATION_MIN_CONFIDENCE = 'abc';
  assert.equal(classificationConfidenceThreshold(), 0.65);
});

test('only formats the vision model accepts are classified', () => {
  assert.equal(isSupportedClassificationImageType('image/jpeg'), true);
  assert.equal(isSupportedClassificationImageType('image/heic'), false);
});

test('classifyReportImage returns a validated result', async () => {
  const fetchMock = mockFetch(
    chatResponse({
      category_slug: 'POTHOLE',
      confidence: 0.9,
      evidence: 'A hole in the road.',
    }),
  );

  const result = await classifyReportImage({ ...image, categories });

  assert.deepEqual(result, {
    categorySlug: 'POTHOLE',
    confidence: 0.9,
    evidence: 'A hole in the road.',
    modelVersion: 'm-2026',
  });
  const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1]?.body));
  assert.deepEqual(
    body.response_format.json_schema.schema.properties.category_slug.enum,
    ['POTHOLE', 'FLOODING', 'UNSURE'],
  );
});

test('a slug outside the allowed set is rejected as retryable', async () => {
  mockFetch(
    chatResponse({ category_slug: 'DRAGON', confidence: 0.9, evidence: 'x' }),
  );
  const error = await rejection(classifyReportImage({ ...image, categories }));
  assert.ok(error instanceof ClassificationError);
  assert.equal(error.code, 'OPENAI_INVALID_RESULT');
  assert.equal(error.retryable, true);
});

test('an out-of-range confidence is rejected', async () => {
  mockFetch(
    chatResponse({ category_slug: 'POTHOLE', confidence: 1.5, evidence: 'x' }),
  );
  const error = await rejection(classifyReportImage({ ...image, categories }));
  assert.equal((error as ClassificationError).code, 'OPENAI_INVALID_RESULT');
});

test('a refusal is permanent', async () => {
  mockFetch(chatResponse(null, { refusal: 'no' }));
  const error = await rejection(classifyReportImage({ ...image, categories }));
  assert.equal((error as ClassificationError).code, 'OPENAI_REFUSED');
  assert.equal((error as ClassificationError).retryable, false);
});

test('HTTP 429 and 5xx retry, 400 and 401 do not', async () => {
  for (const [status, retryable] of [
    [429, true],
    [503, true],
    [400, false],
    [401, false],
  ] as const) {
    mockFetch(new Response('{}', { status }));
    const error = await rejection(
      classifyReportImage({ ...image, categories }),
    );
    assert.equal((error as ClassificationError).code, 'OPENAI_HTTP_' + status);
    assert.equal((error as ClassificationError).retryable, retryable);
    mock.restoreAll();
  }
});

test('a network failure is retryable', async () => {
  mockFetch(new Error('offline'));
  const error = await rejection(classifyReportImage({ ...image, categories }));
  assert.equal((error as ClassificationError).code, 'OPENAI_CONNECTION_FAILED');
  assert.equal((error as ClassificationError).retryable, true);
});

test('bad input fails before any network call', async () => {
  const fetchMock = mockFetch(new Response('{}'));

  delete process.env.OPENAI_API_KEY;
  let error = await rejection(classifyReportImage({ ...image, categories }));
  assert.equal((error as ClassificationError).code, 'OPENAI_API_KEY_MISSING');

  process.env.OPENAI_API_KEY = 'k';
  error = await rejection(
    classifyReportImage({ ...image, mimeType: 'image/heic', categories }),
  );
  assert.equal((error as ClassificationError).code, 'UNSUPPORTED_IMAGE_TYPE');

  error = await rejection(classifyReportImage({ ...image, categories: [] }));
  assert.equal((error as ClassificationError).code, 'NO_CATEGORIES_CONFIGURED');

  assert.equal(fetchMock.mock.callCount(), 0);
});

test('embeddings are enabled only with their own flag and a key', () => {
  process.env.AI_EMBEDDINGS_ENABLED = 'true';
  assert.equal(isEmbeddingEnabled(), true);
  delete process.env.AI_EMBEDDINGS_ENABLED;
  assert.equal(isEmbeddingEnabled(), false);
});

test('generateEmbedding returns a vector of the fixed dimension', async () => {
  const fetchMock = mockFetch(
    Response.json({
      model: 'e-2026',
      data: [{ embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.1) }],
    }),
  );

  const result = await generateEmbedding({ text: 'Category: Pothole', model: 'e' });

  assert.equal(result.vector.length, EMBEDDING_DIMENSIONS);
  assert.equal(result.modelVersion, 'e-2026');
  const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1]?.body));
  assert.equal(body.dimensions, EMBEDDING_DIMENSIONS);
});

test('a wrong-sized vector is rejected before it reaches the database', async () => {
  mockFetch(Response.json({ data: [{ embedding: [0.1, 0.2] }] }));
  const error = await rejection(generateEmbedding({ text: 't', model: 'e' }));
  assert.ok(error instanceof EmbeddingError);
  assert.equal(error.code, 'OPENAI_INVALID_RESULT');
});

test('empty input and HTTP failures are classified correctly', async () => {
  let error = await rejection(generateEmbedding({ text: '  ', model: 'e' }));
  assert.equal((error as EmbeddingError).code, 'EMPTY_INPUT');
  assert.equal((error as EmbeddingError).retryable, false);

  mockFetch(new Response('{}', { status: 429 }));
  error = await rejection(generateEmbedding({ text: 't', model: 'e' }));
  assert.equal((error as EmbeddingError).retryable, true);
});
