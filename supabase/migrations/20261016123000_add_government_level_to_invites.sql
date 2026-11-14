-- Invites fix a new account's level/state server-side at creation time,
-- exactly like they already fix `role` -- never trusted from the register
-- payload. DEFAULT 'FEDERAL' keeps any already-issued, unused invite codes
-- valid without a data backfill.
ALTER TABLE gov_invite_codes
  ADD COLUMN government_level government_level NOT NULL DEFAULT 'FEDERAL',
  ADD COLUMN state_id UUID REFERENCES nigeria_states(id);

ALTER TABLE gov_invite_codes ADD CONSTRAINT gov_invite_codes_level_state_check
  CHECK (
    (government_level = 'STATE' AND state_id IS NOT NULL)
    OR (government_level = 'FEDERAL' AND state_id IS NULL)
  );
