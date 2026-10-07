export interface GovernmentUser { id: string; email: string; role: 'ADMIN' | 'OPERATOR' }
export interface Session { accessToken: string; refreshToken: string; user: GovernmentUser }
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
