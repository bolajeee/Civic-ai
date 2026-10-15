import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileIssueReport, type CompilationInput } from '../src/lib/issue-report-compilation';

const input: CompilationInput = {
  generatedAt: '2026-10-15T12:00:00.000Z',
  cluster: { id: 'cluster', publicId: 'IC-1000', status: 'PENDING',
    category: { slug: 'POTHOLE', label: 'Pothole' }, centroid: { latitude: 6.5, longitude: 3.4 } },
  sourceReports: [
    { id: 'two', publicId: 'CR-2', description: ' Deep hole near the junction. ', status: 'IN_PROGRESS',
      submittedAt: '2026-10-15T10:00:00.000Z', location: null },
    { id: 'one', publicId: 'CR-1', description: null, status: 'PENDING',
      submittedAt: '2026-10-14T10:00:00.000Z', location: { address: 'Main Road', latitude: 6.5, longitude: 3.4 } },
  ],
};

test('compiles deterministic, source-linked findings without inventing a narrative', () => {
  const result = compileIssueReport(input);
  assert.equal(result.liveDraft, true);
  assert.equal(result.cluster.reportCount, 2);
  assert.deepEqual(result.coverage, {
    firstObservedAt: '2026-10-14T10:00:00.000Z', lastObservedAt: '2026-10-15T10:00:00.000Z',
    withLocation: 1, withoutLocation: 1, withDescription: 1, withoutDescription: 1,
    statuses: { pending: 1, inProgress: 1, resolved: 0, rejected: 0 },
  });
  assert.deepEqual(result.findings[0].sourceReportIds, ['CR-1', 'CR-2']);
  assert.deepEqual(result.findings[2].sourceReportIds, ['CR-1']);
  assert.deepEqual(result.observations, [{ text: 'Deep hole near the junction.', sourceReportIds: ['CR-2'] }]);
  assert.equal('description' in result.sources[0], false);
});

test('compiles an empty source set without false location or date claims', () => {
  const result = compileIssueReport({ ...input, sourceReports: [] });
  assert.equal(result.coverage.firstObservedAt, null);
  assert.equal(result.coverage.lastObservedAt, null);
  assert.equal(result.findings[2].text, '0 of 0 source reports include saved GPS coordinates.');
  assert.deepEqual(result.observations, []);
});
