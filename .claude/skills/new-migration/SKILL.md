---
name: new-migration
description: Use when adding or changing database schema in CivicAI (tables, columns, indexes, triggers, enums, functions). Creates a timestamped Supabase migration that keeps RLS on and follows repo conventions.
---

# New migration

The schema lives only in `supabase/migrations/`. The API connects as the table owner, so RLS never restricts it; RLS exists to keep the anon/authenticated roles (Supabase's auto-generated REST API) out of every table.

## 1. Before writing SQL
- Read `docs/database.md` and the most recent migrations touching the same tables.
- Never edit a migration that is already committed to `main`. Fix forward with a new one.
- Decide whether existing rows need a backfill. If so, put it in its own migration after the schema change (see `20261016124000_add_state_to_locations.sql` → `20261016125000_backfill_locations_state.sql`).

## 2. Create the file
Name: `supabase/migrations/YYYYMMDDHHMMSS_<verb>_<thing>.sql` (UTC, later than every existing file, e.g. `20261127090000_create_issue_comments.sql`). Check the last file with `ls supabase/migrations | tail -1`.

## 3. Conventions (copy from `20261116120000_create_sos.sql`)
- Header comment: what the tables are for and anything non-obvious (who writes them, what reads them, what is deliberately *not* stored).
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, plus the `set_updated_at()` trigger:
  ```sql
  CREATE TRIGGER update_<table>_updated_at
  BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  ```
- Enforce invariants in the database with `CHECK`, `UNIQUE`, `NOT NULL` and FKs (with an explicit `ON DELETE`). Don't rely on the API alone.
- Index every FK used in lookups; `USING GIST` for `geography`/`geometry`.
- Locations: never store a state id computed in application code. `locations.state_id` is set by the `set_location_state()` trigger. Keep GPS `accuracy`.
- Citizen-identifying columns stay out of anything the government dashboard reads unless the docs say otherwise.

## 4. RLS (required)
For every new table in `public`:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
```
No policies are needed: only the API (table owner) and the service-role key touch data. End the migration with:
```sql
SELECT public.assert_public_tables_have_rls();
```
It raises if any public table is missing RLS, so a mistake fails the migration instead of exposing the table.

## 5. Verify
- If Docker is available: `npx supabase db reset` from the repo root applies all migrations from scratch. It must finish without errors.
- If not, say the migration was not applied and why. Don't claim it works.
- Update `docs/database.md` (and the feature doc) to describe the new tables, and `docs/progress.md` if this completes a tracked item.
- If API code uses the new schema, add or adjust tests in `services/api/test/` (the `pg` pool is mocked; assert the SQL and bound params).
