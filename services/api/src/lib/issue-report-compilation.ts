export interface CompilationSourceReport {
  id: string;
  publicId: string;
  description: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
  submittedAt: string;
  location: { address: string | null; latitude: number; longitude: number } | null;
  photoCount: number;
  assignmentMethod: 'AI' | 'HUMAN' | 'SYSTEM';
  pendingReviewCount: number;
  classification: null | {
    status: string; suggestedCategory: string | null; acceptedCategory: string | null;
    confidence: number | null; evidence: string | null;
  };
  severity: null | {
    status: string; suggestedLevel: string | null; acceptedLevel: string | null;
    confidence: number | null; reviewRequired: boolean | null; uncertainty: string | null;
  };
}

export interface CompilationInput {
  generatedAt: string;
  cluster: {
    id: string;
    publicId: string;
    category: { slug: string; label: string };
    status: string;
    centroid: { latitude: number; longitude: number } | null;
  };
  sourceReports: CompilationSourceReport[];
}

const countByStatus = (reports: CompilationSourceReport[]) => ({
  pending: reports.filter(report => report.status === 'PENDING').length,
  inProgress: reports.filter(report => report.status === 'IN_PROGRESS').length,
  resolved: reports.filter(report => report.status === 'RESOLVED').length,
  rejected: reports.filter(report => report.status === 'REJECTED').length,
});

export function compileIssueReport(input: CompilationInput) {
  const reports = [...input.sourceReports].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt) || a.publicId.localeCompare(b.publicId));
  const sourceReportIds = reports.map(report => report.publicId);
  const located = reports.filter(report => report.location);
  const described = reports.filter(report => report.description?.trim());
  const statuses = countByStatus(reports);
  const firstObservedAt = reports[0]?.submittedAt ?? null;
  const lastObservedAt = reports.at(-1)?.submittedAt ?? null;
  const pendingGrouping = reports.filter(report => report.pendingReviewCount > 0);
  const categoryMismatches = reports.filter(report => report.classification?.acceptedCategory
    && report.classification.acceptedCategory !== input.cluster.category.slug);
  const acceptedSeverityLevels = new Set(reports.flatMap(report => report.severity?.acceptedLevel
    ? [report.severity.acceptedLevel] : []));
  const severitySources = reports.filter(report => report.severity?.acceptedLevel);
  const disagreements = [
    ...(pendingGrouping.length ? [{
      kind: 'GROUPING' as const,
      summary: `${pendingGrouping.length} source report${pendingGrouping.length === 1 ? ' has' : 's have'} unresolved grouping proposals.`,
      sourceReportIds: pendingGrouping.map(report => report.publicId),
    }] : []),
    ...(categoryMismatches.length ? [{
      kind: 'CATEGORY' as const,
      summary: `${categoryMismatches.length} accepted AI category suggestion${categoryMismatches.length === 1 ? '' : 's'} differ from the cluster category.`,
      sourceReportIds: categoryMismatches.map(report => report.publicId),
    }] : []),
    ...(acceptedSeverityLevels.size > 1 ? [{
      kind: 'SEVERITY' as const,
      summary: `Accepted severity assessments differ across sources (${[...acceptedSeverityLevels].sort().join(', ')}).`,
      sourceReportIds: severitySources.map(report => report.publicId),
    }] : []),
  ];
  const uncertainties = [
    ...issue('MISSING_LOCATION', reports.filter(report => !report.location), 'have no saved GPS coordinates'),
    ...issue('MISSING_DESCRIPTION', reports.filter(report => !report.description?.trim()), 'have no description'),
    ...issue('MISSING_MEDIA', reports.filter(report => report.photoCount === 0), 'have no attached photos'),
    ...issue('CLASSIFICATION_INCOMPLETE', reports.filter(report => report.classification?.status !== 'COMPLETED'), 'do not have a completed image classification'),
    ...issue('SEVERITY_REVIEW', reports.filter(report => report.severity?.status !== 'COMPLETED'
      || report.severity.reviewRequired === true), 'have unavailable, incomplete, or review-required severity evidence'),
  ];
  const reviewStatus = pendingGrouping.length || categoryMismatches.length
    ? 'BLOCKED' as const
    : disagreements.length || uncertainties.length ? 'NEEDS_REVIEW' as const : 'READY_FOR_REVIEW' as const;

  return {
    generatedAt: input.generatedAt,
    liveDraft: true as const,
    cluster: { ...input.cluster, reportCount: reports.length },
    coverage: {
      firstObservedAt,
      lastObservedAt,
      withLocation: located.length,
      withoutLocation: reports.length - located.length,
      withDescription: described.length,
      withoutDescription: reports.length - described.length,
      statuses,
    },
    findings: [
      {
        kind: 'OVERVIEW' as const,
        text: `${reports.length} citizen report${reports.length === 1 ? '' : 's'} currently support this ${input.cluster.category.label.toLowerCase()} issue cluster.`,
        sourceReportIds,
      },
      {
        kind: 'LIFECYCLE' as const,
        text: `${statuses.pending} pending, ${statuses.inProgress} in progress, ${statuses.resolved} resolved, and ${statuses.rejected} rejected source reports.`,
        sourceReportIds,
      },
      {
        kind: 'LOCATION' as const,
        text: `${located.length} of ${reports.length} source reports include saved GPS coordinates.`,
        sourceReportIds: located.map(report => report.publicId),
      },
    ],
    observations: described.map(report => ({
      text: report.description!.trim(),
      sourceReportIds: [report.publicId],
    })),
    sources: reports.map(({ description: _description, ...report }) => report),
    disagreements,
    uncertainties,
    review: {
      status: reviewStatus,
      reasons: reviewStatus === 'READY_FOR_REVIEW' ? [] : [
        ...(disagreements.length ? [`${disagreements.length} unresolved disagreement type${disagreements.length === 1 ? '' : 's'}`] : []),
        ...(uncertainties.length ? [`${uncertainties.length} outstanding uncertainty type${uncertainties.length === 1 ? '' : 's'}`] : []),
      ],
      formalApprovalRecorded: false as const,
    },
    evidenceAppendix: reports.map(report => ({
      sourceReportId: report.publicId,
      description: report.description?.trim() || null,
      status: report.status,
      submittedAt: report.submittedAt,
      location: report.location,
      photoCount: report.photoCount,
      assignmentMethod: report.assignmentMethod,
      classification: report.classification,
      severity: report.severity,
    })),
  };
}

function issue(kind: string, reports: CompilationSourceReport[], phrase: string) {
  if (!reports.length) return [];
  return [{
    kind,
    summary: `${reports.length} source report${reports.length === 1 ? '' : 's'} ${phrase}.`,
    sourceReportIds: reports.map(report => report.publicId),
  }];
}
