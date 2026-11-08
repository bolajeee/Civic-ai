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
    <div className="page-title report-page-heading"><div><p className="eyebrow">ORIGINAL CITIZEN OBSERVATIONS</p><h1>Citizen reports</h1><p className="muted">Inspect original submissions and evidence. Report status is read-only.</p></div>
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
      {data && <><div className="report-list-heading"><div><h2>All citizen reports</h2><p className="muted">{data.total.toLocaleString('en-NG')} matching records · Snapshot {date(data.generatedAt)} WAT</p></div></div>
        {data.reports.length ? <><div className="table-scroll report-desktop-table"><table><thead><tr><th>Reference</th><th>Category / description</th><th>Location</th><th>Report status</th><th>Cluster</th><th>Submitted (WAT)</th></tr></thead><tbody>{data.reports.map(report => <tr key={report.id}>
          <td><button className="report-reference" onClick={event => { opener.current = event.currentTarget; setSelected(report.id); }} aria-expanded={selected === report.id}>{report.publicId}</button></td>
          <td><strong>{report.category.label}</strong><small className="description-preview">{report.description || 'No description supplied'}</small></td>
          <td><small>{report.location ? report.location.address || `${report.location.latitude.toFixed(5)}, ${report.location.longitude.toFixed(5)}` : 'No GPS supplied'}</small></td>
          <td><span className={`badge ${report.status.toLowerCase()}`}>{label(report.status)}</span></td>
          <td>{report.cluster?.publicId || <span className="muted">Unassigned</span>}</td><td>{date(report.submittedAt)}</td>
        </tr>)}</tbody></table></div></> : <p className="empty muted">{data.total ? 'This page has no reports. Return to the first page or refresh.' : 'No reports match these filters.'}</p>}
        {data.reports.length > 0 && <div className="report-mobile-cards">{data.reports.map(report => <article className="report-mobile-card" key={`mobile-${report.id}`}>
          <div className="report-mobile-card-top"><button className="report-reference" onClick={event => { opener.current = event.currentTarget; setSelected(report.id); }} aria-expanded={selected === report.id}>{report.publicId}</button><span className={`badge ${report.status.toLowerCase()}`}>{label(report.status)}</span></div>
          <strong>{report.description || report.category.label}</strong>
          <div className="report-mobile-meta"><span>{report.category.label}</span><span>{date(report.submittedAt)}</span></div>
          <p>{report.location ? report.location.address || `${report.location.latitude.toFixed(5)}, ${report.location.longitude.toFixed(5)}` : 'No GPS supplied'}</p>
          <small>Cluster: {report.cluster?.publicId || 'Unassigned'} · {report.photoCount} photos</small>
        </article>)}</div>}
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
  return <section className="report-detail" aria-label="Report details" aria-busy={busy}>
    <div className="page-title report-detail-heading"><div><p className="eyebrow">CITIZEN REPORT</p><h2 ref={heading} tabIndex={-1}>Report {report?.publicId || 'details'}</h2>{report && <p className="muted">Submitted {date(report.submittedAt)} WAT</p>}</div><div className="report-detail-actions"><button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh details</button><button className="refresh" onClick={close}>Close details</button></div></div>
    {error && <p className="error" role="alert">{error} {data && 'Showing previously loaded details.'}</p>}
    {busy && <p className="muted" role="status">Loading report details…</p>}
    {report && <div className="report-detail-layout"><div className="report-detail-main">
      <section className="panel report-summary-panel"><div className="report-status-row"><span className="badge category-badge">{report.category.label}</span><span className={`badge ${report.status.toLowerCase()}`}>{label(report.status)}</span></div><h3>Original description</h3><p className="report-description">{report.description || 'No description supplied.'}</p>
        <dl className="report-source-facts"><div><dt>Source</dt><dd>Citizen submission</dd></div><div><dt>Issue cluster</dt><dd>{report.cluster ? `${report.cluster.publicId} · ${label(report.cluster.status)}` : 'Unassigned'}</dd></div></dl>
      </section>
      <section className="panel report-evidence-panel"><div className="evidence-heading"><div><h3>Photo evidence</h3><p className="muted">{report.photos.length} attachment{report.photos.length === 1 ? '' : 's'} · submitted {date(report.submittedAt)} WAT</p></div></div><p className="muted photo-expiry-note">Signed photo links expire after 15 minutes. Refresh details to renew them.</p>
        <div className="report-gallery">{report.photos.map((photo, index) => <ReportPhoto key={`${photo.id}-${photo.url}-${revision}`} photo={photo} index={index} />)}</div>
        {!report.photos.length && <p className="empty muted">No photos are attached to this report.</p>}
      </section>
    </div><aside className="report-detail-aside"><section className="panel report-location-panel"><h3>Location &amp; GPS</h3>
      {report.location ? <><div className="location-coordinate-block"><span aria-hidden="true">◎</span><div><small>Submitted coordinates</small><strong>{report.location.latitude.toFixed(6)}, {report.location.longitude.toFixed(6)}</strong></div></div><dl className="report-location-facts"><div><dt>Reported location</dt><dd>{report.location.address || 'Address unavailable'}</dd></div><div><dt>GPS accuracy</dt><dd>{report.location.accuracy == null ? 'Unknown' : `±${report.location.accuracy} metres`}</dd></div></dl><p className="muted">Coordinates are citizen-submitted and have not been independently verified.</p></> : <p className="empty muted">No GPS location was supplied with this report.</p>}
    </section><div className="notice report-readonly-note">Report status is read-only. Report lifecycle and cluster status are separate.</div><dl className="panel report-metadata"><div><dt>Submitted (WAT)</dt><dd>{date(report.submittedAt)}</dd></div><div><dt>Last updated (WAT)</dt><dd>{date(report.updatedAt)}</dd></div><div><dt>Citizen-selected category</dt><dd>{report.category.label}</dd></div></dl></aside></div>}
  </section>;
}

function ReportPhoto({ photo, index }: { photo: ReportDetailSnapshot['report']['photos'][number]; index: number }) {
  const [failed, setFailed] = useState(false);
  return <figure>{photo.url && !failed ? <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Original citizen photo ${index + 1}`} loading="lazy" onError={() => setFailed(true)} /></a> : <div className="photo-unavailable">Photo unavailable. Try Refresh details.</div>}<figcaption>Photo {index + 1} · {photo.mediaType}</figcaption></figure>;
}
