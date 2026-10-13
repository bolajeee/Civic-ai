import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateImpactScore } from '../src/lib/impact-score';

test('impact score is zero without accepted reports', () => {
  assert.equal(calculateImpactScore({ total: 0, inProgress: 0, resolved: 0, rejected: 0 }), 0);
  assert.equal(calculateImpactScore({ total: 2, inProgress: 0, resolved: 0, rejected: 2 }), 0);
});

test('impact score rewards contribution, engagement, and resolution', () => {
  assert.equal(calculateImpactScore({ total: 1, inProgress: 0, resolved: 0, rejected: 0 }), 3);
  assert.equal(calculateImpactScore({ total: 4, inProgress: 1, resolved: 1, rejected: 0 }), 35);
  assert.equal(calculateImpactScore({ total: 10, inProgress: 0, resolved: 10, rejected: 0 }), 100);
});

test('impact score is capped and rejected reports add no points', () => {
  assert.equal(calculateImpactScore({ total: 12, inProgress: 0, resolved: 10, rejected: 2 }), 100);
  assert.equal(calculateImpactScore({ total: 100, inProgress: 100, resolved: 100, rejected: 0 }), 100);
});
