-- Independent analysis with the same durable queue and unique report/type key.
ALTER TABLE report_ai_analyses DROP CONSTRAINT report_ai_analyses_analysis_type_check;
ALTER TABLE report_ai_analyses ADD CONSTRAINT report_ai_analyses_analysis_type_check
  CHECK (analysis_type IN ('IMAGE_CLASSIFICATION', 'SEVERITY_ESTIMATION'));

-- Snapshot preserves text/location, media reference, rubric and threshold used.
-- Original media bytes remain in object storage, referenced by media_id/key.
ALTER TABLE report_ai_analyses ADD COLUMN input_snapshot JSONB;
