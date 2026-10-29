-- Fixes for Supabase's security advisor after 010 (PostgreSQL 15+). Apply after 001–010.
BEGIN;

-- Trigger functions are never called through the API. Triggers still fire without this right:
-- PostgreSQL checks it only when a trigger is created.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace IN ('public'::regnamespace, 'app'::regnamespace) AND p.prorettype = 'trigger'::regtype
             AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- A fixed search_path on the remaining helpers
ALTER FUNCTION unit_to_base(numeric, measure_unit) SET search_path = public, pg_temp;
ALTER FUNCTION unit_dimension(measure_unit) SET search_path = public, pg_temp;
ALTER FUNCTION valid_age_ranges(age_range[]) SET search_path = public, pg_temp;
ALTER FUNCTION validate_product_variant_matrix(text) SET search_path = public, pg_temp;
ALTER FUNCTION valid_product_features(text[]) SET search_path = public, pg_temp;
ALTER FUNCTION app.e164(text) SET search_path = pg_catalog, pg_temp;

-- Look up the signed-in user once per query, not once per row
ALTER POLICY "Your own account" ON users USING (auth_id = (SELECT auth.uid()) OR app.is_staff());
ALTER POLICY "Rename yourself" ON users USING (auth_id = (SELECT auth.uid())) WITH CHECK (auth_id = (SELECT auth.uid()));

COMMIT;
