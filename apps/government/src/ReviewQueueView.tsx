import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, type GovernmentApi } from './api';
import type { ReviewQueueFilters, ReviewQueueItem, ReviewQueueSnapshot } from './types';
import './clusters.css';
import './review.css';

const date = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const score = (value: number | null | undefined) => value == null ? 'Unavailable' : Number(value).toFixed(3);
const initial: ReviewQueueFilters = { q: '', status: 'PENDING', reason: 'all', category: '', limit: 20 };

export function ReviewQueueView({ api, canAct }: { api: GovernmentApi; canAct: boolean }) {
  const [draft, setDraft] = useState<ReviewQueueFilters>(initial);
  const [filters, setFilters] = useState<ReviewQueueFilters>({ ...initial, page: 1 });
  const [snapshot, setSnapshot] = useState<{ key: string; data: ReviewQueueSnapshot } | null>(null);
  const [categories, setCategories] = useState<ReviewQueueSnapshot['categories']>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify(filters);
  const data = snapshot?.key === key ? snapshot.data : null;

  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api.reviewQueue(filters).then(result => {
      if (active) { setSnapshot({ key, data: result }); setCategories(result.categories); }
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : 'Unable to load the review queue.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, filters, key, revision]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft, q: draft.q?.trim(), page: 1 });
  }
  function reset() { setDraft(initial); setFilters({ ...initial, page: 1 }); }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return <div className="dashboard clusters-page review-page">
    <div className="page-title"><div><p className="eyebrow">LOW-CONFIDENCE GROUPING</p><h1>Review queue</h1>
      <p className="muted">Proposed report-to-cluster matches the system was not confident enough to apply automatically. Oldest proposals appear first.</p></div>
      <button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? 'Loading…' : 'Refresh'}</button></div>
    <form className="panel review-filters" onSubmit={apply}>
      <label className="cluster-search">Search proposals<input aria-label="Search proposals" value={draft.q} maxLength={200} placeholder="Report or cluster reference, or description" onChange={event => setDraft(value => ({ ...value, q: event.target.value }))} /></label>
      <label>Review status<select aria-label="Review status" value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value as ReviewQueueFilters['status'] }))}><option value="PENDING">Pending</option><option value="ACCEPTED">Accepted</option><option value="DISMISSED">Dismissed</option><option value="all">All</option></select></label>
      <label>Reason<select aria-label="Review reason" value={draft.reason} onChange={event => setDraft(value => ({ ...value, reason: event.target.value as ReviewQueueFilters['reason'] }))}><option value="all">Any reason</option><option value="LOW_SCORE">Low score</option><option value="AMBIGUOUS_MATCH">Ambiguous match</option></select></label>
      <label>Report category<select aria-label="Report category" value={draft.category} onChange={event => setDraft(value => ({ ...value, category: event.target.value }))}><option value="">All categories</option>{categories.map(value => <option key={value.slug} value={value.slug}>{value.label}</option>)}</select></label>
      <label>Proposals per page<select aria-label="Proposals per page" value={draft.limit} onChange={event => setDraft(value => ({ ...value, limit: Number(event.target.value) }))}>{[20, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <div className="cluster-filter-actions"><button className="refresh" type="button" onClick={reset}>Reset</button><button className="primary" type="submit">Apply filters</button></div>
    </form>
    {error && <p className="error" role="alert">{error} {data ? 'Showing the previous snapshot for these filters and this page.' : 'Try Refresh to load the queue.'}</p>}
    <section className="panel clusters-list" aria-label="Grouping review proposals" aria-busy={busy}>
      {busy && <p role="status" className="muted">Loading the review queue…</p>}
      {data && <><div className="cluster-list-heading"><div><h2>{data.total.toLocaleString('en-NG')} matching proposals</h2>
        <p className="muted">All reviews: {data.counts.pending.toLocaleString('en-NG')} pending · {data.counts.accepted.toLocaleString('en-NG')} accepted · {data.counts.dismissed.toLocaleString('en-NG')} dismissed. {canAct ? 'Approving moves the report into the proposed cluster; both outcomes record your name, the time and your reason.' : 'Only administrators can approve or dismiss proposals.'}</p></div>
        <p className="updated">Snapshot: {date(data.generatedAt)} WAT</p></div>
        {data.items.length ? <div className="review-items">{data.items.map(item => <ReviewItem key={`${item.reportId}-${item.proposedClusterId}`} api={api} item={item} canAct={canAct} onResolved={() => setRevision(value => value + 1)} />)}</div>
          : <p className="empty muted">{data.total ? 'This page has no proposals. Return to the first page or refresh.' : 'No grouping proposals match these filters.'}</p>}
        <div className="cluster-pagination"><span>Page {data.page} of {pages}</span><div>
          {data.page > pages && <button className="refresh" disabled={busy} onClick={() => setFilters(value => ({ ...value, page: 1 }))}>First page</button>}
          <button className="refresh" disabled={busy || data.page <= 1} onClick={() => setFilters(value => ({ ...value, page: Math.max(1, (value.page ?? 1) - 1) }))}>Previous</button>
          <button className="refresh" disabled={busy || data.page >= pages} onClick={() => setFilters(value => ({ ...value, page: (value.page ?? 1) + 1 }))}>Next</button>
        </div></div></>}
    </section>
  </div>;
}

function ReviewItem({ api, item, canAct, onResolved }: { api: GovernmentApi; item: ReviewQueueItem; canAct: boolean; onResolved: () => void }) {
  const { report, proposedCluster, currentCluster, candidateReport, signals, decision } = item;
  return <article className="review-item">
    <header><div><span className="reference">{report.publicId}</span><strong>{report.category.label}</strong></div>
      <div><span className="review-count">{label(item.reason)}</span><span className={`badge ${item.status.toLowerCase()}`}>{label(item.status)}</span></div></header>
    <p className="review-proposal">Proposed: join <strong>{proposedCluster.publicId}</strong> ({proposedCluster.category.label}, {proposedCluster.reportCount.toLocaleString('en-NG')} reports)
      {' '}— currently in <strong>{currentCluster ? currentCluster.publicId : 'no cluster'}</strong>{currentCluster ? ` (${label(currentCluster.assignmentMethod)} assignment)` : ''}.</p>
    <dl className="grouping-facts">
      <div><dt>Similarity score</dt><dd>{score(item.score)}</dd></div>
      <div><dt>Automatic threshold</dt><dd>{score(decision?.autoMinScore)}</dd></div>
      <div><dt>Ambiguity margin</dt><dd>{score(decision?.ambiguityMargin)}</dd></div>
      <div><dt>Matched report</dt><dd>{candidateReport?.publicId || 'Unavailable'}</dd></div>
      <div><dt>Geographic distance</dt><dd>{signals ? `${Math.round(signals.distanceMeters)} metres` : 'Unavailable'}</dd></div>
      <div><dt>Semantic similarity</dt><dd>{score(signals?.semanticSimilarity)}</dd></div>
      <div><dt>Visual similarity</dt><dd>{score(signals?.visualSimilarity)}</dd></div>
      <div><dt>Category match</dt><dd>{signals ? (signals.categoryMatch ? 'Yes' : 'No') : 'Unavailable'}</dd></div>
      <div><dt>Proposed (WAT)</dt><dd>{date(item.createdAt)}</dd></div>
      <div><dt>Scoring version</dt><dd>{item.scoringVersion}</dd></div>
      <div><dt>Clustering version</dt><dd>{decision?.clusteringVersion || 'Unavailable'}</dd></div>
    </dl>
    <div className="review-compare">
      <div><h4>Report awaiting grouping · submitted {date(report.submittedAt)}</h4><p className="evidence-description">{report.description || 'No description supplied.'}</p>
        <small className="muted">{report.location ? `${report.location.address || 'Address unavailable'} · ${report.location.latitude.toFixed(6)}, ${report.location.longitude.toFixed(6)}` : 'No GPS supplied'}</small></div>
      <div><h4>Matched report {candidateReport?.publicId || ''}</h4><p className="evidence-description">{candidateReport ? candidateReport.description || 'No description supplied.' : 'The matched report is no longer available.'}</p></div>
    </div>
    <div className="grouping-uncertainty"><strong>Uncertainty and missing data</strong><ul>
      <li>{item.reason === 'AMBIGUOUS_MATCH' ? 'Several clusters scored closely, so the system could not pick one.' : 'The best score was below the automatic threshold.'} The score is a triage aid, not a probability.</li>
      {!report.location && <li>No GPS was supplied for this report.</li>}
      {!signals && <li>Detailed scoring signals for this match are unavailable.</li>}
      {!decision && <li>The original clustering decision is unavailable.</li>}
      {signals?.visualSimilarity == null && <li>Visual similarity was unavailable, so fallback weights were used.</li>}
    </ul></div>
    {item.status === 'PENDING' ? canAct && <ProposalActions api={api} item={item} onResolved={onResolved} />
      : <p className="review-outcome">{label(item.status)}{item.reviewedAt ? ` on ${date(item.reviewedAt)} WAT` : ''}{item.reviewedBy ? ` by ${item.reviewedBy}` : ' automatically or before reviewer records were kept'}.{item.reviewReason ? ` Reason: ${item.reviewReason}` : ''}</p>}
  </article>;
}

function ProposalActions({ api, item, onResolved }: { api: GovernmentApi; item: ReviewQueueItem; onResolved: () => void }) {
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState<'approve' | 'dismiss' | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const from = item.currentCluster?.publicId ?? 'no cluster';
  async function submit(kind: 'approve' | 'dismiss') {
    if (!reason.trim()) { setError('Enter the reason for this decision.'); return; }
    setWorking(kind); setError('');
    try {
      if (kind === 'approve') await api.approveProposal(item.reportId, item.proposedClusterId, reason.trim());
      else await api.dismissProposal(item.reportId, item.proposedClusterId, reason.trim());
      setDone(kind === 'approve' ? `Approved. ${item.report.publicId} now belongs to ${item.proposedCluster.publicId}.` : 'Dismissed. The report stays where it is.');
      onResolved();
    } catch (failure) {
      setError(failure instanceof ApiError || failure instanceof Error ? failure.message : 'The decision could not be saved.');
    } finally { setWorking(null); }
  }
  if (done) return <p className="review-outcome" role="status">{done}</p>;
  return <form className="review-actions" onSubmit={event => event.preventDefault()}>
    <label>Reason for your decision (recorded with your name and the time)
      <textarea value={reason} maxLength={1000} rows={2} disabled={working !== null} aria-label={`Reason for ${item.report.publicId}`}
        placeholder="For example: same blocked drain, confirmed from the photos" onChange={event => setReason(event.target.value)} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="review-buttons">
      <button type="button" className="primary" disabled={working !== null} onClick={() => submit('approve')}>{working === 'approve' ? 'Approving�' : `Approve: move ${item.report.publicId} from ${from} to ${item.proposedCluster.publicId}`}</button>
      <button type="button" className="refresh" disabled={working !== null} onClick={() => submit('dismiss')}>{working === 'dismiss' ? 'Dismissing�' : 'Dismiss proposal'}</button>
    </div>
  </form>;
}
