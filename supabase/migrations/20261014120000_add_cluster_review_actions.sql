-- Who resolved a grouping proposal, when, and why.
ALTER TABLE issue_cluster_review_candidates
  ADD COLUMN reviewed_by UUID REFERENCES users(id),
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN review_reason TEXT;

-- Append-only record of every administrator grouping action. Report and cluster
-- references are also snapshotted in `details` so the record stays readable
-- even if a report is later deleted.
CREATE TABLE issue_cluster_review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(30) NOT NULL CHECK (action IN (
    'APPROVE_CANDIDATE', 'DISMISS_CANDIDATE', 'MOVE_REPORT', 'REMOVE_REPORT',
    'MERGE_CLUSTERS', 'SPLIT_CLUSTER')),
  actor_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0 AND length(reason) <= 1000),
  -- The cluster the action was taken on, and the other cluster it touched (if any).
  issue_cluster_id UUID NOT NULL REFERENCES issue_clusters(id),
  related_cluster_id UUID REFERENCES issue_clusters(id),
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX issue_cluster_review_actions_cluster_idx
  ON issue_cluster_review_actions (issue_cluster_id, created_at DESC);
CREATE INDEX issue_cluster_review_actions_related_idx
  ON issue_cluster_review_actions (related_cluster_id, created_at DESC)
  WHERE related_cluster_id IS NOT NULL;

CREATE FUNCTION forbid_review_action_changes() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issue_cluster_review_actions is append-only';
END;
$$;
CREATE TRIGGER review_actions_append_only
  BEFORE UPDATE OR DELETE ON issue_cluster_review_actions
  FOR EACH ROW EXECUTE FUNCTION forbid_review_action_changes();
