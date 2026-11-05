-- Sourced, normalized geographic context; no guessed default scores.
CREATE TABLE issue_cluster_priority_context (
  issue_cluster_id UUID PRIMARY KEY REFERENCES issue_clusters(id) ON DELETE CASCADE,
  population_score DOUBLE PRECISION CHECK (population_score BETWEEN 0 AND 1),
  population_source TEXT,
  location_importance_score DOUBLE PRECISION CHECK (location_importance_score BETWEEN 0 AND 1),
  location_importance_source TEXT,
  updated_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((population_score IS NULL AND population_source IS NULL) OR
    (population_score IS NOT NULL AND population_source IS NOT NULL AND length(trim(population_source)) > 0)),
  CHECK ((location_importance_score IS NULL AND location_importance_source IS NULL) OR
    (location_importance_score IS NOT NULL AND location_importance_source IS NOT NULL AND length(trim(location_importance_source)) > 0))
);

-- Immutable calculation snapshots preserve the evidence/config used at the time.
CREATE TABLE issue_cluster_priority_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_cluster_id UUID NOT NULL REFERENCES issue_clusters(id) ON DELETE CASCADE,
  scoring_version VARCHAR(50) NOT NULL,
  input_snapshot JSONB NOT NULL,
  result JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX issue_cluster_priority_history_idx
  ON issue_cluster_priority_calculations (issue_cluster_id, calculated_at DESC);

CREATE TABLE issue_cluster_priority_jobs (
  issue_cluster_id UUID PRIMARY KEY REFERENCES issue_clusters(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 1,
  evaluated_revision BIGINT,
  last_calculation_id UUID REFERENCES issue_cluster_priority_calculations(id),
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_code VARCHAR(100),
  attempt_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX issue_cluster_priority_due_idx ON issue_cluster_priority_jobs (next_run_at);

CREATE FUNCTION queue_cluster_priority(cluster_id UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO issue_cluster_priority_jobs (issue_cluster_id) VALUES (cluster_id)
  ON CONFLICT (issue_cluster_id) DO UPDATE SET
    revision = issue_cluster_priority_jobs.revision + 1, next_run_at = NOW(), error_code = NULL;
END;
$$;

CREATE FUNCTION invalidate_cluster_priority() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cluster_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'issue_clusters' THEN
    PERFORM queue_cluster_priority(NEW.id);
  ELSIF TG_TABLE_NAME IN ('issue_cluster_reports', 'issue_cluster_priority_context', 'issue_cluster_review_candidates') THEN
    FOR cluster_id IN SELECT DISTINCT id FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.issue_cluster_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.issue_cluster_id END
    ]) AS affected(id) WHERE id IS NOT NULL ORDER BY id LOOP
      -- A parent cascade may already have removed the cluster.
      IF EXISTS (SELECT 1 FROM issue_clusters WHERE id = cluster_id) THEN
        PERFORM queue_cluster_priority(cluster_id);
      END IF;
    END LOOP;
  ELSIF TG_TABLE_NAME = 'reports' THEN
    SELECT m.issue_cluster_id INTO cluster_id FROM issue_cluster_reports m WHERE m.report_id = NEW.id;
    IF cluster_id IS NOT NULL THEN PERFORM queue_cluster_priority(cluster_id); END IF;
  ELSE
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.analysis_type ELSE NEW.analysis_type END) <> 'SEVERITY_ESTIMATION' THEN
      RETURN NULL;
    END IF;
    SELECT m.issue_cluster_id INTO cluster_id FROM issue_cluster_reports m
      WHERE m.report_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.report_id ELSE NEW.report_id END;
    IF cluster_id IS NOT NULL THEN PERFORM queue_cluster_priority(cluster_id); END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER priority_cluster_changed AFTER INSERT OR UPDATE ON issue_clusters
  FOR EACH ROW EXECUTE FUNCTION invalidate_cluster_priority();
CREATE TRIGGER priority_membership_changed AFTER INSERT OR UPDATE OR DELETE ON issue_cluster_reports
  FOR EACH ROW EXECUTE FUNCTION invalidate_cluster_priority();
CREATE TRIGGER priority_report_changed AFTER UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION invalidate_cluster_priority();
CREATE TRIGGER priority_severity_changed AFTER INSERT OR UPDATE OR DELETE ON report_ai_analyses
  FOR EACH ROW EXECUTE FUNCTION invalidate_cluster_priority();
CREATE TRIGGER priority_context_changed AFTER INSERT OR UPDATE OR DELETE ON issue_cluster_priority_context
  FOR EACH ROW EXECUTE FUNCTION invalidate_cluster_priority();
CREATE TRIGGER priority_review_changed AFTER INSERT OR UPDATE OR DELETE ON issue_cluster_review_candidates
  FOR EACH ROW EXECUTE FUNCTION invalidate_cluster_priority();

INSERT INTO issue_cluster_priority_jobs (issue_cluster_id) SELECT id FROM issue_clusters;

CREATE TABLE issue_cluster_priority_context_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_cluster_id UUID NOT NULL REFERENCES issue_clusters(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE FUNCTION audit_cluster_priority_context() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO issue_cluster_priority_context_history (issue_cluster_id, snapshot)
    VALUES (NEW.issue_cluster_id, to_jsonb(NEW));
  RETURN NULL;
END;
$$;
CREATE TRIGGER audit_priority_context AFTER INSERT OR UPDATE ON issue_cluster_priority_context
  FOR EACH ROW EXECUTE FUNCTION audit_cluster_priority_context();
