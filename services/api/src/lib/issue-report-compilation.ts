export interface CompilationSourceReport {
  id: string;
  publicId: string;
  description: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
  submittedAt: string;
  location: { address: string | null; latitude: number; longitude: number } | null;
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
  };
}
