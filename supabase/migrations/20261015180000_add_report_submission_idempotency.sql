ALTER TABLE reports
  ADD COLUMN client_submission_id UUID;

CREATE UNIQUE INDEX reports_citizen_submission_id_unique
  ON reports (citizen_id, client_submission_id)
  WHERE client_submission_id IS NOT NULL;
