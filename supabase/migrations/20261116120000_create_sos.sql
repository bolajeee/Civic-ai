-- SOS: trusted contacts, curated emergency facilities, alerts, periodic
-- location updates, and the outbound SMS queue that tells contacts about them.
--
-- SOS is citizen-side only: nothing here is read by the government dashboard,
-- and no responder is dispatched. Contacts are reached by SMS (most will not
-- have the app), sent by the API's SMS worker from sos_sms_deliveries.

-- ---------------------------------------------------------------------------
-- Trusted contacts: up to five per citizen (limit enforced by the API).
-- ---------------------------------------------------------------------------
CREATE TABLE trusted_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL CHECK (char_length(btrim(name)) > 0),
  phone_e164 VARCHAR(16) NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  relationship VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (citizen_id, phone_e164)
);

CREATE INDEX trusted_contacts_citizen_idx ON trusted_contacts (citizen_id);

CREATE TRIGGER update_trusted_contacts_updated_at
BEFORE UPDATE ON trusted_contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Curated facilities. OpenStreetMap (via Geoapify) covers police stations,
-- hospitals and fire stations reasonably; it rarely has paramilitary commands
-- (NSCDC, FRSC, ...). Those are collected by hand from official .gov.ng pages
-- and loaded with services/api/scripts/import-facilities.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE emergency_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('POLICE', 'FIRE', 'HOSPITAL', 'PARAMILITARY')),
  agency VARCHAR(20) NOT NULL,
  name VARCHAR(200) NOT NULL,
  address VARCHAR(500),
  phones TEXT[] NOT NULL DEFAULT '{}',
  state_id UUID NOT NULL REFERENCES nigeria_states(id),
  geom geography(Point, 4326) NOT NULL,
  source_url TEXT NOT NULL,
  verified_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agency, name, state_id)
);

CREATE INDEX emergency_facilities_geom_idx ON emergency_facilities USING GIST (geom);

CREATE TRIGGER update_emergency_facilities_updated_at
BEFORE UPDATE ON emergency_facilities
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
CREATE SEQUENCE sos_alert_public_id_seq START 1000;

CREATE TABLE sos_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id VARCHAR(20) UNIQUE NOT NULL
    DEFAULT ('SOS-' || nextval('sos_alert_public_id_seq')),
  citizen_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Client-generated, so a retried request cannot raise a second alert.
  client_alert_id UUID NOT NULL UNIQUE,
  emergency_type TEXT NOT NULL
    CHECK (emergency_type IN ('MEDICAL', 'SECURITY', 'FIRE', 'ACCIDENT')),
  latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  accuracy DOUBLE PRECISION CHECK (accuracy >= 0),
  address VARCHAR(500),
  note VARCHAR(280),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED')),
  -- Location updates: contacts get an SMS at most once per interval, and only
  -- when the citizen has moved. Capped server-side (6 hours / 12 updates).
  update_interval_minutes SMALLINT NOT NULL DEFAULT 30
    CHECK (update_interval_minutes IN (15, 30)),
  last_pinged_at TIMESTAMPTZ,
  last_pinged_lat DOUBLE PRECISION,
  last_pinged_lon DOUBLE PRECISION,
  ping_count SMALLINT NOT NULL DEFAULT 0,
  updates_stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

-- At most one active alert per citizen.
CREATE UNIQUE INDEX sos_alerts_one_active_idx
  ON sos_alerts (citizen_id) WHERE status = 'ACTIVE';

CREATE INDEX sos_alerts_citizen_idx ON sos_alerts (citizen_id, created_at DESC);

-- Every location the phone reported during an alert, pinged to contacts or not.
CREATE TABLE sos_location_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES sos_alerts(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy DOUBLE PRECISION CHECK (accuracy >= 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  pinged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sos_location_updates_alert_idx
  ON sos_location_updates (alert_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Outbound SMS queue. The message body and number are snapshotted at enqueue
-- time so a contact edited or deleted mid-alert does not change what is sent.
-- ---------------------------------------------------------------------------
CREATE TABLE sos_sms_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES sos_alerts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES trusted_contacts(id) ON DELETE SET NULL,
  phone_e164 VARCHAR(16) NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ALERT', 'UPDATE', 'SAFE', 'UPDATES_STOPPED')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id TEXT,
  error_code TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sos_sms_deliveries_queue_idx
  ON sos_sms_deliveries (next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE INDEX sos_sms_deliveries_alert_idx ON sos_sms_deliveries (alert_id);
