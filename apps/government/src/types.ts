export interface GovernmentUser { id: string; email: string; role: 'ADMIN' | 'OPERATOR' }
export interface Session { accessToken: string; refreshToken: string; user: GovernmentUser }
export type GovernmentRole = 'ADMIN' | 'OPERATOR';
export type GovernmentAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
export interface GovernmentAccount {
  id: string; publicId: string; email: string; role: GovernmentRole; status: GovernmentAccountStatus;
  createdAt: string; updatedAt: string;
}
export interface GovernmentInvitation {
  id: string; role: GovernmentRole; expiresAt: string; createdAt: string;
  usedAt: string | null; revokedAt: string | null; createdByEmail: string | null; usedByEmail: string | null;
}
export interface AdminSnapshot {
  generatedAt: string; accounts: GovernmentAccount[]; invitations: GovernmentInvitation[];
}
export interface ReportFilters {
  page?: number; limit?: number; q?: string; status?: string; category?: string;
  grouping?: 'all' | 'assigned' | 'unassigned'; location?: 'all' | 'present' | 'missing'; from?: string; to?: string;
}
export interface GovernmentReport {
  id: string; publicId: string; description: string | null; status: string; submittedAt: string; updatedAt: string;
  category: { slug: string; label: string };
  location: { latitude: number; longitude: number; accuracy: number | null; address: string | null } | null;
  cluster: { id: string; publicId: string; status: string } | null;
}
export interface ReportsSnapshot {
  generatedAt: string; page: number; limit: number; total: number;
  categories: Array<{ slug: string; label: string }>;
  reports: Array<GovernmentReport & { photoCount: number }>;
}
export interface ReportDetailSnapshot {
  report: GovernmentReport & { photos: Array<{ id: string; mediaType: string; displayOrder: number; url: string | null }> };
  photosExpireInSeconds: number;
}
export interface ClusterFilters {
  page?: number; limit?: number; q?: string; status?: string; category?: string;
  review?: 'all' | 'pending' | 'clear'; assignment?: 'all' | 'AI' | 'HUMAN' | 'SYSTEM';
  location?: 'all' | 'present' | 'missing';
}
export interface ClusterPriority { status: string; score: number | null; band: string | null }
export interface IssueCluster {
  id: string; publicId: string; status: string; reportCount: number; createdAt: string; updatedAt: string;
  category: { slug: string; label: string };
  centroid: { latitude: number; longitude: number } | null;
  pendingReviewCount: number;
  reportStatuses: { pending: number; inProgress: number; resolved: number; rejected: number };
  priority: ClusterPriority;
}
export interface ClustersSnapshot {
  generatedAt: string; page: number; limit: number; total: number; priorityEnabled: boolean;
  categories: Array<{ slug: string; label: string }>; clusters: IssueCluster[];
}
export interface ClusterDetailSnapshot {
  priorityEnabled: boolean;
  cluster: IssueCluster & {
    anchorLocation: { latitude: number; longitude: number; accuracy: number | null; address: string | null } | null;
    grouping: { ai: number; human: number; system: number; averageConfidence: number | null;
      firstAssignedAt: string | null; lastAssignedAt: string | null };
  };
}
export interface ClusterEvidenceReport {
  id: string; publicId: string; description: string | null; status: string;
  submittedAt: string; updatedAt: string; category: { slug: string; label: string };
  location: { latitude: number; longitude: number; accuracy: number | null; address: string | null } | null;
  photos: Array<{ id: string; mediaType: string; displayOrder: number; url: string | null }>;
  grouping: {
    assignmentMethod: 'AI' | 'HUMAN' | 'SYSTEM'; confidence: number | null; assignedAt: string;
    visualSimilarity: null; visualSignalStatus: 'not_implemented';
    search: null | { status: string; candidateCount: number; scoringVersion: string; errorCode: string | null };
    decision: null | { outcome: string; decidedAt: string; clusteringVersion: string; scoringVersion: string | null;
      errorCode: string | null; autoMinScore: number | null; ambiguityMargin: number | null; radiusMeters: number | null;
      matchedReport: { id: string; publicId: string } | null;
      signals: null | { distanceMeters: number; semanticSimilarity: number; categoryMatch: boolean;
        combinedScore: number; scoringVersion: string } };
    competingCandidates: Array<{ cluster: { id: string; publicId: string };
      report: { id: string; publicId: string } | null; score: number; reason: string; status: string;
      scoringVersion: string; distanceMeters: number | null; semanticSimilarity: number | null;
      categoryMatch: boolean | null }>;
  };
}
export interface ClusterEvidenceSnapshot {
  generatedAt: string; page: number; limit: number; total: number;
  cluster: { id: string; publicId: string }; reports: ClusterEvidenceReport[];
  photosExpireInSeconds: number;
}
export type MapLayer = 'reports' | 'clusters' | 'all';
export interface MapFilters { bbox: [number, number, number, number]; layer: MapLayer; status?: string; category?: string; limit?: number }
export interface MapFeature {
  type: 'Feature'; id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { kind: 'report' | 'cluster'; publicId: string; status: string; category: string; categorySlug: string;
    submittedAt?: string; createdAt?: string; address?: string | null; accuracy?: number | null;
    clusterPublicId?: string | null; reportCount?: number };
}
export interface MapCollection { type: 'FeatureCollection'; total: number; withoutGeometry: number; features: MapFeature[] }
export interface MapSnapshot {
  generatedAt: string; bbox: [number, number, number, number]; limit: number;
  categories: Array<{ slug: string; label: string }>; reports: MapCollection; clusters: MapCollection;
}
export interface Overview {
  generatedAt: string;
  reports: { total: number; pending: number; inProgress: number; resolved: number; rejected: number; withoutLocation: number };
  clusters: { total: number; open: number; resolved: number; rejected: number };
  unclusteredReports: number;
  groupingReview: { candidates: number; reports: number };
  priority: { enabled: boolean; completed?: number; incomplete?: number; unavailable?: number; inactive?: number; pending?: number; failed?: number };
  categories: Array<{ slug: string; label: string; total: number; open: number }>;
  recentReports: Array<{ id: string; publicId: string; category: string; status: string; submittedAt: string;
    address: string | null; hasLocation: boolean; clusterPublicId: string | null }>;
}
