import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ReviewerActions, ReviewHistory } from './ClusterActions';
import type { GovernmentApi } from './api';
import type { ClusterDetailSnapshot, ClusterEvidenceReport, ClusterEvidenceSnapshot, ClusterFilters, ClustersSnapshot, IssueCluster, IssueCompilationSnapshot, IssueReportVersionsSnapshot } from './types';
import './clusters.css';

const date = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const initial: ClusterFilters = { q: '', status: '', category: '', review: 'all', assignment: 'all', location: 'all', limit: 20 };

export function ClustersView({ api, canAct }: { api: GovernmentApi; canAct: boolean }) {
  const [draft, setDraft] = useState<ClusterFilters>(initial);
  const [filters, setFilters] = useState<ClusterFilters>({ ...initial, page: 1 });
  const [snapshot, setSnapshot] = useState<{ key: string; data: ClustersSnapshot } | null>(null);
  const [categories, setCategories] = useState<ClustersSnapshot['categories']>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  // After a reviewer change the list reloads, but the open cluster should stay open.
  const keepSelected = useRef(false);
  const key = JSON.stringify(filters);
  const data = snapshot?.key === key ? snapshot.data : null;

  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    if (!keepSelected.current) setSelected(null);
    keepSelected.current = false;
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
      <label className="cluster-search">Search clusters<input aria-label="Search clusters" value={draft.q} maxLength={200} placeholder="Cluster/report reference, description, address or category" onChange={event => setDraft(value => ({ ...value, q: event.target.value }))} /></label>
      <label>Status<select aria-label="Cluster status" value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value }))}><option value="">All statuses</option>{['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Category<select aria-label="Cluster category" value={draft.category} onChange={event => setDraft(value => ({ ...value, category: event.target.value }))}><option value="">All categories</option>{categories.map(value => <option key={value.slug} value={value.slug}>{value.label}</option>)}</select></label>
      <label>Grouping review<select aria-label="Grouping review" value={draft.review} onChange={event => setDraft(value => ({ ...value, review: event.target.value as ClusterFilters['review'] }))}><option value="all">All clusters</option><option value="pending">Pending review</option><option value="clear">No pending review</option></select></label>
      <label>Assignment method<select aria-label="Assignment method" value={draft.assignment} onChange={event => setDraft(value => ({ ...value, assignment: event.target.value as ClusterFilters['assignment'] }))}><option value="all">Any method</option><option value="AI">AI assignment</option><option value="HUMAN">Human assignment</option><option value="SYSTEM">System singleton</option></select></label>
      <label>Supporting-report GPS<select aria-label="Supporting-report GPS" value={draft.location} onChange={event => setDraft(value => ({ ...value, location: event.target.value as ClusterFilters['location'] }))}><option value="all">Any GPS state</option><option value="present">At least one with GPS</option><option value="missing">At least one missing GPS</option></select></label>
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
    {selected && <ClusterDetails key={selected} api={api} id={selected} close={close} canAct={canAct} clusters={data?.clusters ?? []}
      onChanged={() => { keepSelected.current = true; setRevision(value => value + 1); }} />}
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

function ClusterDetails({ api, id, close, canAct, clusters, onChanged }: { api: GovernmentApi; id: string; close: () => void; canAct: boolean; clusters: IssueCluster[]; onChanged: () => void }) {
  const [data, setData] = useState<ClusterDetailSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [changes, setChanges] = useState(0);
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
      <p className="cluster-scope-note">The summary keeps cluster status separate from the statuses of its supporting citizen reports.</p>
      <CompiledIssueReport api={api} id={id} revision={changes} />
      <ClusterEvidence api={api} id={id} revision={changes} reviewer={canAct ? { cluster: { id, publicId: cluster.publicId, categorySlug: cluster.category.slug }, clusters,
        onChanged: () => { setChanges(value => value + 1); setRevision(value => value + 1); onChanged(); } } : undefined} />
      <ReviewHistory api={api} id={id} revision={changes} /></>}
  </section>;
}

function Fact({ title, value }: { title: string; value: string }) { return <div><dt>{title}</dt><dd>{value}</dd></div>; }

function CompiledIssueReport({ api, id, revision }: { api: GovernmentApi; id: string; revision: number }) {
  const [data, setData] = useState<IssueCompilationSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [versions, setVersions] = useState<IssueReportVersionsSnapshot | null>(null);
  const [versionsRevision, setVersionsRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api.clusterCompilation(id).then(result => { if (active) setData(result); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Unable to compile this issue report.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, id, refresh, revision]);
  useEffect(() => {
    let active = true;
    api.clusterReportVersions(id).then(result => { if (active) setVersions(result); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Unable to load report versions.'); });
    return () => { active = false; };
  }, [api, id, versionsRevision]);
  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function downloadPdf() {
    if (!data) return;
    setExporting(true); setError('');
    try {
      const blob = await api.clusterReportPdf(id);
      saveBlob(blob, `${data.cluster.publicId}-issue-report.pdf`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to generate the PDF report.');
    } finally { setExporting(false); }
  }
  async function createVersion() {
    if (!data || !window.confirm('Create an immutable version from the current evidence snapshot?')) return;
    setVersioning(true); setError('');
    try { await api.createClusterReportVersion(id); setVersionsRevision(value => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to create a report version.'); }
    finally { setVersioning(false); }
  }
  async function downloadVersion(number: number) {
    if (!data) return;
    setExporting(true); setError('');
    try { saveBlob(await api.clusterReportVersionPdf(id, number), `${data.cluster.publicId}-issue-report-v${number}.pdf`); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to download the report version.'); }
    finally { setExporting(false); }
  }
  return <section className="issue-compilation" aria-label="Compiled issue report" aria-busy={busy}>
    <div className="cluster-evidence-heading"><div><p className="eyebrow">COMPILED ISSUE REPORT</p><h3>Current issue brief</h3>
      <p className="muted">A live compilation of current cluster membership. Saved versions are immutable; formal approval is recorded separately.</p></div>
      <div className="cluster-detail-actions"><button className="refresh" disabled={busy || exporting} onClick={() => setRefresh(value => value + 1)}>Recompile</button>
        <button className="refresh" disabled={!data || busy} onClick={() => window.print()}>Print</button>
        <button className="refresh" disabled={!data || busy || versioning} onClick={createVersion}>{versioning ? 'Saving version...' : 'Save version'}</button>
        <button className="primary report-download" disabled={!data || busy || exporting} onClick={downloadPdf}>{exporting ? 'Generating PDF...' : 'Download PDF'}</button></div></div>
    {error && <p className="error" role="alert">{error} {data && 'Showing the previously compiled brief.'}</p>}
    {busy && <p className="muted" role="status">Compiling issue report...</p>}
    {data && <><div className="compilation-meta"><strong>{data.cluster.publicId} / {data.cluster.category.label}</strong><span>Compiled {date(data.generatedAt)} WAT from {data.cluster.reportCount.toLocaleString('en-NG')} current sources</span></div>
      <dl className="compilation-coverage">
        <Fact title="Observation window" value={data.coverage.firstObservedAt && data.coverage.lastObservedAt ? `${date(data.coverage.firstObservedAt)} - ${date(data.coverage.lastObservedAt)}` : 'Unavailable'} />
        <Fact title="Location coverage" value={`${data.coverage.withLocation} saved GPS / ${data.coverage.withoutLocation} missing`} />
        <Fact title="Description coverage" value={`${data.coverage.withDescription} supplied / ${data.coverage.withoutDescription} missing`} />
      </dl>
      <div className="compiled-findings"><h4>Compiled findings</h4>{data.findings.map(finding => <article key={finding.kind}><p>{finding.text}</p><SourceReferences ids={finding.sourceReportIds} /></article>)}</div>
      <div className="compiled-observations"><h4>Reported observations</h4>
        {data.observations.length ? <ol>{data.observations.map((observation, index) => <li key={`${observation.sourceReportIds[0]}-${index}`}><p>{observation.text}</p><SourceReferences ids={observation.sourceReportIds} /></li>)}</ol> : <p className="muted">No source report includes a description.</p>}
      </div>
      <div className={`report-review-state ${data.review.status.toLowerCase()}`}><div><span>Review status</span><strong>{label(data.review.status)}</strong></div>
        <p>{data.review.status === 'READY_FOR_REVIEW' ? 'No unresolved conflicts or evidence gaps were detected by the compilation checks.'
          : data.review.reasons.join(' / ')} Formal approval is not part of this live draft.</p></div>
      <ReviewIssues title="Unresolved disagreements" empty="No explicit grouping, category, or severity disagreement was detected." issues={data.disagreements} />
      <ReviewIssues title="Outstanding uncertainty" empty="No missing or incomplete evidence was detected." issues={data.uncertainties} />
      <div className="evidence-appendix"><h4>Evidence appendix ({data.evidenceAppendix.length})</h4>
        <p className="muted">Citizen observations, system suggestions, and grouping decisions remain visibly separate.</p>
        <div>{data.evidenceAppendix.map(source => <article key={source.sourceReportId}><header><strong>{source.sourceReportId}</strong><span className={`badge ${source.status.toLowerCase()}`}>{label(source.status)}</span></header>
          <p className="appendix-description"><b>Citizen observation:</b> {source.description || 'No description supplied.'}</p>
          <dl><Fact title="Submitted (WAT)" value={date(source.submittedAt)} /><Fact title="Saved location" value={source.location?.address || (source.location ? `${source.location.latitude.toFixed(6)}, ${source.location.longitude.toFixed(6)}` : 'No saved GPS')} />
            <Fact title="Attached photos" value={source.photoCount.toLocaleString('en-NG')} /><Fact title="Grouping" value={`${label(source.assignmentMethod)} assignment`} />
            <Fact title="AI category suggestion" value={source.classification ? `${source.classification.suggestedCategory || 'Unavailable'} (${label(source.classification.status)})${source.classification.confidence == null ? '' : ` / ${Math.round(source.classification.confidence * 100)}% model confidence`}` : 'No analysis record'} />
            <Fact title="AI severity suggestion" value={source.severity ? `${source.severity.suggestedLevel || 'Unavailable'} (${label(source.severity.status)})${source.severity.confidence == null ? '' : ` / ${Math.round(source.severity.confidence * 100)}% model confidence`}` : 'No analysis record'} />
          </dl>
          {source.classification?.evidence && <p><b>Classification visual evidence:</b> {source.classification.evidence}</p>}
          {source.severity?.uncertainty && <p><b>Severity uncertainty:</b> {source.severity.uncertainty}</p>}
        </article>)}</div>
      </div>
      <details className="compiled-sources"><summary>Current source register ({data.sources.length})</summary><ul>{data.sources.map(source => <li key={source.id}><strong>{source.publicId}</strong><span>{label(source.status)} / {date(source.submittedAt)} WAT / {source.location?.address || (source.location ? `${source.location.latitude.toFixed(6)}, ${source.location.longitude.toFixed(6)}` : 'No saved GPS')}</span></li>)}</ul></details>
      <section className="report-versions"><h4>Immutable versions ({versions?.versions.length ?? 0})</h4>
        {versions?.versions.length ? <ol>{versions.versions.map(version => <li key={version.id}><div><strong>Version {version.number}</strong><span>{date(version.createdAt)} WAT / {version.sourceCount} sources / {label(version.reviewStatus)} / created by {version.createdBy}</span></div><button className="refresh" disabled={exporting} onClick={() => downloadVersion(version.number)}>Download</button></li>)}</ol>
          : <p className="muted">No immutable report version has been saved.</p>}
      </section>
    </>}
  </section>;
}

function SourceReferences({ ids }: { ids: string[] }) {
  return <p className="source-references" aria-label="Supporting source reports">{ids.length ? ids.map(id => <span key={id}>{id}</span>) : <em>No geolocated source reports</em>}</p>;
}

function ReviewIssues({ title, empty, issues }: { title: string; empty: string; issues: IssueCompilationSnapshot['uncertainties'] }) {
  return <section className="review-issues"><h4>{title} ({issues.length})</h4>{issues.length ? <ul>{issues.map(issue => <li key={issue.kind}><p>{issue.summary}</p><SourceReferences ids={issue.sourceReportIds} /></li>)}</ul> : <p className="muted">{empty}</p>}</section>;
}

function ClusterEvidence({ api, id, revision: external, reviewer }: { api: GovernmentApi; id: string; revision: number;
  reviewer?: { cluster: { id: string; publicId: string; categorySlug: string }; clusters: IssueCluster[]; onChanged: () => void } }) {
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<{ page: number; data: ClusterEvidenceSnapshot } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const data = snapshot?.page === page ? snapshot.data : null;
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api.clusterEvidence(id, page, 20).then(result => { if (active) setSnapshot({ page, data: result }); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Unable to load cluster evidence.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, id, page, revision, external]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return <section className="cluster-evidence" aria-label="Supporting report evidence" aria-busy={busy}>
    <div className="cluster-evidence-heading"><div><p className="eyebrow">TRACEABLE SOURCE EVIDENCE</p><h3>Supporting citizen reports</h3>
      <p className="muted">Original observations are shown separately; they are not a generated incident narrative.</p></div>
      <button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>Renew evidence</button></div>
    {error && <p className="error" role="alert">{error} {data && 'Showing the previously loaded evidence page.'}</p>}
    {busy && <p className="muted" role="status">Loading supporting evidence…</p>}
    {data && <><div className="evidence-count"><strong>{data.total.toLocaleString('en-NG')} supporting reports</strong><span>Page {data.page} of {pages} · photo links expire after 15 minutes</span></div>
      <div className="evidence-reports">{data.reports.map(report => <EvidenceReport key={report.id} report={report} revision={revision} />)}</div>
      {!data.reports.length && <p className="empty muted">{data.total ? 'This evidence page is empty. Return to the first page.' : 'No supporting reports are available.'}</p>}
      {reviewer && data.reports.length > 0 && <ReviewerActions api={api} cluster={reviewer.cluster} reports={data.reports} candidates={reviewer.clusters} onChanged={reviewer.onChanged} />}
      <div className="cluster-pagination"><span>Evidence page {data.page} of {pages}</span><div>
        {data.page > pages && <button className="refresh" disabled={busy} onClick={() => setPage(1)}>First page</button>}
        <button className="refresh" disabled={busy || data.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button>
        <button className="refresh" disabled={busy || data.page >= pages} onClick={() => setPage(value => value + 1)}>Next</button>
      </div></div></>}
  </section>;
}

function EvidenceReport({ report, revision }: { report: ClusterEvidenceReport; revision: number }) {
  return <article className="evidence-report"><header><div><span className="reference">{report.publicId}</span><strong>{report.category.label}</strong></div><span className={`badge ${report.status.toLowerCase()}`}>{label(report.status)}</span></header>
    <dl className="evidence-facts"><div><dt>Submitted (WAT)</dt><dd>{date(report.submittedAt)}</dd></div><div><dt>Last updated (WAT)</dt><dd>{date(report.updatedAt)}</dd></div><div><dt>Saved location</dt><dd>{report.location ? <>{report.location.address || 'Address unavailable'}<br />{report.location.latitude.toFixed(6)}, {report.location.longitude.toFixed(6)}<br />GPS accuracy: {report.location.accuracy == null ? 'Unknown' : `±${report.location.accuracy} metres`}</> : 'No GPS supplied'}</dd></div></dl>
    <h4>Original description</h4><p className="evidence-description">{report.description || 'No description supplied.'}</p>
    <h4>Original photos ({report.photos.length})</h4>{report.photos.length ? <div className="evidence-gallery">{report.photos.map((photo, index) => <EvidencePhoto key={`${photo.id}-${photo.url}-${revision}`} photo={photo} index={index} reportReference={report.publicId} />)}</div> : <p className="muted">No photos are attached to this report.</p>}
    <GroupingExplanation report={report} />
  </article>;
}

function EvidencePhoto({ photo, index, reportReference }: { photo: ClusterEvidenceReport['photos'][number]; index: number; reportReference: string }) {
  const [failed, setFailed] = useState(false);
  return <figure>{photo.url && !failed ? <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Original photo ${index + 1} for report ${reportReference}`} loading="lazy" onError={() => setFailed(true)} /></a> : <div className="evidence-photo-unavailable">Photo unavailable. Renew evidence to retry.</div>}<figcaption>Photo {index + 1} · {photo.mediaType}</figcaption></figure>;
}

const score = (value: number | null) => value == null ? 'Unavailable' : value.toFixed(3);

function GroupingExplanation({ report }: { report: ClusterEvidenceReport }) {
  const grouping = report.grouping;
  const decision = grouping.decision;
  const signals = decision?.signals;
  return <details className="grouping-explanation"><summary>Why this report is grouped here</summary>
    <p className="grouping-plain">{grouping.assignmentMethod === 'AI'
      ? `Automatically assigned${decision?.matchedReport ? ` after matching ${decision.matchedReport.publicId}` : ''}. The recorded similarity score is a routing aid, not a verified probability.`
      : grouping.assignmentMethod === 'HUMAN'
        ? 'A government reviewer assigned this report. Any automated decision below is retained as historical context, not the reviewer’s reasoning.'
        : decision?.outcome === 'REVIEW'
          ? 'The system created a separate cluster because the match needed review.'
          : 'The system created a singleton cluster because it did not record an eligible automatic match.'}</p>
    <dl className="grouping-facts">
      <Fact title="Current assignment method" value={label(grouping.assignmentMethod)} />
      <Fact title="Membership confidence" value={score(grouping.confidence)} />
      <Fact title="Assigned (WAT)" value={date(grouping.assignedAt)} />
      <Fact title="Original decision" value={decision ? label(decision.outcome) : 'Unavailable'} />
      <Fact title="Decision recorded (WAT)" value={decision?.decidedAt ? date(decision.decidedAt) : 'Unavailable'} />
      <Fact title="Duplicate search status" value={grouping.search ? label(grouping.search.status) : 'Unavailable'} />
      <Fact title="Scored candidates found" value={grouping.search ? grouping.search.candidateCount.toLocaleString('en-NG') : 'Unavailable'} />
      <Fact title="Matched report" value={decision?.matchedReport?.publicId || 'None recorded'} />
      <Fact title="Combined similarity score" value={score(signals?.combinedScore ?? grouping.confidence)} />
      <Fact title="Automatic assignment threshold" value={score(decision?.autoMinScore ?? null)} />
      <Fact title="Geographic distance" value={signals ? `${Math.round(signals.distanceMeters)} metres` : 'Unavailable'} />
      <Fact title="Semantic similarity" value={score(signals?.semanticSimilarity ?? null)} />
      <Fact title="Category match" value={signals ? (signals.categoryMatch ? 'Yes' : 'No') : 'Unavailable'} />
      <Fact title="Visual similarity" value="Unavailable · image-vector matching is not implemented" />
      <Fact title="Search radius" value={decision?.radiusMeters == null ? 'Unavailable' : `${decision.radiusMeters} metres`} />
      <Fact title="Ambiguity margin" value={score(decision?.ambiguityMargin ?? null)} />
      <Fact title="Scoring version" value={signals?.scoringVersion || decision?.scoringVersion || grouping.search?.scoringVersion || 'Unavailable'} />
      <Fact title="Clustering version" value={decision?.clusteringVersion || 'Unavailable'} />
    </dl>
    <div className="grouping-uncertainty"><strong>Uncertainty and missing data</strong><ul>
      {!report.location && <li>No GPS was supplied, so geographic matching was unavailable.</li>}
      {!grouping.search && <li>No duplicate-search record is available for this report.</li>}
      {grouping.search?.status === 'FAILED' && <li>Duplicate search failed{grouping.search.errorCode ? ` (${grouping.search.errorCode})` : ''}.</li>}
      {grouping.search?.status === 'NO_LOCATION' && <li>Duplicate search could not run without a saved location.</li>}
      {!decision && <li>No original clustering decision is available; this may be a legacy or manually created membership.</li>}
      {decision && !signals && grouping.assignmentMethod === 'AI' && <li>The matched report’s detailed scoring signals are unavailable.</li>}
      <li>Visual similarity was not calculated; its planned signal is absent from this scoring version.</li>
      {decision?.errorCode && <li>Clustering recorded an error: {decision.errorCode}.</li>}
    </ul></div>
    <div className="competing-candidates"><h4>Competing candidates ({grouping.competingCandidates.length})</h4>
      {grouping.competingCandidates.length ? <div className="table-scroll"><table><thead><tr><th>Candidate cluster / report</th><th>Score</th><th>Distance</th><th>Semantic</th><th>Category</th><th>Reason</th><th>Review status</th></tr></thead><tbody>{grouping.competingCandidates.map(candidate => <tr key={`${candidate.cluster.id}-${candidate.report?.id || 'missing'}`}><td><strong>{candidate.cluster.publicId}</strong><small>{candidate.report?.publicId || 'Candidate report unavailable'}</small></td><td>{score(candidate.score)}</td><td>{candidate.distanceMeters == null ? 'Unavailable' : `${Math.round(candidate.distanceMeters)} m`}</td><td>{score(candidate.semanticSimilarity)}</td><td>{candidate.categoryMatch == null ? 'Unavailable' : candidate.categoryMatch ? 'Match' : 'Different'}</td><td>{label(candidate.reason)}</td><td><span className="badge">{label(candidate.status)}</span></td></tr>)}</tbody></table></div> : <p className="muted">No competing cluster candidates were retained for review.</p>}
    </div>
  </details>;
}
