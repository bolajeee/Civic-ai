-- Lock the public schema out of Supabase's auto-generated REST API.
--
-- Every table here was created without row level security, so anyone holding
-- the project's anon key could read and write them directly through PostgREST
-- (users, refresh_tokens, password_reset_tokens, sos_location_updates, ...).
--
-- All data access goes through services/api, which connects as the table
-- owner (postgres) and is therefore not subject to RLS; storage uses the
-- service_role key, which bypasses RLS. Enabling RLS with no policies denies
-- the anon and authenticated roles while leaving the API unchanged.
--
-- Tables owned by extensions (e.g. PostGIS spatial_ref_sys) are skipped: they
-- cannot be altered here and hold only public reference data.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END;
$$;

-- New tables must enable RLS too. Fail loudly in any later migration run if a
-- public table is left without it.
CREATE OR REPLACE FUNCTION public.assert_public_tables_have_rls()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is disabled on public tables: %', missing;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_public_tables_have_rls() FROM PUBLIC, anon, authenticated;

SELECT public.assert_public_tables_have_rls();
