-- One-time backfill: the trigger only fires on new inserts/geom updates, so
-- pre-existing rows need their state resolved explicitly. Idempotent and
-- safe to re-run.
UPDATE locations l
SET state_id = ns.id
FROM nigeria_states ns
WHERE l.state_id IS NULL
  AND l.geom IS NOT NULL
  AND ST_Contains(ns.geom, l.geom);
