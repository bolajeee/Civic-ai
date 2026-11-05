CREATE SEQUENCE issue_cluster_public_id_seq START 1000;

CREATE TABLE issue_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id VARCHAR(50) UNIQUE NOT NULL DEFAULT ('IC-' || nextval('issue_cluster_public_id_seq')),
  category_id UUID NOT NULL REFERENCES report_categories(id),
  status report_status NOT NULL DEFAULT 'PENDING',
  -- Fixed seed location prevents transitive matches drifting across a city.
  anchor_location_id UUID REFERENCES locations(id),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  centroid geometry(Point, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX issue_clusters_centroid_idx ON issue_clusters USING GIST (centroid);
CREATE INDEX issue_clusters_status_idx ON issue_clusters (status);
CREATE TRIGGER update_issue_clusters_updated_at BEFORE UPDATE ON issue_clusters
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE issue_cluster_reports (
  report_id UUID PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  issue_cluster_id UUID NOT NULL REFERENCES issue_clusters(id),
  confidence NUMERIC(5,4) CHECK (confidence BETWEEN 0 AND 1),
  assignment_method VARCHAR(10) NOT NULL CHECK (assignment_method IN ('AI', 'HUMAN', 'SYSTEM')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX issue_cluster_reports_cluster_idx ON issue_cluster_reports (issue_cluster_id);

-- Aggregates also stay correct after membership moves and cascading report deletion.
CREATE FUNCTION refresh_issue_cluster_aggregates() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cluster_id UUID;
BEGIN
  FOR cluster_id IN
    SELECT DISTINCT id FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.issue_cluster_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.issue_cluster_id END
    ]) AS affected(id) WHERE id IS NOT NULL ORDER BY id
  LOOP
    PERFORM 1 FROM issue_clusters WHERE id = cluster_id FOR UPDATE;
    UPDATE issue_clusters SET
      report_count = (SELECT COUNT(*) FROM issue_cluster_reports WHERE issue_cluster_id = cluster_id),
      centroid = (SELECT ST_Centroid(ST_Collect(l.geom))
        FROM issue_cluster_reports m JOIN reports r ON r.id = m.report_id
        JOIN locations l ON l.id = r.location_id WHERE m.issue_cluster_id = cluster_id)
    WHERE id = cluster_id;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER refresh_issue_cluster_aggregates
AFTER INSERT OR UPDATE OR DELETE ON issue_cluster_reports
FOR EACH ROW EXECUTE FUNCTION refresh_issue_cluster_aggregates();

CREATE TABLE report_cluster_decisions (
  report_id UUID PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('ASSIGNED', 'SINGLETON', 'REVIEW', 'SKIPPED', 'FAILED')),
  clustering_version VARCHAR(50) NOT NULL,
  config JSONB NOT NULL,
  matched_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  scoring_version VARCHAR(50),
  error_code VARCHAR(100),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE issue_cluster_review_candidates (
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  issue_cluster_id UUID NOT NULL REFERENCES issue_clusters(id),
  candidate_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  score NUMERIC(5,4) NOT NULL CHECK (score BETWEEN 0 AND 1),
  scoring_version VARCHAR(50) NOT NULL,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('LOW_SCORE', 'AMBIGUOUS_MATCH')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DISMISSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (report_id, issue_cluster_id)
);
CREATE INDEX issue_cluster_review_pending_idx ON issue_cluster_review_candidates (created_at)
WHERE status = 'PENDING';
