CREATE TABLE citizen_notification_preferences (
  citizen_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  report_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE citizen_push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 20 AND 4096),
  platform TEXT NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ
);

CREATE INDEX citizen_push_devices_citizen_idx
  ON citizen_push_devices (citizen_id) WHERE disabled_at IS NULL;

CREATE TABLE citizen_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'REPORT_STATUS_CHANGED'),
  report_status report_status NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX citizen_notifications_inbox_idx
  ON citizen_notifications (citizen_id, created_at DESC, id DESC);

CREATE TABLE citizen_push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES citizen_notifications(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES citizen_push_devices(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (notification_id, device_id)
);

CREATE INDEX citizen_push_deliveries_queue_idx
  ON citizen_push_deliveries (next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE FUNCTION queue_citizen_report_notification() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  notification_id UUID;
  status_label TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status = 'PENDING' THEN
    RETURN NULL;
  END IF;

  IF NOT COALESCE((
    SELECT report_updates_enabled
    FROM citizen_notification_preferences
    WHERE citizen_id = NEW.citizen_id
  ), TRUE) THEN
    RETURN NULL;
  END IF;

  status_label := CASE NEW.status
    WHEN 'IN_PROGRESS' THEN 'in progress'
    WHEN 'RESOLVED' THEN 'resolved'
    WHEN 'REJECTED' THEN 'rejected'
    ELSE lower(NEW.status::text)
  END;

  INSERT INTO citizen_notifications
    (citizen_id, report_id, kind, report_status, title, body, data)
  VALUES
    (NEW.citizen_id, NEW.id, 'REPORT_STATUS_CHANGED', NEW.status,
     'Report update', NEW.public_id || ' is now ' || status_label || '.',
     jsonb_build_object('reportId', NEW.id, 'publicId', NEW.public_id,
                        'status', NEW.status::text, 'route', '/report-details/' || NEW.public_id))
  RETURNING id INTO notification_id;

  IF notification_id IS NOT NULL THEN
    INSERT INTO citizen_push_deliveries (notification_id, device_id)
    SELECT notification_id, id
    FROM citizen_push_devices
    WHERE citizen_id = NEW.citizen_id AND disabled_at IS NULL
    ON CONFLICT (notification_id, device_id) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER queue_citizen_report_notification
AFTER UPDATE OF status ON reports
FOR EACH ROW EXECUTE FUNCTION queue_citizen_report_notification();
