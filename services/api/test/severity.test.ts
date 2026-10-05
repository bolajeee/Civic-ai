import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { estimateReportSeverity, isSeverityEnabled, severityConfidenceThreshold, SeverityError } from '../src/ai/severity';

const savedEnv = { ...process.env };
const input = { image: Buffer.from('photo'), mimeType: 'image/jpeg', model: 'test-model', threshold: 0.65,
  context: { category: { slug: 'POTHOLE', label: 'Pothole' }, description: null, location: null } };
const prediction = { level: 'HIGH', confidence: 0.9, visualEvidence: 'A large section of road is damaged.',
  descriptionEvidence: 'No citizen description was supplied.', geographicContext: 'Location is unavailable.',
  uncertainty: 'Depth and scale cannot be measured from this photo.' };
beforeEach(() => { process.env.OPENAI_API_KEY = 'test-key'; });
afterEach(() => { mock.restoreAll(); process.env = { ...savedEnv }; });
function response(result: unknown = prediction, message: object = {}) {
  return Response.json({ model: 'test-model-version', choices: [{ finish_reason: 'stop',
    message: { content: JSON.stringify(result), ...message } }] });
}
function fetchResult(result: Response | Error) {
  return mock.method(globalThis, 'fetch', async () => {
    if (result instanceof Error) throw result;
    return result;
  });
}
test('severity requires its own explicit flag and a key', () => {
  process.env.AI_CLASSIFICATION_ENABLED = 'true';
  delete process.env.AI_SEVERITY_ENABLED;
  assert.equal(isSeverityEnabled(), false);
  process.env.AI_SEVERITY_ENABLED = ' TRUE ';
  assert.equal(isSeverityEnabled(), true);
  process.env.OPENAI_API_KEY = ' ';
  assert.equal(isSeverityEnabled(), false);
});
test('blank, invalid, bounded and zero confidence thresholds', () => {
  for (const [value, expected] of [['', 0.65], [' ', 0.65], ['invalid', 0.65], ['0', 0], ['2', 1], ['-1', 0]] as const) {
    process.env.AI_SEVERITY_MIN_CONFIDENCE = value;
    assert.equal(severityConfidenceThreshold(), expected);
  }
});
test('validated image estimate retains provenance and separates evidence sources', async () => {
  const fetch = fetchResult(response());
  const result = await estimateReportSeverity(input);
  assert.equal(result.level, 'HIGH');
  assert.equal(result.score, 0.75);
  assert.equal(result.modelVersion, 'test-model-version');
  assert.equal(result.rubricVersion, 'civic-severity-v1');
  assert.equal(result.reviewRequired, false);
  const body = JSON.parse(String(fetch.mock.calls[0].arguments[1]?.body));
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(JSON.parse(body.messages[1].content[0].text), input.context);
  assert.ok(body.messages[1].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
});
test('all accepted levels have a stable ordinal score; critical requires review', async () => {
  for (const [level, score] of [['LOW', 0.25], ['MODERATE', 0.5], ['HIGH', 0.75], ['CRITICAL', 1]] as const) {
    fetchResult(response({ ...prediction, level }));
    const result = await estimateReportSeverity(input);
    assert.equal(result.level, level);
    assert.equal(result.score, score);
    assert.equal(result.reviewRequired, level === 'CRITICAL');
    mock.restoreAll();
  }
});
test('unsure and low confidence retain suggestions but have no usable level or score', async () => {
  for (const change of [{ level: 'UNSURE' }, { confidence: 0.64 }]) {
    fetchResult(response({ ...prediction, ...change }));
    const result = await estimateReportSeverity(input);
    assert.equal(result.level, null);
    assert.equal(result.score, null);
    assert.equal(result.reviewRequired, true);
    assert.equal(result.suggestedLevel, change.level ?? 'HIGH');
    mock.restoreAll();
  }
});
test('malformed, empty, out of range and oversized results are retried', async () => {
  for (const change of [null, { ...prediction, level: 'URGENT' }, { ...prediction, confidence: -0.1 },
    { ...prediction, visualEvidence: ' ' }, { ...prediction, uncertainty: 'x'.repeat(601) }]) {
    fetchResult(response(change));
    await assert.rejects(estimateReportSeverity(input), (error: unknown) =>
      error instanceof SeverityError && error.code === 'OPENAI_INVALID_RESULT' && error.retryable);
    mock.restoreAll();
  }
});
test('refusal is permanent; truncated or invalid JSON responses are retryable', async () => {
  fetchResult(response(null, { refusal: 'refused' }));
  await assert.rejects(estimateReportSeverity(input), (e: unknown) => e instanceof SeverityError && !e.retryable);
  mock.restoreAll();
  fetchResult(new Response('{', { status: 200 }));
  await assert.rejects(estimateReportSeverity(input), (e: unknown) => e instanceof SeverityError && e.code === 'OPENAI_INVALID_JSON');
  mock.restoreAll();
  fetchResult(Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(prediction) } }] }));
  await assert.rejects(estimateReportSeverity(input), (e: unknown) => e instanceof SeverityError && e.retryable);
});
test('transient HTTP/network failures retry and permanent HTTP failures do not', async () => {
  for (const [status, retryable] of [[429, true], [503, true], [401, false], [400, false]] as const) {
    fetchResult(new Response('{}', { status }));
    await assert.rejects(estimateReportSeverity(input), (e: unknown) =>
      e instanceof SeverityError && e.code === 'OPENAI_HTTP_' + status && e.retryable === retryable);
    mock.restoreAll();
  }
  fetchResult(new Error('offline'));
  await assert.rejects(estimateReportSeverity(input), (e: unknown) => e instanceof SeverityError && e.retryable);
});
test('unsupported images and absent credentials fail before any API call', async () => {
  const fetch = fetchResult(response());
  await assert.rejects(estimateReportSeverity({ ...input, mimeType: 'image/heic' }), (e: unknown) =>
    e instanceof SeverityError && e.code === 'UNSUPPORTED_IMAGE_TYPE' && !e.retryable);
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(estimateReportSeverity(input), (e: unknown) =>
    e instanceof SeverityError && e.code === 'OPENAI_API_KEY_MISSING');
  assert.equal(fetch.mock.callCount(), 0);
});
