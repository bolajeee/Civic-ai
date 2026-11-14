-- STATE vs FEDERAL is a visibility SCOPE, independent of `role` (which
-- remains the permission tier: what an OPERATOR/ADMIN account can do).
-- A STATE account sees only its own state's issues; FEDERAL sees all states.
CREATE TYPE government_level AS ENUM ('STATE', 'FEDERAL');

ALTER TABLE users
  ADD COLUMN government_level government_level,
  ADD COLUMN state_id UUID REFERENCES nigeria_states(id);

-- Every existing OPERATOR/ADMIN account predates this feature: default them
-- to FEDERAL so nothing becomes newly visible or hidden for them.
UPDATE users SET government_level = 'FEDERAL' WHERE role IN ('OPERATOR', 'ADMIN');

ALTER TABLE users ADD CONSTRAINT users_government_level_state_check
  CHECK (
    (government_level = 'STATE' AND state_id IS NOT NULL)
    OR (government_level = 'FEDERAL' AND state_id IS NULL)
    OR government_level IS NULL
  );

CREATE INDEX users_state_idx ON users (state_id) WHERE state_id IS NOT NULL;
