-- Fixed search paths for two helpers from 025 (Supabase advisor: function_search_path_mutable),
-- and no direct execution by API roles: only the pricing and checkout functions use them.
BEGIN;
ALTER FUNCTION app.delivery_zone(text, text, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION app.delivery_request_key(jsonb) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION app.delivery_zone(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.delivery_request_key(jsonb) FROM PUBLIC, anon, authenticated;
COMMIT;
