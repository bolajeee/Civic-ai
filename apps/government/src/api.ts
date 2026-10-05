import type { Overview, Session } from './types';

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

  async logout() {
    const previous = this.session;
    try {
      if (previous) await this.authorized('/auth/logout', () => ({
        method: 'POST', body: JSON.stringify({ refreshToken: this.session?.refreshToken }),
      }));
    } finally { this.setSession(null); }
  }
}
