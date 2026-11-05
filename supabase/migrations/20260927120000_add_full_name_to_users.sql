-- The sign-up form has always collected a full name, but the backend had
-- nowhere to put it: registerSchema never declared fullName, so Zod stripped it
-- from the request body, and this column did not exist.
--
-- Nullable because accounts created before this migration have no name on
-- record, and re-registering them is not an option.
ALTER TABLE users ADD COLUMN full_name VARCHAR(255);
