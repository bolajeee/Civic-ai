-- Immutable snapshots of compiled issue reports. A version captures exactly the
-- evidence and review-readiness state visible when an officer creates it.
ALTER TABLE issue_clusters
  ADD COLUMN next_report_version INTEGER NOT NULL DEFAULT 1
  CHECK (next_report_version > 0);

CREATE TABLE issue_report_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_cluster_id UUID NOT NULL REFERENCES issue_clusters(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  snapshot JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issue_cluster_id, version_number)
);

CREATE INDEX issue_report_versions_cluster_idx
  ON issue_report_versions (issue_cluster_id, version_number DESC);

CREATE FUNCTION forbid_issue_report_version_changes() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issue report versions are append-only';
END;
$$;

CREATE TRIGGER issue_report_versions_append_only
  BEFORE UPDATE OR DELETE ON issue_report_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_issue_report_version_changes();
