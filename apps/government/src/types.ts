export interface GovernmentUser { id: string; email: string; role: 'ADMIN' | 'OPERATOR' }
export interface Session { accessToken: string; refreshToken: string; user: GovernmentUser }
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
