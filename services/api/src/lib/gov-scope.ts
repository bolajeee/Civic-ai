import { query } from '../db';

/**
 * Shared helpers for STATE-vs-FEDERAL visibility scoping. A STATE account
 * sees only reports/clusters whose resolved location.state_id matches its
 * own state_id; a FEDERAL account sees everything, including reports with
 * no resolved location (location_id IS NULL).
 */
export interface GovAccount {
  id: string;
  role: 'ADMIN' | 'OPERATOR';
  governmentLevel: 'STATE' | 'FEDERAL';
  stateId: string | null;
}

/** Params to bind for the `$N::text = 'FEDERAL' OR <alias>.state_id = $N+1::uuid` clause. */
export function scopeParams(gov: GovAccount): [string, string | null] {
  return [gov.governmentLevel, gov.stateId];
}

/** True if a row resolved to `stateId` is visible to this account. */
export function stateInScope(gov: GovAccount, stateId: string | null): boolean {
  return gov.governmentLevel === 'FEDERAL' || (stateId !== null && stateId === gov.stateId);
}

/**
 * True if the cluster (via its anchor location's resolved state) is visible
 * to this account. Used to guard cluster sub-resource/mutation endpoints
 * that take a cluster id directly, so a STATE actor can't reach another
 * state's cluster by guessing/sharing its id even though it's excluded from
 * their list view.
 */
export async function clusterInScope(gov: GovAccount, clusterId: string): Promise<boolean> {
  if (gov.governmentLevel === 'FEDERAL') return true;
  const result = await query<{ state_id: string | null }>(
    `SELECT anchor.state_id FROM issue_clusters ic
     LEFT JOIN locations anchor ON anchor.id = ic.anchor_location_id
     WHERE ic.id = $1`, [clusterId]);
  if (result.rows.length === 0) return false;
  return stateInScope(gov, result.rows[0].state_id);
}

/** Same as {@link clusterInScope}, for a single report via its own location. */
export async function reportInScope(gov: GovAccount, reportId: string): Promise<boolean> {
  if (gov.governmentLevel === 'FEDERAL') return true;
  const result = await query<{ state_id: string | null }>(
    `SELECT l.state_id FROM reports r LEFT JOIN locations l ON l.id = r.location_id
     WHERE r.id = $1`, [reportId]);
  if (result.rows.length === 0) return false;
  return stateInScope(gov, result.rows[0].state_id);
}
