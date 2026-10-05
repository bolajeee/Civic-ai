import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  duplicateConfig,
  duplicateScore,
  isDuplicateDetectionEnabled,
  rankDuplicateCandidates,
} from '../src/ai/duplicates';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

const near = { distanceMeters: 0, semanticSimilarity: 1, categoryMatch: true };

test('an identical report at the same spot scores 1', () => {
  assert.equal(duplicateScore(near, 200), 1);
});

test('distance falls to zero at the radius and never goes negative', () => {
  const atEdge = { ...near, distanceMeters: 200 };
  assert.ok(Math.abs(duplicateScore(atEdge, 200) - 0.6) < 1e-9);
  assert.ok(Math.abs(duplicateScore({ ...atEdge, distanceMeters: 900 }, 200) - 0.6) < 1e-9);
});

test('a different category loses its weight', () => {
  const score = duplicateScore({ ...near, categoryMatch: false }, 200);
  assert.ok(Math.abs(score - 0.8) < 1e-9);
});

test('out-of-range similarity is clamped', () => {
  assert.equal(duplicateScore({ ...near, semanticSimilarity: 1.4 }, 200), 1);
  assert.ok(
    Math.abs(duplicateScore({ ...near, semanticSimilarity: -1 }, 200) - 0.6) < 1e-9,
  );
});

test('ranking drops weak candidates, sorts best first and keeps five', () => {
  const config = { radiusMeters: 200, minScore: 0.6 };
  const make = (id: string, similarity: number) => ({
    id,
    distanceMeters: 20,
    semanticSimilarity: similarity,
    categoryMatch: true,
  });
  const ranked = rankDuplicateCandidates(
    [
      make('weak', 0),
      make('a', 0.5),
      make('best', 1),
      make('b', 0.6),
      make('c', 0.7),
      make('d', 0.8),
      make('e', 0.9),
    ],
    config,
  );

  assert.deepEqual(
    ranked.map((candidate) => candidate.id),
    ['best', 'e', 'd', 'c', 'b'],
  );
});

test('config falls back on bad values and clamps the threshold', () => {
  process.env.AI_DUPLICATE_RADIUS_METERS = '-5';
  process.env.AI_DUPLICATE_MIN_SCORE = '3';
  assert.deepEqual(duplicateConfig(), { radiusMeters: 200, minScore: 1 });

  process.env.AI_DUPLICATE_RADIUS_METERS = '75';
  process.env.AI_DUPLICATE_MIN_SCORE = 'x';
  assert.deepEqual(duplicateConfig(), { radiusMeters: 75, minScore: 0.6 });
});

test('detection is opt-in', () => {
  delete process.env.AI_DUPLICATE_DETECTION_ENABLED;
  assert.equal(isDuplicateDetectionEnabled(), false);
  process.env.AI_DUPLICATE_DETECTION_ENABLED = 'true';
  assert.equal(isDuplicateDetectionEnabled(), true);
});
