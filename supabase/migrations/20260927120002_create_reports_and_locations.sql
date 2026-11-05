-- Where a report was observed.
--
-- Kept in its own table because the geographic data is queried independently by
-- the clustering and dashboard work in later phases. `accuracy` is preserved
-- deliberately — see docs/database.md.
--
-- `geom` duplicates latitude/longitude in a spatially indexed form. PostGIS
-- functions need it; the raw numbers stay because they are what the API reads
-- and writes.
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  address TEXT,
  geom geometry(Point, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX locations_geom_idx ON locations USING GIST (geom);

-- The reference design renders Pending / In Progress / Resolved as badges.
-- REJECTED is included now because the Phase 4 review queue needs it, and
-- adding a value to an enum later is a schema change.
CREATE TYPE report_status AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED'
);

-- Public-facing identifier, e.g. `CR-1000`. The sequence starts at 1000 so the
-- earliest identifiers are four digits, matching the reference design.
CREATE SEQUENCE report_public_id_seq START 1000;

-- A report is an observation, not the underlying issue — see docs/database.md.
-- The issue it belongs to is a cluster, assigned by the AI in Phase 3.
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id VARCHAR(50) UNIQUE NOT NULL
    DEFAULT ('CR-' || nextval('report_public_id_seq')),
  citizen_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES report_categories(id),
  description TEXT,
  status report_status NOT NULL DEFAULT 'PENDING',
  -- Nullable: a citizen indoors may have no GPS fix, and lacking coordinates
  -- must never stop them reporting a hazard.
  location_id UUID REFERENCES locations(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serves the citizen history query: own reports, newest first.
CREATE INDEX reports_citizen_submitted_idx
  ON reports (citizen_id, submitted_at DESC);

CREATE INDEX reports_status_idx ON reports (status);

CREATE TRIGGER update_reports_updated_at
BEFORE UPDATE ON reports
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
