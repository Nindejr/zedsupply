-- Review corrections. Apply after 011; do not rewrite deployed migrations.
BEGIN;

-- Repair any links created by 010 before a contact was confirmed. Keep historical rows,
-- but require confirmation again and remove privileges that an unverified signup could inherit.
DELETE FROM seller_members WHERE user_id IN (
  SELECT u.id FROM users u JOIN auth.users a ON a.id = u.auth_id
  WHERE a.email_confirmed_at IS NULL AND a.phone_confirmed_at IS NULL
);
UPDATE users u SET is_staff = false, auth_id = NULL FROM auth.users a
  WHERE u.auth_id = a.id AND a.email_confirmed_at IS NULL AND a.phone_confirmed_at IS NULL;
UPDATE users u SET
  email = CASE WHEN a.email_confirmed_at IS NOT NULL THEN nullif(btrim(a.email), '') END,
  phone = CASE WHEN a.phone_confirmed_at IS NOT NULL THEN app.e164(a.phone) END
  FROM auth.users a WHERE u.auth_id = a.id;

-- An unverified signup must neither reserve a contact nor inherit a previous account.
CREATE OR REPLACE FUNCTION app.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ph text := CASE WHEN NEW.phone_confirmed_at IS NOT NULL THEN app.e164(NEW.phone) END;
  em text := CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN nullif(btrim(NEW.email), '') END;
  existing users%ROWTYPE;
  matches integer;
BEGIN
  IF ph IS NULL AND em IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO existing FROM users WHERE auth_id = NEW.id FOR UPDATE;
  IF FOUND THEN
    -- A contact Supabase hasn't confirmed keeps what's on file (a walk-in buyer's phone, say)
    UPDATE users SET phone = coalesce(ph, phone), email = coalesce(em, email) WHERE id = existing.id;
    RETURN NEW;
  END IF;
  SELECT count(*) INTO matches FROM users
    WHERE (ph IS NOT NULL AND phone = ph) OR (em IS NOT NULL AND lower(email) = lower(em));
  IF matches > 1 THEN RAISE EXCEPTION 'Contact details match different accounts; contact support'; END IF;
  SELECT * INTO existing FROM users
    WHERE (ph IS NOT NULL AND phone = ph) OR (em IS NOT NULL AND lower(email) = lower(em)) FOR UPDATE;
  IF FOUND THEN
    IF existing.auth_id IS NOT NULL OR existing.is_staff OR EXISTS (
      SELECT 1 FROM seller_members WHERE user_id = existing.id
    ) THEN RAISE EXCEPTION 'Account linking requires staff assistance'; END IF;
    UPDATE users SET auth_id = NEW.id, phone = coalesce(ph, phone), email = coalesce(em, email)
      WHERE id = existing.id;
  ELSE
    INSERT INTO users (name, phone, email, auth_id)
      VALUES (coalesce(left(btrim(NEW.raw_user_meta_data ->> 'name'), 80), ''), ph, em, NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER on_auth_user_changed ON auth.users;
CREATE TRIGGER on_auth_user_changed AFTER UPDATE OF phone, email, phone_confirmed_at, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.handle_new_auth_user();
DROP FUNCTION app.handle_auth_user_change();

-- Retain order history, but never resurrect a deleted identity's privileges.
CREATE FUNCTION app.revoke_deleted_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM seller_members WHERE user_id IN (SELECT id FROM users WHERE auth_id = OLD.id);
  UPDATE users SET is_staff = false WHERE auth_id = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER before_auth_user_deleted BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.revoke_deleted_identity();

-- Child content is part of the approved listing; prices and stock may still change live.
CREATE FUNCTION app.moderate_product_content() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated' AND NOT app.is_staff() THEN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'product_variants' THEN
      IF NEW.image IS NOT DISTINCT FROM OLD.image AND NEW.product_id = OLD.product_id THEN RETURN NEW; END IF;
    END IF;
    IF TG_OP <> 'INSERT' THEN
      UPDATE products SET status = 'pending' WHERE id = OLD.product_id AND status = 'active';
    END IF;
    IF TG_OP <> 'DELETE' THEN
      UPDATE products SET status = 'pending' WHERE id = NEW.product_id AND status = 'active';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['product_options', 'product_option_values', 'product_variants',
                           'variant_option_values', 'product_components', 'product_images'] LOOP
    EXECUTE format('CREATE TRIGGER moderate_content AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION app.moderate_product_content()', t);
  END LOOP;
END $$;
-- Public photo URLs must be immutable. Upload a new path and submit the new reference for review.
DROP POLICY "Stores replace their own photos" ON storage.objects;
DROP POLICY "Stores delete their own photos" ON storage.objects;

-- Whole-table privileges bypass RLS. Keep only the row operations already granted.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION app.handle_new_auth_user(), app.revoke_deleted_identity(),
  app.moderate_product_content() FROM PUBLIC, anon, authenticated;
COMMIT;
