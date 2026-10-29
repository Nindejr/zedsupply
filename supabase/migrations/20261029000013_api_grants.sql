-- Table rights for the API roles (PostgreSQL 15+). Apply after 001–012.
-- New Supabase projects no longer give anon, authenticated and service_role access to new
-- tables in public, so the rules from 010 had nothing to work with: signed-in users could read
-- nothing and server functions could write nothing. Row-level security still decides which rows
-- each person reaches; these grants only open the doors those rules expect. Future migrations
-- must grant rights on the tables they add.
BEGIN;

-- Server functions only (the secret key, never in the website)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, app TO service_role;

-- Signed in: read everything the policies allow, except voucher codes and complaint counts
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
             AND c.relname NOT IN ('vouchers') LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t.relname);
  END LOOP;
END $$;
-- Whole rows a store or buyer manages (the policies from 010 limit them to their own)
GRANT INSERT, UPDATE, DELETE ON product_options, product_option_values, product_variants, variant_option_values,
  product_components, product_images, seller_locations, seller_delivery_areas, promotions, promotion_products,
  promotion_areas, deals, user_addresses TO authenticated;
-- Unpublished listings and your own reviews can be deleted; their columns were granted in 010
GRANT DELETE ON products, reviews TO authenticated;
-- New rows take their ids from these
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
-- Validation helpers used by checks and generated columns (trigger functions stay revoked, 011)
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prorettype <> 'trigger'::regtype LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.sig);
  END LOOP;
END $$;

-- MAINTAIN (PostgreSQL 17+) lets a role lock or vacuum a table; the API roles don't need it
DO $$ BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM anon, authenticated';
  END IF;
END $$;

COMMIT;
