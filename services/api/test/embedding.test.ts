import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEmbeddingText } from '../src/ai/embedding';

test('buildEmbeddingText labels fields and omits empty ones', () => {
  const text = buildEmbeddingText({
    categoryLabel: 'Pothole',
    description: '  Deep hole near the junction ',
    address: null,
    visualEvidence: '',
  });
  assert.equal(text, 'Category: Pothole\nDescription: Deep hole near the junction');
});

test('buildEmbeddingText includes location and visual evidence', () => {
  const text = buildEmbeddingText({
    categoryLabel: 'Flooding',
    description: null,
    address: 'Ikeja, Lagos',
    visualEvidence: 'Water covers the road surface.',
  });
  assert.equal(
    text,
    'Category: Flooding\nLocation: Ikeja, Lagos\nVisible evidence: Water covers the road surface.',
  );
});
