-- Duplicate candidates: existing reports that probably describe the same issue.
-- These are suggestions with the evidence behind them, not decisions. Grouping
-- into clusters, and any review of low-confidence matches, happens later.
CREATE TABLE report_duplicate_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  candidate_report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  distance_meters DOUBLE PRECISION NOT NULL CHECK (distance_meters >= 0),
  semantic_similarity DOUBLE PRECISION NOT NULL,
  category_match BOOLEAN NOT NULL,
  score NUMERIC(5, 4) NOT NULL CHECK (score BETWEEN 0 AND 1),
  scoring_version VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, candidate_report_id),
  CHECK (report_id <> candidate_report_id)
);

CREATE INDEX report_duplicate_candidates_candidate_idx
  ON report_duplicate_candidates (candidate_report_id);

-- One row per report once its search has run. Doubles as the "already
-- searched" marker, so the worker needs no separate job queue: the search is a
-- pure database query and is safe to repeat.
CREATE TABLE report_duplicate_searches (
  report_id UUID PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('COMPLETED', 'NO_LOCATION', 'FAILED')),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  scoring_version VARCHAR(50) NOT NULL,
  error_code VARCHAR(100),
  searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
