-- Durable, auditable queue and store for report embeddings.
-- SEMANTIC_TEXT embeds category, description, address and the visual evidence
-- from image classification. Image-vector embeddings can be added later as a
-- new embedding_type without changing this table.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE report_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  embedding_type VARCHAR(50) NOT NULL
    CHECK (embedding_type IN ('SEMANTIC_TEXT')),
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(150),
  dimensions SMALLINT NOT NULL DEFAULT 1536,
  -- The exact text embedded, kept so a vector can be explained and re-created.
  input_text TEXT,
  embedding extensions.vector(1536),
  error_code VARCHAR(100),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, embedding_type)
);

CREATE INDEX report_embeddings_queue_idx
  ON report_embeddings (next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');

-- Cosine-distance index for the duplicate-candidate search that follows.
CREATE INDEX report_embeddings_vector_idx
  ON report_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE status = 'COMPLETED';
