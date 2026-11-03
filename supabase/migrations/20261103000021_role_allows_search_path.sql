-- Advisor fix for 020: pin app.role_allows's search_path like every other helper.
BEGIN;
ALTER FUNCTION app.role_allows(text, text) SET search_path = public, pg_temp;
COMMIT;
