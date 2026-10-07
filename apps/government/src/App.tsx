import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { GovernmentApi } from './api';
import type { Overview, Session } from './types';
import { MapView } from './MapView';

const number = (value: number) => value.toLocaleString('en-NG');
const date = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [page, setPage] = useState<'overview' | 'map'>('overview');
  const api = useMemo(() => new GovernmentApi(setSession), []);
  async function logout() {
    setSigningOut(true);
    try { await api.logout(); setNotice('You have signed out.'); }
    catch { setNotice('Signed out on this browser. Session revocation could not be confirmed by the server.'); }
    finally { setSigningOut(false); }
  }
  if (!session) return <Login api={api} notice={notice} />;
  return <div className="workspace">
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark">C</span>CivicAI<span className="brand-dot">●</span></a>
      <p className="workspace-label">GOVERNMENT WORKSPACE</p>
      <nav aria-label="Workspace">{(['overview', 'map'] as const).map(item => <a key={item} className={page === item ? 'nav-active' : ''} href={`#${item}`} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}><span>{item === 'overview' ? '▦' : '◎'}</span>{item === 'overview' ? 'Overview' : 'Issue map'}</a>)}</nav>
      <div className="sidebar-note"><span className="live-dot" />Citizen observations.<br />Better public decisions.</div>
      <div className="account"><span className="avatar">{session.user.email[0].toUpperCase()}</span><div><strong>{session.user.role === 'ADMIN' ? 'Administrator' : 'Operator'}</strong><small>{session.user.email}</small></div></div>
      <button className="signout" onClick={logout} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
    </aside>
    <main id={page}><header className="topbar"><span>Operations / <strong>{page === 'overview' ? 'Overview' : 'Issue map'}</strong></span><span className="workspace-tag">Government portal</span></header>
      {page === 'overview' ? <Dashboard key={session.user.id} api={api} /> : <MapView key={session.user.id} api={api} />}
    </main>
  </div>;
}

