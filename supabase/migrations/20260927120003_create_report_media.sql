-- Images attached to a report. The bytes live in the `reports` storage bucket
-- (see 20260909110947_create_reports_bucket.sql); this table holds the
-- reference and the metadata. Matches docs/database.md.
--
-- `checksum` is nullable because it is computed by the upload path, and a
-- report should not fail to submit if hashing is unavailable.
CREATE TABLE report_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  media_type VARCHAR(100) NOT NULL,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  checksum VARCHAR(128),
  -- Preserves the order the citizen staged the photos in.
  display_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX report_media_report_idx ON report_media (report_id, display_order);
