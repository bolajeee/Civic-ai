import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { GovernmentApi } from './api';
import type { ClusterDetailSnapshot, ClusterFilters, ClustersSnapshot, IssueCluster } from './types';
import './clusters.css';

const date = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const initial: ClusterFilters = { q: '', status: '', category: '', limit: 20 };

export function ClustersView({ api }: { api: GovernmentApi }) {
  const [draft, setDraft] = useState<ClusterFilters>(initial);
  const [filters, setFilters] = useState<ClusterFilters>({ ...initial, page: 1 });
  const [snapshot, setSnapshot] = useState<{ key: string; data: ClustersSnapshot } | null>(null);
  const [categories, setCategories] = useState<ClustersSnapshot['categories']>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const key = JSON.stringify(filters);
  const data = snapshot?.key === key ? snapshot.data : null;

  useEffect(() => {
    let active = true;
    setBusy(true); setError(''); setSelected(null);
    api.clusters(filters).then(result => {
      if (active) { setSnapshot({ key, data: result }); setCategories(result.categories); }
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : 'Unable to load issue clusters.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, filters, key, revision]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft, q: draft.q?.trim(), page: 1 });
  }
  function reset() { setDraft(initial); setFilters({ ...initial, page: 1 }); }
  function close() { setSelected(null); opener.current?.focus(); }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return <div className="dashboard clusters-page">
    <div className="page-title"><div><p className="eyebrow">GROUPED COMMUNITY ISSUES</p><h1>Issue clusters</h1>
      <p className="muted">See the underlying issues formed from related citizen observations.</p></div>
      <button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? 'Loading…' : 'Refresh'}</button></div>
    <form className="panel cluster-filters" onSubmit={apply}>
      <label className="cluster-search">Search clusters<input aria-label="Search clusters" value={draft.q} maxLength={200} placeholder="Cluster reference or category" onChange={event => setDraft(value => ({ ...value, q: event.target.value }))} /></label>
      <label>Status<select aria-label="Cluster status" value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value }))}><option value="">All statuses</option>{['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Category<select aria-label="Cluster category" value={draft.category} onChange={event => setDraft(value => ({ ...value, category: event.target.value }))}><option value="">All categories</option>{categories.map(value => <option key={value.slug} value={value.slug}>{value.label}</option>)}</select></label>
      <label>Clusters per page<select aria-label="Clusters per page" value={draft.limit} onChange={event => setDraft(value => ({ ...value, limit: Number(event.target.value) }))}>{[20, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <div className="cluster-filter-actions"><button className="refresh" type="button" onClick={reset}>Reset</button><button className="primary" type="submit">Apply filters</button></div>
    </form>
    {error && <p className="error" role="alert">{error} {data ? 'Showing the previous snapshot for these filters and this page.' : 'Try Refresh to load these clusters.'}</p>}
    <section className="panel clusters-list" aria-label="Issue clusters" aria-busy={busy}>
      {busy && <p role="status" className="muted">Loading issue clusters…</p>}
      {data && <><div className="cluster-list-heading"><div><h2>{data.total.toLocaleString('en-NG')} matching clusters</h2><p className="muted">Only non-empty clusters are shown.</p></div><p className="updated">Snapshot: {date(data.generatedAt)} WAT</p></div>
        {data.clusters.length ? <div className="table-scroll"><table><thead><tr><th>Reference</th><th>Category</th><th>Cluster status</th><th>Reports</th><th>Report lifecycle</th><th>Grouping review</th><th>Priority</th><th>Updated (WAT)</th></tr></thead>
          <tbody>{data.clusters.map(cluster => <tr key={cluster.id}><td><button className="cluster-reference" onClick={event => { opener.current = event.currentTarget; setSelected(cluster.id); }} aria-expanded={selected === cluster.id}>{cluster.publicId}</button></td>
            <td><strong>{cluster.category.label}</strong></td><td><span className={`badge ${cluster.status.toLowerCase()}`}>{label(cluster.status)}</span></td>
            <td>{cluster.reportCount.toLocaleString('en-NG')}</td><td><Lifecycle cluster={cluster} /></td>
            <td>{cluster.pendingReviewCount ? <span className="review-count">{cluster.pendingReviewCount} pending</span> : <span className="muted">None pending</span>}</td>
            <td><Priority cluster={cluster} enabled={data.priorityEnabled} /></td><td>{date(cluster.updatedAt)}</td></tr>)}</tbody></table></div>
          : <p className="empty muted">{data.total ? 'This page has no clusters. Return to the first page or refresh.' : 'No issue clusters match these filters.'}</p>}
        <div className="cluster-pagination"><span>Page {data.page} of {pages}</span><div>
          {data.page > pages && <button className="refresh" disabled={busy} onClick={() => setFilters(value => ({ ...value, page: 1 }))}>First page</button>}
          <button className="refresh" disabled={busy || data.page <= 1} onClick={() => setFilters(value => ({ ...value, page: Math.max(1, (value.page ?? 1) - 1) }))}>Previous</button>
          <button className="refresh" disabled={busy || data.page >= pages} onClick={() => setFilters(value => ({ ...value, page: (value.page ?? 1) + 1 }))}>Next</button>
        </div></div></>}
    </section>
    {selected && <ClusterDetails key={selected} api={api} id={selected} close={close} />}
  </div>;
}

function Lifecycle({ cluster }: { cluster: IssueCluster }) {
  const values = cluster.reportStatuses;
  return <span className="cluster-lifecycle" aria-label={`${values.pending} pending, ${values.inProgress} in progress, ${values.resolved} resolved, ${values.rejected} rejected`}>
    {values.pending} pending · {values.inProgress} active · {values.resolved} resolved
  </span>;
}

function Priority({ cluster, enabled }: { cluster: IssueCluster; enabled: boolean }) {
  if (!enabled) return <span className="muted">Disabled</span>;
  if (cluster.priority.score != null) return <span className={`priority-band ${cluster.priority.band?.toLowerCase() || ''}`}>{cluster.priority.band || 'Scored'} · {cluster.priority.score}</span>;
  return <span className="muted">{label(cluster.priority.status)}</span>;
}

function ClusterDetails({ api, id, close }: { api: GovernmentApi; id: string; close: () => void }) {
  const [data, setData] = useState<ClusterDetailSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api.cluster(id).then(result => { if (active) setData(result); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Unable to load cluster details.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, id, revision]);
  useEffect(() => { heading.current?.focus(); }, [data]);
  const cluster = data?.cluster;
  return <section className="panel cluster-detail" aria-label="Cluster summary" aria-busy={busy}>
    <div className="page-title"><div><p className="eyebrow">CLUSTER SUMMARY</p><h2 ref={heading} tabIndex={-1}>{cluster?.publicId || 'Issue cluster'}</h2></div><div className="cluster-detail-actions"><button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh summary</button><button className="refresh" onClick={close}>Close summary</button></div></div>
    {error && <p className="error" role="alert">{error} {data && 'Showing the previously loaded summary.'}</p>}
    {busy && <p className="muted" role="status">Loading cluster summary…</p>}
    {cluster && <><dl className="cluster-facts">
      <Fact title="Category" value={cluster.category.label} /><Fact title="Cluster status" value={label(cluster.status)} />
      <Fact title="Supporting reports" value={cluster.reportCount.toLocaleString('en-NG')} /><Fact title="Pending grouping review" value={cluster.pendingReviewCount.toLocaleString('en-NG')} />
      <Fact title="Created (WAT)" value={date(cluster.createdAt)} /><Fact title="Last changed (WAT)" value={date(cluster.updatedAt)} />
      <Fact title="Centroid" value={cluster.centroid ? `${cluster.centroid.latitude.toFixed(6)}, ${cluster.centroid.longitude.toFixed(6)}` : 'Unavailable'} />
      <Fact title="Fixed grouping anchor" value={cluster.anchorLocation ? `${cluster.anchorLocation.address || 'Address unavailable'} · ${cluster.anchorLocation.latitude.toFixed(6)}, ${cluster.anchorLocation.longitude.toFixed(6)}${cluster.anchorLocation.accuracy == null ? '' : ` · ±${cluster.anchorLocation.accuracy} m`}` : 'Unavailable'} />
      <Fact title="Assignment methods" value={`${cluster.grouping.ai} AI · ${cluster.grouping.human} human · ${cluster.grouping.system} system`} />
      <Fact title="Average assignment confidence" value={cluster.grouping.averageConfidence == null ? 'Unavailable' : `${Math.round(cluster.grouping.averageConfidence * 100)}%`} />
      <Fact title="First report grouped (WAT)" value={cluster.grouping.firstAssignedAt ? date(cluster.grouping.firstAssignedAt) : 'Unavailable'} />
      <Fact title="Last report grouped (WAT)" value={cluster.grouping.lastAssignedAt ? date(cluster.grouping.lastAssignedAt) : 'Unavailable'} />
    </dl><div className="cluster-summary-row"><div><h3>Supporting report lifecycle</h3><Lifecycle cluster={cluster} /></div><div><h3>Current priority</h3><Priority cluster={cluster} enabled={data.priorityEnabled} /></div></div>
      <p className="cluster-scope-note">This summary shows aggregate operational data. Original evidence, grouping rationale, and review actions remain separate review steps.</p></>}
  </section>;
}

function Fact({ title, value }: { title: string; value: string }) { return <div><dt>{title}</dt><dd>{value}</dd></div>; }
