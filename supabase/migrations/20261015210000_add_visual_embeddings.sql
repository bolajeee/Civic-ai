-- Media-level visual embeddings use Vertex AI's fixed 1408-dimensional
-- multimodal image space. They are intentionally separate from the existing
-- 1536-dimensional semantic text vectors.
CREATE TABLE report_visual_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  media_id UUID NOT NULL UNIQUE REFERENCES report_media(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(150),
  dimensions SMALLINT NOT NULL DEFAULT 1408 CHECK (dimensions = 1408),
  embedding extensions.vector(1408),
  error_code VARCHAR(100),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'COMPLETED') = (embedding IS NOT NULL))
);

CREATE INDEX report_visual_embeddings_queue_idx
  ON report_visual_embeddings (next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE INDEX report_visual_embeddings_report_idx
  ON report_visual_embeddings (report_id, status);

CREATE INDEX report_visual_embeddings_vector_idx
  ON report_visual_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE status = 'COMPLETED';

ALTER TABLE report_duplicate_candidates
  ADD COLUMN visual_similarity DOUBLE PRECISION;

ALTER TABLE report_duplicate_candidates
  ADD CONSTRAINT report_duplicate_candidates_visual_similarity_check
  CHECK (visual_similarity IS NULL OR visual_similarity BETWEEN -1 AND 1);
