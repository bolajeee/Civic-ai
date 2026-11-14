-- Resolves which Nigerian state a location falls in via point-in-polygon
-- against nigeria_states, computed by a trigger (not the application) so
-- every write path -- today's citizen report insert and any future one --
-- gets it for free, mirroring how `geom` is already derived from lat/lng
-- at insert time rather than trusted from the client.
ALTER TABLE locations ADD COLUMN state_id UUID REFERENCES nigeria_states(id);
CREATE INDEX locations_state_idx ON locations (state_id) WHERE state_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_location_state() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.geom IS NOT NULL THEN
    SELECT ns.id INTO NEW.state_id
    FROM nigeria_states ns
    WHERE ST_Contains(ns.geom, NEW.geom)
    LIMIT 1;
  ELSE
    NEW.state_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER locations_set_state
BEFORE INSERT OR UPDATE OF geom ON locations
FOR EACH ROW EXECUTE FUNCTION set_location_state();
