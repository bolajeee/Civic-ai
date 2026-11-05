-- Formal approval is a separate append-only fact bound to one immutable report
-- version. The version snapshot remains the reviewed evidence record.
-- Storage keys stay server-side; only manifest/checksum coverage is exposed.
ALTER TABLE issue_report_versions
  ADD COLUMN evidence_manifest JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(evidence_manifest) = 'array');

CREATE TABLE issue_report_version_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_report_version_id UUID NOT NULL UNIQUE REFERENCES issue_report_versions(id),
  approved_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX issue_report_version_approvals_time_idx
  ON issue_report_version_approvals (approved_at DESC);

CREATE FUNCTION forbid_issue_report_approval_changes() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issue report approvals are append-only';
END;
$$;

CREATE TRIGGER issue_report_approvals_append_only
  BEFORE UPDATE OR DELETE ON issue_report_version_approvals
  FOR EACH ROW EXECUTE FUNCTION forbid_issue_report_approval_changes();
