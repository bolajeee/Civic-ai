import { useEffect, useState } from 'react';
import type { GovernmentApi } from './api';
import type { ClusterEvidenceReport, IssueCluster, ReviewActionResult, ReviewActionType, ReviewHistorySnapshot } from './types';
import './clusters.css';
import './review.css';

const date = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));

const ACTION_LABELS: Record<ReviewActionType, string> = {
  APPROVE_CANDIDATE: 'Approved proposal', DISMISS_CANDIDATE: 'Dismissed proposal', MOVE_REPORT: 'Moved report',
  REMOVE_REPORT: 'Removed report', MERGE_CLUSTERS: 'Merged clusters', SPLIT_CLUSTER: 'Split cluster',
};

type Choice = 'move' | 'remove' | 'split' | 'merge';

interface ActionsProps {
  api: GovernmentApi;
  cluster: { id: string; publicId: string; categorySlug: string };
  reports: ClusterEvidenceReport[];
  /** Other clusters the reviewer can see (the current list page); filtered to the same category here. */
  candidates: IssueCluster[];
  onChanged: () => void;
}

/** Administrator-only controls; every action needs a reason and is recorded with the reviewer and time. */
export function ReviewerActions({ api, cluster, reports, candidates, onChanged }: ActionsProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState<Choice | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const options = candidates.filter(other => other.id !== cluster.id && other.category.slug === cluster.categorySlug
    && ['PENDING', 'IN_PROGRESS'].includes(other.status));
  const visible = new Set(reports.map(report => report.id));
  // Selection only ever refers to reports on the page being shown.
  const picked = selected.filter(id => visible.has(id));
  const toggle = (id: string) => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);

  async function run(choice: Choice) {
    if (!reason.trim()) { setError('Enter the reason for this change.'); return; }
    setWorking(choice); setError(''); setNotice('');
    try {
      let result: ReviewActionResult;
      const why = reason.trim();
      if (choice === 'move') result = await api.moveReport(cluster.id, picked[0], target, why);
      else if (choice === 'remove') result = await api.removeReport(cluster.id, picked[0], why);
      else if (choice === 'split') result = await api.splitCluster(cluster.id, picked, why);
      else result = await api.mergeClusters(cluster.id, source, why);
      setNotice(`${ACTION_LABELS[result.action.type]} — recorded ${date(result.action.createdAt)} WAT. Affected: ${result.clusters.map(item => `${item.publicId} (${item.reportCount} reports)`).join(', ')}.`);
      setSelected([]); setReason(''); setSource('');
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The change could not be saved.');
    } finally { setWorking(null); }
  }
  const idle = working === null;
  const one = picked.length === 1;

  return <section className="reviewer-actions" aria-label="Reviewer actions">
    <p className="eyebrow">ADMINISTRATOR REVIEW</p><h3>Correct this grouping</h3>
    <p className="muted">Changes apply immediately, stay attributed to you, and are listed in the review history below. Reports you move are marked as human-assigned.</p>
    <fieldset disabled={!idle}><legend>Reports on this evidence page</legend>
      {reports.map(report => <label className="pick" key={report.id}><input type="checkbox" checked={picked.includes(report.id)} onChange={() => toggle(report.id)} />{report.publicId} · {report.category.label}</label>)}
    </fieldset>
    <label>Reason (required, recorded with your name and the time)
      <textarea value={reason} maxLength={1000} rows={2} disabled={!idle} onChange={event => setReason(event.target.value)}
        aria-label="Reason for the change" placeholder="For example: both reports show the same collapsed culvert" /></label>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="action-group"><label>Move the selected report to another cluster
      <select aria-label="Target cluster" value={target} disabled={!idle} onChange={event => setTarget(event.target.value)}>
        <option value="">{options.length ? 'Choose a target cluster' : 'No other open same-category clusters on the current list page'}</option>
        {options.map(other => <option key={other.id} value={other.id}>{other.publicId} · {other.reportCount} reports</option>)}</select></label>
      <div className="review-buttons"><button type="button" className="refresh" disabled={!idle || !one || !target} onClick={() => run('move')}>{working === 'move' ? 'Moving…' : 'Move selected report'}</button>
        <button type="button" className="refresh" disabled={!idle || !one} onClick={() => run('remove')}>{working === 'remove' ? 'Removing…' : 'Remove selected report into its own cluster'}</button>
        <button type="button" className="refresh" disabled={!idle || !picked.length} onClick={() => run('split')}>{working === 'split' ? 'Splitting…' : `Split ${picked.length || 'selected'} report${picked.length === 1 ? '' : 's'} into a new cluster`}</button></div></div>
    <div className="action-group"><label>Merge another cluster into {cluster.publicId}
      <select aria-label="Cluster to merge in" value={source} disabled={!idle} onChange={event => setSource(event.target.value)}>
        <option value="">{options.length ? 'Choose the cluster to merge in' : 'No other open same-category clusters on the current list page'}</option>
        {options.map(other => <option key={other.id} value={other.id}>{other.publicId} · {other.reportCount} reports</option>)}</select></label>
      <div className="review-buttons"><button type="button" className="refresh" disabled={!idle || !source} onClick={() => run('merge')}>{working === 'merge' ? 'Merging…' : `Merge into ${cluster.publicId}`}</button></div>
      <small className="muted">Only same-category, open clusters can be merged. Use the list filters to bring other clusters onto this page.</small></div>
  </section>;
}

export function ReviewHistory({ api, id, revision }: { api: GovernmentApi; id: string; revision: number }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReviewHistorySnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api.reviewHistory(id, page).then(result => { if (active) setData(result); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Unable to load review history.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, id, page, revision]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return <section className="review-history" aria-label="Review history" aria-busy={busy}>
    <h3>Review history</h3>
    {error && <p className="error" role="alert">{error}{data ? ' Showing the previously loaded history.' : ''}</p>}
    {busy && !data && <p className="muted" role="status">Loading review history…</p>}
    {data && (data.actions.length ? <div className="table-scroll"><table><thead><tr><th>When (WAT)</th><th>Action</th><th>Reviewer</th><th>Detail</th><th>Reason</th></tr></thead>
      <tbody>{data.actions.map(entry => <tr key={entry.id}><td>{date(entry.createdAt)}</td><td>{ACTION_LABELS[entry.type]}</td><td>{entry.reviewer}</td>
        <td>{describe(entry)}</td><td>{entry.reason}</td></tr>)}</tbody></table></div>
      : <p className="muted">No reviewer changes have been recorded for this cluster.</p>)}
    {data && data.total > data.limit && <div className="cluster-pagination"><span>Page {data.page} of {pages}</span><div>
      <button className="refresh" disabled={busy || data.page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button>
      <button className="refresh" disabled={busy || data.page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div></div>}
  </section>;
}

function describe(entry: ReviewHistorySnapshot['actions'][number]) {
  const { details } = entry;
  const reports = details.reports?.map(report => report.publicId) ?? (details.report ? [details.report.publicId] : []);
  const list = reports.length > 3 ? `${reports.slice(0, 3).join(', ')} and ${reports.length - 3} more` : reports.join(', ');
  if (entry.type === 'DISMISS_CANDIDATE') return `${list} stays out of ${details.proposedCluster?.publicId ?? 'the proposed cluster'}`;
  return `${list || 'Reports'}: ${details.fromCluster?.publicId ?? 'unknown'} → ${details.toCluster?.publicId ?? 'unknown'}`;
}
