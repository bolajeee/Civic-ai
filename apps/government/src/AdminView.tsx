import { useEffect, useState, type FormEvent } from 'react';
import type { GovernmentApi } from './api';
import type { AdminSnapshot, GovernmentRole } from './types';
import './admin.css';

const date = (value: string) => new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
}).format(new Date(value));

export function AdminView({ api, currentUserId }: { api: GovernmentApi; currentUserId: string }) {
  const [data, setData] = useState<AdminSnapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [invitationUrl, setInvitationUrl] = useState('');

  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api.administration().then(result => { if (active) setData(result); })
      .catch(error => { if (active) setError(message(error, 'Unable to load administration.')); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, revision]);

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice(''); setInvitationUrl('');
    try {
      const result = await api.createInvitation(String(form.get('role')) as GovernmentRole,
        Number(form.get('expiresInHours')));
      const url = `${window.location.origin}${window.location.pathname}#register?invite=${encodeURIComponent(result.code)}`;
      setInvitationUrl(url);
      setNotice('Invitation created. Copy the link now; the invite code is shown only once.');
      setRevision(value => value + 1);
    } catch (error) { setError(message(error, 'Unable to create invitation.')); }
    finally { setBusy(false); }
  }

  async function copyInvitation() {
    try { await navigator.clipboard.writeText(invitationUrl); setNotice('Registration link copied.'); }
    catch { setNotice('Copy the registration link from the field below.'); }
  }

  async function revoke(id: string) {
    setBusy(true); setError(''); setNotice('');
    try { await api.revokeInvitation(id); setNotice('Invitation revoked.'); setRevision(value => value + 1); }
    catch (error) { setError(message(error, 'Unable to revoke invitation.')); }
    finally { setBusy(false); }
  }

  async function toggleAccount(id: string, current: string) {
    const status = current === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setBusy(true); setError(''); setNotice('');
    try {
      await api.updateAccountStatus(id, status);
      setNotice(status === 'ACTIVE' ? 'Account reactivated.' : 'Account suspended and its refresh sessions revoked.');
      setRevision(value => value + 1);
    } catch (error) { setError(message(error, 'Unable to update account.')); }
    finally { setBusy(false); }
  }

  const now = Date.now();
  return <div className="dashboard admin-page"><div className="page-title"><div><p className="eyebrow">ACCESS CONTROL</p><h1>Administration</h1><p className="muted">Invite government staff and manage workspace access.</p></div><button className="refresh" disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? 'Refreshing…' : '↻ Refresh'}</button></div>
    {error && <div role="alert" className="error">{error}</div>}
    {notice && <p role="status" className="notice admin-notice">{notice}</p>}
    <section className="panel invite-panel"><div><p className="eyebrow">NEW GOVERNMENT ACCOUNT</p><h2>Create a secure invitation</h2><p className="muted">The recipient uses the one-time link to choose their credentials. The assigned role cannot be changed during signup.</p></div>
      <form className="invite-form" onSubmit={createInvitation}><label>Role<select name="role" defaultValue="OPERATOR" disabled={busy}><option value="OPERATOR">Operator</option><option value="ADMIN">Administrator</option></select></label><label>Expires in<select name="expiresInHours" defaultValue="24" disabled={busy}><option value="8">8 hours</option><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></label><button className="primary" disabled={busy}>Create invitation</button></form>
      {invitationUrl && <div className="invitation-result"><label>One-time registration link<input readOnly value={invitationUrl} onFocus={event => event.currentTarget.select()} /></label><button className="refresh" type="button" onClick={copyInvitation}>Copy link</button></div>}
    </section>
    {!data && busy && <div role="status" className="empty panel">Loading government access…</div>}
    {data && <><section className="panel admin-section"><div className="panel-title"><h2>Government accounts</h2><p className="muted">{data.accounts.length} administrator and operator account{data.accounts.length === 1 ? '' : 's'}</p></div><div className="table-scroll"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{data.accounts.map(account => <tr key={account.id}><td><strong>{account.email}</strong>{account.id === currentUserId && <small>Current account</small>}</td><td>{account.role === 'ADMIN' ? 'Administrator' : 'Operator'}</td><td><span className={`badge ${account.status.toLowerCase()}`}>{account.status.toLowerCase()}</span></td><td>{date(account.createdAt)}</td><td>{account.id === currentUserId ? <span className="muted">—</span> : <button className={`table-action ${account.status === 'ACTIVE' ? 'danger-action' : ''}`} disabled={busy} onClick={() => toggleAccount(account.id, account.status)}>{account.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</button>}</td></tr>)}</tbody></table></div></section>
      <section className="panel admin-section"><div className="panel-title"><h2>Recent invitations</h2><p className="muted">Invite codes are never stored in readable form and cannot be displayed again.</p></div>{data.invitations.length === 0 ? <p className="muted">No invitations have been created.</p> : <div className="table-scroll"><table><thead><tr><th>Role</th><th>Created by</th><th>Created</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.invitations.map(invitation => { const status = invitation.usedAt ? 'Used' : invitation.revokedAt ? 'Revoked' : new Date(invitation.expiresAt).getTime() <= now ? 'Expired' : 'Open'; return <tr key={invitation.id}><td>{invitation.role === 'ADMIN' ? 'Administrator' : 'Operator'}</td><td>{invitation.createdByEmail || 'Bootstrap / system'}</td><td>{date(invitation.createdAt)}</td><td>{date(invitation.expiresAt)}</td><td><span className={`badge ${status.toLowerCase()}`}>{status}</span>{invitation.usedByEmail && <small>{invitation.usedByEmail}</small>}</td><td>{status === 'Open' ? <button className="table-action danger-action" disabled={busy} onClick={() => revoke(invitation.id)}>Revoke</button> : <span className="muted">—</span>}</td></tr>; })}</tbody></table></div>}</section></>}
  </div>;
}

function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
