import type { AdminSnapshot, ClusterDetailSnapshot, ClusterEvidenceSnapshot, ClusterFilters, ClustersSnapshot, GovernmentAccount, GovernmentAccountStatus, GovernmentRole, MapFilters, MapSnapshot, Overview, ReportDetailSnapshot, ReportFilters, ReportsSnapshot, Session } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Tokens live in memory. Concurrent expired requests share a single rotation. */
export class GovernmentApi {
  private session: Session | null = null;
  private refresh: Promise<void> | null = null;
  constructor(private onSession: (session: Session | null) => void,
    private transport: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}

  private setSession(session: Session | null) {
    this.session = session;
    this.onSession(session);
  }

  private async send<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const response = await this.transport(`/api/gov${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', ...init.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status,
      typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`);
    return data as T;
  }

  async login(email: string, password: string) {
    const session = await this.send<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!['ADMIN', 'OPERATOR'].includes(session.user.role)) throw new ApiError(403, 'Access denied');
    this.setSession(session);
  }

  async register(email: string, password: string, nin: string, inviteCode: string) {
    const session = await this.send<Session>('/auth/register', {
      method: 'POST', body: JSON.stringify({ email, password, nin, inviteCode }),
    });
    if (!['ADMIN', 'OPERATOR'].includes(session.user.role)) throw new ApiError(403, 'Access denied');
    this.setSession(session);
  }

  private async rotate(previous: Session) {
    try {
      const tokens = await this.send<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
        method: 'POST', body: JSON.stringify({ userId: previous.user.id, refreshToken: previous.refreshToken }),
      });
      // A late response cannot restore a signed-out session.
      if (this.session !== previous) throw new ApiError(401, 'Session ended. Please sign in again.');
      this.setSession({ ...previous, ...tokens });
    } catch (error) {
      if (this.session === previous) this.setSession(null);
      throw error;
    }
  }

  private async authorized<T>(path: string, init?: RequestInit | (() => RequestInit)): Promise<T> {
    const options = () => typeof init === 'function' ? init() : init;
    const previous = this.session;
    if (!previous) throw new ApiError(401, 'Please sign in.');
    try { return await this.send<T>(path, options(), previous.accessToken); }
    catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        if (this.session === previous) this.setSession(null);
        throw error;
      }
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (!this.session) throw error;
      if (this.session === previous) {
        if (!this.refresh) this.refresh = this.rotate(previous).finally(() => { this.refresh = null; });
        await this.refresh;
      }
      const current = this.session;
      if (!current) throw new ApiError(401, 'Please sign in again.');
      try { return await this.send<T>(path, options(), current.accessToken); }
      catch (retryError) {
        if (retryError instanceof ApiError && [401, 403].includes(retryError.status) && this.session === current) this.setSession(null);
        throw retryError;
      }
    }
  }

  overview() { return this.authorized<Overview>('/dashboard/overview'); }
  reports(filters: ReportFilters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return this.authorized<ReportsSnapshot>(`/reports/?${params}`);
  }
  report(id: string) { return this.authorized<ReportDetailSnapshot>(`/reports/${encodeURIComponent(id)}`); }
  clusters(filters: ClusterFilters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return this.authorized<ClustersSnapshot>(`/issue-clusters/?${params}`);
  }
  cluster(id: string) { return this.authorized<ClusterDetailSnapshot>(`/issue-clusters/${encodeURIComponent(id)}`); }
  clusterEvidence(id: string, page = 1, limit = 20) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return this.authorized<ClusterEvidenceSnapshot>(`/issue-clusters/${encodeURIComponent(id)}/evidence?${params}`);
  }
  map(filters: MapFilters) {
    const params = new URLSearchParams({ bbox: filters.bbox.join(','), layer: filters.layer });
    if (filters.status) params.set('status', filters.status);
    if (filters.category) params.set('category', filters.category);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    return this.authorized<MapSnapshot>(`/dashboard/map?${params}`);
  }
  administration() { return this.authorized<AdminSnapshot>('/admin/'); }
  createInvitation(role: GovernmentRole, expiresInHours: number) {
    return this.authorized<{ invitation: { id: string; role: GovernmentRole; expiresAt: string; createdAt: string }; code: string }>(
      '/admin/invitations', { method: 'POST', body: JSON.stringify({ role, expiresInHours }) });
  }
  revokeInvitation(id: string) {
    return this.authorized<void>(`/admin/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  updateAccountStatus(id: string, status: GovernmentAccountStatus) {
    return this.authorized<{ account: GovernmentAccount }>(`/admin/accounts/${encodeURIComponent(id)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
  }

  async logout() {
    const previous = this.session;
    try {
      if (previous) await this.authorized('/auth/logout', () => ({
        method: 'POST', body: JSON.stringify({ refreshToken: this.session?.refreshToken }),
      }));
    } finally { this.setSession(null); }
  }
}
