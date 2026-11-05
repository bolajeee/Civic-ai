-- Durable, auditable queue for AI analysis of citizen reports.
-- The first supported analysis is image classification.
CREATE TABLE report_ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES report_media(id) ON DELETE CASCADE,
  analysis_type VARCHAR(50) NOT NULL
    CHECK (analysis_type IN ('IMAGE_CLASSIFICATION')),
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(150),
  predicted_category_id UUID REFERENCES report_categories(id),
  confidence NUMERIC(5, 4)
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  prediction JSONB,
  error_code VARCHAR(100),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, analysis_type)
);

CREATE INDEX report_ai_analyses_queue_idx
  ON report_ai_analyses (next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');
