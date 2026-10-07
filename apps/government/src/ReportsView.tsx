import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { GovernmentApi } from './api';
import type { ReportDetailSnapshot, ReportFilters, ReportsSnapshot } from './types';
import './reports.css';

const date = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const initial: ReportFilters = { q: '', status: '', category: '', grouping: 'all', location: 'all', from: '', to: '', limit: 20 };

export function ReportsView({ api }: { api: GovernmentApi }) {
  const [draft, setDraft] = useState<ReportFilters>(initial);
  const [filters, setFilters] = useState<ReportFilters>({ ...initial, page: 1 });
  const [snapshot, setSnapshot] = useState<{ key: string; data: ReportsSnapshot } | null>(null);
  const [categories, setCategories] = useState<ReportsSnapshot['categories']>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const key = JSON.stringify(filters);
  const data = snapshot?.key === key ? snapshot.data : null;
  useEffect(() => {
    let active = true;
    setBusy(true); setError(''); setSelected(null);
    api.reports(filters).then(result => {
      if (active) { setSnapshot({ key, data: result }); setCategories(result.categories); }
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : 'Unable to load reports.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, filters, key, revision]);

  function apply(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setFormError('From date must be on or before To date.'); return;
    }
    setFormError(''); setFilters({ ...draft, q: draft.q?.trim(), page: 1 });
  }
  function reset() {
    setDraft(initial); setFormError(''); setFilters({ ...initial, page: 1 });
  }
  function close() { setSelected(null); opener.current?.focus(); }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return <div className="dashboard reports-page">
    <div className="page-title"><div><p className="eyebrow">ORIGINAL CITIZEN OBSERVATIONS</p><h1>Reports</h1><p className="muted">Find reports, inspect their evidence, and see their cluster assignment.</p></div>
      <button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? 'Loading…' : 'Refresh'}</button></div>
    <form className="panel report-filters" onSubmit={apply}>
      <label className="report-search">Search reports<input aria-label="Search reports" value={draft.q} maxLength={200} placeholder="Reference, description, address or cluster" onChange={event => setDraft(value => ({ ...value, q: event.target.value }))} /></label>
      <label>Status<select aria-label="Status" value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value }))}><option value="">All statuses</option>{['PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Category<select aria-label="Category" value={draft.category} onChange={event => setDraft(value => ({ ...value, category: event.target.value }))}><option value="">All categories</option>{categories.map(value => <option key={value.slug} value={value.slug}>{value.label}</option>)}</select></label>
      <label>Cluster assignment<select aria-label="Cluster assignment" value={draft.grouping} onChange={event => setDraft(value => ({ ...value, grouping: event.target.value as ReportFilters['grouping'] }))}><option value="all">All reports</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select></label>
      <label>GPS location<select aria-label="GPS location" value={draft.location} onChange={event => setDraft(value => ({ ...value, location: event.target.value as ReportFilters['location'] }))}><option value="all">All reports</option><option value="present">GPS supplied</option><option value="missing">No GPS supplied</option></select></label>
      <label>From date (WAT)<input aria-label="From date (WAT)" type="date" value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} /></label>
      <label>To date (WAT)<input aria-label="To date (WAT)" type="date" value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} /></label>
      <label>Reports per page<select aria-label="Reports per page" value={draft.limit} onChange={event => setDraft(value => ({ ...value, limit: Number(event.target.value) }))}>{[20, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <div className="report-filter-actions"><button className="refresh" type="button" onClick={reset}>Reset</button><button className="primary" type="submit">Apply filters</button></div>
      {formError && <p className="error" role="alert">{formError}</p>}
    </form>
    {error && <p className="error" role="alert">{error} {data ? 'Showing the previous snapshot for these filters and this page.' : 'Try Refresh to load these reports.'}</p>}
    <section className="panel reports-list" aria-label="Citizen reports" aria-busy={busy}>
      {busy && <p role="status" className="muted">Loading citizen reports…</p>}
      {data && <><div className="report-list-heading"><h2>{data.total.toLocaleString('en-NG')} matching reports</h2><p className="updated">Snapshot: {date(data.generatedAt)} WAT</p></div>
        {data.reports.length ? <div className="table-scroll"><table><thead><tr><th>Reference</th><th>Category / description</th><th>Report status</th><th>Location</th><th>Cluster</th><th>Photos</th><th>Submitted (WAT)</th></tr></thead><tbody>{data.reports.map(report => <tr key={report.id}>
          <td><button className="report-reference" onClick={event => { opener.current = event.currentTarget; setSelected(report.id); }} aria-expanded={selected === report.id}>{report.publicId}</button></td>
          <td><strong>{report.category.label}</strong><small className="description-preview">{report.description || 'No description supplied'}</small></td>
          <td><span className={`badge ${report.status.toLowerCase()}`}>{label(report.status)}</span></td>
          <td><small>{report.location ? report.location.address || `${report.location.latitude.toFixed(5)}, ${report.location.longitude.toFixed(5)}` : 'No GPS supplied'}</small></td>
          <td>{report.cluster?.publicId || <span className="muted">Unassigned</span>}</td><td>{report.photoCount}</td><td>{date(report.submittedAt)}</td>
        </tr>)}</tbody></table></div> : <p className="empty muted">{data.total ? 'This page has no reports. Return to the first page or refresh.' : 'No reports match these filters.'}</p>}
        <div className="report-pagination"><span>Page {data.page} of {pages}</span><div>
          {data.page > pages && <button className="refresh" disabled={busy} onClick={() => setFilters(value => ({ ...value, page: 1 }))}>First page</button>}
          <button className="refresh" disabled={busy || data.page <= 1} onClick={() => setFilters(value => ({ ...value, page: Math.max(1, (value.page ?? 1) - 1) }))}>Previous</button>
          <button className="refresh" disabled={busy || data.page >= pages} onClick={() => setFilters(value => ({ ...value, page: (value.page ?? 1) + 1 }))}>Next</button>
        </div></div>
      </>}
    </section>
    {selected && <ReportDetails key={selected} api={api} id={selected} close={close} />}
  </div>;
}

function ReportDetails({ api, id, close }: { api: GovernmentApi; id: string; close: () => void }) {
  const [data, setData] = useState<ReportDetailSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api.report(id).then(result => { if (active) setData(result); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Unable to load report details.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, id, revision]);
  useEffect(() => { heading.current?.focus(); }, [data]);
  const report = data?.report;
  return <section className="panel report-detail" aria-label="Report details" aria-busy={busy}>
    <div className="page-title"><h2 ref={heading} tabIndex={-1}>{report ? report.publicId : 'Report details'}</h2><div className="report-detail-actions"><button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh details</button><button className="refresh" onClick={close}>Close details</button></div></div>
    {error && <p className="error" role="alert">{error} {data && 'Showing previously loaded details.'}</p>}
    {busy && <p className="muted" role="status">Loading report details…</p>}
    {report && <><dl className="report-facts">
      <div><dt>Citizen-selected category</dt><dd>{report.category.label}</dd></div>
      <div><dt>Report status</dt><dd><span className={`badge ${report.status.toLowerCase()}`}>{label(report.status)}</span></dd></div>
      <div><dt>Submitted (WAT)</dt><dd>{date(report.submittedAt)}</dd></div>
      <div><dt>Last updated (WAT)</dt><dd>{date(report.updatedAt)}</dd></div>
      <div><dt>Issue cluster</dt><dd>{report.cluster ? `${report.cluster.publicId} · ${label(report.cluster.status)}` : 'Unassigned'}</dd></div>
      <div><dt>Location</dt><dd>{report.location ? <>{report.location.address || 'Address unavailable'}<br />{report.location.latitude.toFixed(6)}, {report.location.longitude.toFixed(6)}<br />GPS accuracy: {report.location.accuracy == null ? 'Unknown' : `±${report.location.accuracy} metres`}</> : 'No GPS supplied'}</dd></div>
    </dl>
      <h3>Citizen description</h3><p className="report-description">{report.description || 'No description supplied.'}</p>
      <h3>Original photos ({report.photos.length})</h3><p className="muted">Photo links last 15 minutes. Refresh details to renew expired or unavailable photos.</p>
      <div className="report-gallery">{report.photos.map((photo, index) => <ReportPhoto key={`${photo.id}-${photo.url}-${revision}`} photo={photo} index={index} />)}</div>
      {!report.photos.length && <p className="muted">No photos are attached to this report.</p>}
    </>}
  </section>;
}

function ReportPhoto({ photo, index }: { photo: ReportDetailSnapshot['report']['photos'][number]; index: number }) {
  const [failed, setFailed] = useState(false);
  return <figure>{photo.url && !failed ? <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Original citizen photo ${index + 1}`} loading="lazy" onError={() => setFailed(true)} /></a> : <div className="photo-unavailable">Photo unavailable. Try Refresh details.</div>}<figcaption>Photo {index + 1} · {photo.mediaType}</figcaption></figure>;
}
