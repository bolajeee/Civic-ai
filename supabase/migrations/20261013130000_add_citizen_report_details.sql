-- Citizen-visible operational metadata. Null means no agency has been assigned.
ALTER TABLE reports ADD COLUMN assigned_agency TEXT;

-- Durable lifecycle events replace timelines inferred from the current status.
CREATE TABLE report_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  status report_status NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX report_status_events_report_idx
  ON report_status_events (report_id, occurred_at, id);

-- Existing reports have one timestamp we can state exactly: submission.
INSERT INTO report_status_events (report_id, status, occurred_at)
SELECT id, 'PENDING', submitted_at FROM reports;

CREATE FUNCTION record_report_status_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO report_status_events (report_id, status, occurred_at)
    VALUES (NEW.id, NEW.status, NEW.submitted_at);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO report_status_events (report_id, status, occurred_at)
    VALUES (NEW.id, NEW.status, NOW());
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER record_report_status_event
AFTER INSERT OR UPDATE OF status ON reports
FOR EACH ROW EXECUTE FUNCTION record_report_status_event();