function Login({ api, notice }: { api: GovernmentApi; notice: string }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try { await api.login(String(form.get('email')).trim(), String(form.get('password'))); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-story"><a href="/" className="brand"><span className="brand-mark">C</span>CivicAI</a><div><p className="eyebrow">CIVIC INTELLIGENCE</p><h1>A clearer view of<br />what needs attention.</h1><p>Bring citizen observations together.<br />Make informed decisions for your community.</p></div><small>Government operations workspace</small></section>
    <section className="login-panel"><form onSubmit={submit}><p className="eyebrow">WELCOME BACK</p><h2>Sign in to your workspace</h2><p className="muted">Use your government operator or administrator account.</p>
      {notice && <p role="status" className="notice">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
      <label>Email address<input name="email" type="email" autoComplete="username" placeholder="you@agency.gov.ng" required disabled={busy} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required disabled={busy} /></label>
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="login-help">Access is restricted to active government accounts. Contact your administrator if you need an account.</p>
    </form></section></main>;
}

function Dashboard({ api }: { api: GovernmentApi }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api.overview().then(result => { if (active) setData(result); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Unable to load overview.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, revision]);
  return <div className="dashboard"><div className="page-title"><div><p className="eyebrow">OPERATIONS AT A GLANCE</p><h1>Overview</h1><p className="muted">See the issues your community is reporting.</p></div><button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? 'Refreshing…' : '↻ Refresh'}</button></div>
    {error && <div role="alert" className="error">{error} {data ? 'Showing the previous snapshot.' : 'Check the API connection and try Refresh.'}</div>}
    {!data && busy && <div role="status" className="empty panel">Loading the government overview…</div>}
    {data && <><p className="updated">Snapshot: {date(data.generatedAt)} WAT · All submitted reports</p>
      <div className="stats">
        <Stat title="Citizen reports" value={data.reports.total} detail={`${number(data.reports.pending)} pending review`} symbol="▤" />
        <Stat title="Open issue clusters" value={data.clusters.open} detail={`${number(data.clusters.total)} non-empty clusters in total`} symbol="◎" />
        <Stat title="Grouping review" value={data.groupingReview.reports} detail={`${number(data.groupingReview.candidates)} pending candidate matches`} symbol="◇" />
        <Stat title="Resolved clusters" value={data.clusters.resolved} detail="Cluster and report statuses are separate" symbol="✓" />
      </div>
      <div className="overview-grid"><section className="panel categories"><PanelTitle title="Reports by category" detail="Open and total observations" />
        {data.reports.total === 0 && <p className="muted">No reports have been submitted yet.</p>}
        {data.categories.map(category => <div className="category-row" key={category.slug}><div><strong>{category.label}</strong><span>{number(category.open)} open <b> / {number(category.total)} total</b></span></div><div className="bar" role="img" aria-label={`${category.label}: ${category.total} reports, ${category.open} open`}><span style={{ width: `${data.reports.total ? category.total / data.reports.total * 100 : 0}%` }} /></div></div>)}
      </section><section className="panel"><PanelTitle title="Report lifecycle" detail="Status of original citizen reports" />
        <dl className="metrics">{[['Pending', data.reports.pending], ['In progress', data.reports.inProgress], ['Resolved', data.reports.resolved], ['Rejected', data.reports.rejected]].map(([title, value]) => <div key={title}><dt><span className={`status-dot ${String(title).toLowerCase().replaceAll(' ', '-')}`} />{title}</dt><dd>{number(Number(value))}</dd></div>)}</dl>
        <div className="quality"><strong>Data completeness</strong><p>{number(data.unclusteredReports)} reports awaiting cluster assignment</p><p>{number(data.reports.withoutLocation)} reports without GPS</p></div>
      </section></div>
      <section className="panel priority"><div><p className="eyebrow">PRIORITY READINESS</p><h2>Keep uncertainty visible</h2><p className="muted">Priority scores support triage. Missing evidence and sourced context require review.</p></div>
        {data.priority.enabled ? <dl className="priority-counts">{[['Scored', data.priority.completed], ['Incomplete', data.priority.incomplete], ['Unavailable', data.priority.unavailable], ['Pending', data.priority.pending], ['Failed', data.priority.failed], ['Inactive', data.priority.inactive]].map(([title, value]) => <div key={title}><dd>{number(Number(value ?? 0))}</dd><dt>{title}</dt></div>)}</dl> : <span className="badge">Priority calculation disabled</span>}
      </section>
      <section className="panel activity"><PanelTitle title="Recent citizen reports" detail="Latest 8 observations across the full dataset" />
        {data.recentReports.length === 0 ? <p className="empty muted">Submitted reports will appear here.</p> : <div className="table-scroll"><table><thead><tr><th>Reference</th><th>Category / location</th><th>Status</th><th>Cluster</th><th>Submitted (WAT)</th></tr></thead><tbody>{data.recentReports.map(report => <tr key={report.id}><td className="reference">{report.publicId}</td><td><strong>{report.category}</strong><small>{report.address || (report.hasLocation ? 'GPS captured · address unavailable' : 'No GPS supplied')}</small></td><td><span className={`badge ${report.status.toLowerCase()}`}>{label(report.status)}</span></td><td>{report.clusterPublicId || <span className="muted">Unassigned</span>}</td><td>{date(report.submittedAt)}</td></tr>)}</tbody></table></div>}
      </section><footer>Citizen reports are observations. Issue clusters represent the underlying problem.</footer>
    </>}
  </div>;
}

function Stat({ title, value, detail, symbol }: { title: string; value: number; detail: string; symbol: string }) {
  return <section className="panel stat"><div><span>{title}</span><span className="stat-icon" aria-hidden="true">{symbol}</span></div><strong>{number(value)}</strong><small>{detail}</small></section>;
}
function PanelTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="panel-title"><h2>{title}</h2><p className="muted">{detail}</p></div>;
}
