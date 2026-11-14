-- Reference boundaries for Nigeria's 36 states + FCT, used to derive which
-- state a report's location falls in (point-in-polygon), and to scope
-- government accounts to a single state. Geometry is vendored from
-- geoBoundaries (NGA-ADM1, CC BY 4.0) rather than resolved via a live API,
-- so state lookup has no external dependency or runtime cost.
CREATE TABLE nigeria_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100) UNIQUE NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX nigeria_states_geom_idx ON nigeria_states USING GIST (geom);
