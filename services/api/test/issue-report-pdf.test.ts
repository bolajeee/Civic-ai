import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileIssueReport, type CompilationInput } from '../src/lib/issue-report-compilation';
import { renderIssueReportPdf } from '../src/lib/issue-report-pdf';

function report(description: string): CompilationInput {
  return {
    generatedAt: '2026-10-15T12:00:00.000Z',
    cluster: { id: 'cluster', publicId: 'IC-1000', status: 'PENDING',
      category: { slug: 'POTHOLE', label: 'Pothole' }, centroid: null },
    sourceReports: [{
      id: 'report', publicId: 'CR-1', description, status: 'PENDING',
      submittedAt: '2026-10-14T10:00:00.000Z', location: null, photoCount: 2,
      assignmentMethod: 'AI', pendingReviewCount: 1, classification: null, severity: null,
    }],
  };
}

test('renders a valid downloadable PDF containing the reviewable report sections', () => {
  const pdf = renderIssueReportPdf(compileIssueReport(report('Large pothole (near bridge)')));
  const content = pdf.toString('latin1');
  assert.ok(pdf.subarray(0, 8).equals(Buffer.from('%PDF-1.4')));
  assert.match(content, /CivicAI Issue Report/);
  assert.match(content, /LIVE DRAFT - NOT FORMALLY APPROVED/);
  assert.match(content, /Review status: BLOCKED/);
  assert.match(content, /Unresolved disagreements/);
  assert.match(content, /Evidence appendix/);
  assert.ok(content.includes('Large pothole \\(near bridge\\)'));
  assert.match(content, /xref\n0 \d+/);
  assert.match(content, /startxref\n\d+\n%%EOF/);
});

test('paginates long evidence appendices and numbers every page', () => {
  const longDescription = Array.from({ length: 450 }, (_, index) => `observation${index}`).join(' ');
  const content = renderIssueReportPdf(compileIssueReport(report(longDescription))).toString('latin1');
  const count = Number(content.match(/\/Type \/Pages .*\/Count (\d+)/)?.[1]);
  assert.ok(count > 1);
  for (let page = 1; page <= count; page += 1) assert.match(content, new RegExp(`Page ${page} of ${count}`));
});

test('labels immutable versions and repeats their identity in page furniture', () => {
  const compiled = compileIssueReport(report('Snapshot evidence'));
  const pdf = renderIssueReportPdf({ ...compiled, liveDraft: false,
    version: { id: 'version-id', number: 3, createdAt: '2026-10-15T13:00:00.000Z', createdBy: 'GV-12' } });
  const content = pdf.toString('latin1');
  assert.match(content, /IMMUTABLE VERSION 3 - NOT FORMALLY APPROVED/);
  assert.match(content, /CivicAI \/ IC-1000 \/ Version 3/);
  assert.match(content, /immutable evidence snapshot/);
  assert.doesNotMatch(content, /generated from live cluster membership/);
});

test('binds formal approval details to the rendered immutable snapshot', () => {
  const compiled = compileIssueReport(report('Approved evidence'));
  const content = renderIssueReportPdf({ ...compiled, liveDraft: false,
    version: { id: 'version-id', number: 4, createdAt: '2026-10-15T13:00:00.000Z', createdBy: 'GV-12',
      approval: { approvedAt: '2026-10-15T14:00:00.000Z', approvedBy: 'GV-2',
        reason: 'Reviewed against every cited source.' } } }).toString('latin1');
  assert.match(content, /FORMALLY APPROVED IMMUTABLE VERSION 4/);
  assert.match(content, /Approved by: GV-2/);
  assert.match(content, /Reviewed against every cited source/);
  assert.match(content, /snapshot bound to the formal approval/);
});
