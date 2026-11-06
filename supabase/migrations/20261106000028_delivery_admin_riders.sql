-- Delivery prices from one place, staff editing, handover codes for every buyer, and rider sign-up.
--
-- 1. The database is the only source of delivery prices. public.delivery_settings() gives the
--    storefront the active rate card and the free-delivery, same-day and origin settings, so the
--    cart prices with exactly what checkout charges. Staff change them only through the staff_*
--    functions below, which check and log every change in staff_actions.
-- 2. Handover codes reach buyers without an account: the code is sent on WhatsApp to the order's
--    phone number when it's dispatched (template handover_code). The place-order function also
--    returns it to a guest straight after ordering.
-- 3. Riders apply from a signed-in account. Staff review, ask for more, invite them to in-person
--    checks (ID, licence, police clearance, references) and only then approve. Nobody can be
--    approved without the in-person step. No ID or licence numbers are collected online.
BEGIN;

-- ---------- 1. Delivery settings: one source ----------
ALTER TABLE delivery_rates ADD COLUMN updated_by bigint REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE shop_settings ADD COLUMN delivery_updated_at timestamptz;
-- Rates change only through the staff functions, so every change is checked and logged
DROP POLICY "Staff manage rates" ON delivery_rates;
REVOKE INSERT, UPDATE, DELETE ON delivery_rates FROM authenticated;
REVOKE USAGE ON SEQUENCE delivery_rates_id_seq FROM authenticated;

CREATE FUNCTION public.delivery_settings() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'rates', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'courier', r.courier_id, 'zone', r.zone, 'speed', r.speed, 'fee', r.fee_zmw,
        'kg', r.included_kg, 'perKg', r.per_kg_zmw, 'days', CASE WHEN r.min_days IS NOT NULL AND r.max_days IS NOT NULL THEN jsonb_build_array(r.min_days, r.max_days) END,
        'active', r.active) ORDER BY r.courier_id NULLS FIRST, r.zone, r.speed), '[]')
      FROM delivery_rates r WHERE r.active OR app.is_staff()),
    'freeDelivery', jsonb_build_object('min', s.free_delivery_min_zmw, 'zones', to_jsonb(s.free_delivery_zones)),
    'defaultKg', s.default_parcel_kg,
    'origin', CASE WHEN s.delivery_origin_town IS NOT NULL THEN jsonb_build_object('town', s.delivery_origin_town, 'province', s.delivery_origin_province) END,
    'sameDay', jsonb_build_object('cutoff', s.same_day_cutoff, 'towns', to_jsonb(s.same_day_towns)),
    'closedDays', to_jsonb(s.closed_days),
    'updatedAt', greatest((SELECT max(updated_at) FROM delivery_rates), s.delivery_updated_at))
  FROM shop_settings s
$$;
REVOKE ALL ON FUNCTION public.delivery_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_settings() TO anon, authenticated, service_role;

-- Add or change one rate (one per courier, zone and speed)
CREATE FUNCTION public.staff_save_delivery_rate(courier text, zone text, speed text, fee numeric, included_kg numeric DEFAULT 5,
  per_kg numeric DEFAULT 0, min_days integer DEFAULT NULL, max_days integer DEFAULT NULL, active boolean DEFAULT true) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_courier text := nullif(lower(btrim(courier)), ''); v_id bigint;
BEGIN
  PERFORM app.staff_only('save_delivery_rate', coalesce(v_courier, 'zed-supply') || '/' || coalesce(zone, '') || '/' || coalesce(speed, ''),
    jsonb_build_object('fee', fee, 'included_kg', included_kg, 'per_kg', per_kg, 'min_days', min_days, 'max_days', max_days, 'active', active));
  IF zone IS NULL OR zone NOT IN ('town', 'province', 'country') THEN RAISE EXCEPTION 'Choose same town, same province or elsewhere in Zambia'; END IF;
  IF speed IS NULL OR speed NOT IN ('standard', 'express', 'same_day', 'truck') THEN RAISE EXCEPTION 'Choose standard, express, same day or truck'; END IF;
  IF fee IS NULL OR fee < 0 OR fee > 100000 OR fee <> round(fee, 2) THEN RAISE EXCEPTION 'Enter a fee from K0 to K100,000'; END IF;
  IF included_kg IS NULL OR included_kg < 0 OR included_kg > 100000 THEN RAISE EXCEPTION 'Enter the kilograms the fee covers'; END IF;
  IF per_kg IS NULL OR per_kg < 0 OR per_kg > 10000 OR per_kg <> round(per_kg, 2) THEN RAISE EXCEPTION 'Enter the price per extra kilogram'; END IF;
  IF (min_days IS NULL) <> (max_days IS NULL) OR min_days < 0 OR max_days > 60 OR min_days > max_days THEN RAISE EXCEPTION 'Enter the working days as fewest and most, or leave both empty'; END IF;
  INSERT INTO delivery_rates AS d (courier_id, zone, speed, fee_zmw, included_kg, per_kg_zmw, min_days, max_days, active, updated_at, updated_by)
    VALUES (v_courier, zone, speed, fee, included_kg, per_kg, min_days, max_days, coalesce(active, true), now(), app.user_id())
    ON CONFLICT ON CONSTRAINT delivery_rates_courier_id_zone_speed_key DO UPDATE SET fee_zmw = EXCLUDED.fee_zmw, included_kg = EXCLUDED.included_kg, per_kg_zmw = EXCLUDED.per_kg_zmw,
      min_days = EXCLUDED.min_days, max_days = EXCLUDED.max_days, active = EXCLUDED.active, updated_at = now(), updated_by = EXCLUDED.updated_by
    RETURNING d.id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.staff_delete_delivery_rate(rate_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('delete_delivery_rate', rate_id::text, (SELECT to_jsonb(r) FROM delivery_rates r WHERE r.id = rate_id));
  DELETE FROM delivery_rates WHERE id = rate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such rate'; END IF;
END $$;

CREATE FUNCTION public.staff_set_delivery_settings(free_min numeric, free_zones text[], default_kg numeric, origin_town text, origin_province text,
  same_day_cutoff integer, same_day_towns text[], closed_days integer[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_towns text[] := ARRAY(SELECT DISTINCT btrim(t) FROM unnest(coalesce(same_day_towns, '{}')) t WHERE btrim(t) <> '');
BEGIN
  PERFORM app.staff_only('set_delivery_settings', 'shop', jsonb_build_object('free_min', free_min, 'free_zones', free_zones, 'default_kg', default_kg,
    'origin_town', origin_town, 'origin_province', origin_province, 'same_day_cutoff', same_day_cutoff, 'same_day_towns', v_towns, 'closed_days', closed_days));
  IF free_min IS NOT NULL AND (free_min < 0 OR free_min > 1000000) THEN RAISE EXCEPTION 'Enter a free-delivery amount, or leave it empty for none'; END IF;
  IF NOT coalesce(free_zones, '{}') <@ '{town,province,country}' THEN RAISE EXCEPTION 'Free delivery zones are town, province or country'; END IF;
  IF default_kg IS NULL OR default_kg <= 0 OR default_kg > 1000 THEN RAISE EXCEPTION 'Enter the weight to assume for items without one'; END IF;
  IF nullif(btrim(origin_province), '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM provinces WHERE id = btrim(origin_province)) THEN RAISE EXCEPTION 'Unknown province'; END IF;
  IF same_day_cutoff IS NULL OR same_day_cutoff NOT BETWEEN 0 AND 23 THEN RAISE EXCEPTION 'Enter the same-day cut-off hour, 0 to 23'; END IF;
  IF cardinality(v_towns) > 60 OR EXISTS (SELECT 1 FROM unnest(v_towns) t WHERE char_length(t) > 60) THEN RAISE EXCEPTION 'Too many same-day towns'; END IF;
  IF NOT coalesce(closed_days, '{}') <@ '{0,1,2,3,4,5,6}' THEN RAISE EXCEPTION 'Closed days are 0 (Sunday) to 6 (Saturday)'; END IF;
  UPDATE shop_settings SET free_delivery_min_zmw = free_min, free_delivery_zones = coalesce(free_zones, '{}'), default_parcel_kg = default_kg,
    delivery_origin_town = nullif(btrim(origin_town), ''), delivery_origin_province = nullif(btrim(origin_province), ''),
    same_day_cutoff = staff_set_delivery_settings.same_day_cutoff, same_day_towns = v_towns,
    closed_days = coalesce(staff_set_delivery_settings.closed_days, '{}')::smallint[], delivery_updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.staff_save_delivery_rate(text, text, text, numeric, numeric, numeric, integer, integer, boolean),
  public.staff_delete_delivery_rate(bigint), public.staff_set_delivery_settings(numeric, text[], numeric, text, text, integer, text[], integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_save_delivery_rate(text, text, text, numeric, numeric, numeric, integer, integer, boolean),
  public.staff_delete_delivery_rate(bigint), public.staff_set_delivery_settings(numeric, text[], numeric, text, text, integer, text[], integer[]) TO authenticated;

-- ---------- 2. Handover codes for every buyer ----------
CREATE FUNCTION app.send_handover_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_code text;
BEGIN
  SELECT code INTO v_code FROM order_handover_codes WHERE order_id = NEW.id AND used_at IS NULL AND failed_attempts < 5;
  IF v_code IS NOT NULL THEN
    PERFORM app.queue_notification(NEW.user_id, NEW.id, 'handover_code', jsonb_build_object('ref', NEW.ref, 'code', v_code), NEW.recipient_phone);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.send_handover_code() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_send_handover_code AFTER UPDATE OF status ON orders FOR EACH ROW
  WHEN (NEW.status = 'dispatched' AND OLD.status IS DISTINCT FROM 'dispatched' AND NEW.fulfilment = 'delivery') EXECUTE FUNCTION app.send_handover_code();

-- ---------- 3. Rider sign-up ----------
--   new ──► review ──► vetting (in-person checks) ──► approved
--    ▲  └──────┴──► info_needed ──(rider updates)──► new        any open step ──► rejected
--    └ the rider can withdraw while it is open
CREATE TABLE rider_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  full_name     text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 80),
  phone         text NOT NULL CHECK (phone ~ '^\+260[0-9]{9}$'),
  email         text NOT NULL CHECK (char_length(email) <= 254),
  town          text NOT NULL CHECK (char_length(town) BETWEEN 2 AND 60),
  areas         text CHECK (char_length(areas) <= 300),
  vehicle       text NOT NULL CHECK (vehicle IN ('bicycle', 'motorbike', 'car', 'van', 'truck')),
  owns_vehicle  boolean NOT NULL,
  availability  text[] NOT NULL DEFAULT '{}' CHECK (availability <@ '{weekdays,saturdays,sundays,evenings}'),
  experience    text CHECK (char_length(experience) <= 1000),
  -- What the rider confirms now; staff check the documents in person (nothing is uploaded)
  is_adult      boolean NOT NULL CHECK (is_adult),
  has_licence   boolean NOT NULL,
  has_smartphone boolean NOT NULL CHECK (has_smartphone),
  can_get_clearance boolean NOT NULL CHECK (can_get_clearance),
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'review', 'info_needed', 'vetting', 'approved', 'rejected', 'withdrawn')),
  staff_note    text CHECK (char_length(staff_note) <= 1000),
  reviewed_by   bigint REFERENCES users (id) ON DELETE SET NULL,
  vetted_by     bigint REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  CHECK (vehicle = 'bicycle' OR has_licence)
);
CREATE UNIQUE INDEX rider_applications_open_key ON rider_applications (user_id) WHERE status IN ('new', 'review', 'info_needed', 'vetting');
CREATE INDEX rider_applications_queue_idx ON rider_applications (created_at) WHERE status IN ('new', 'review', 'info_needed', 'vetting');
ALTER TABLE rider_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Your rider applications, or all for staff" ON rider_applications FOR SELECT TO authenticated
  USING (user_id = (SELECT app.user_id()) OR app.is_staff());
REVOKE ALL ON rider_applications FROM anon, authenticated;
GRANT SELECT ON rider_applications TO authenticated;
GRANT ALL ON rider_applications TO service_role;

CREATE FUNCTION app.notify_rider_application(a rider_applications) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.queue_notification(a.user_id, NULL, 'rider_application_update', jsonb_build_object('name', a.full_name, 'status', a.status), a.phone)
$$;
REVOKE ALL ON FUNCTION app.notify_rider_application(rider_applications) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.submit_rider_application(full_name text, phone text, town text, vehicle text, owns_vehicle boolean,
  is_adult boolean, has_licence boolean, has_smartphone boolean, can_get_clearance boolean,
  areas text DEFAULT NULL, availability text[] DEFAULT '{}', experience text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid bigint := app.user_id(); v_email text; v_phone text := app.zm_phone(phone); open_app rider_applications; v_id uuid;
  v_name text := btrim(full_name); v_town text := btrim(town); v_areas text := nullif(btrim(areas), ''); v_exp text := nullif(btrim(experience), '');
  v_avail text[] := ARRAY(SELECT DISTINCT a FROM unnest(coalesce(availability, '{}')) a);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT email INTO v_email FROM users WHERE id = uid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Sign in with a confirmed email to apply'; END IF;
  IF char_length(coalesce(v_name, '')) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Enter your full name'; END IF;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'Enter a Zambian mobile number, for example 0977 123456'; END IF;
  IF char_length(coalesce(v_town, '')) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Enter your town'; END IF;
  IF vehicle IS NULL OR vehicle NOT IN ('bicycle', 'motorbike', 'car', 'van', 'truck') THEN RAISE EXCEPTION 'Choose how you would deliver'; END IF;
  IF NOT coalesce(is_adult, false) THEN RAISE EXCEPTION 'Riders must be 18 or over'; END IF;
  IF vehicle <> 'bicycle' AND NOT coalesce(has_licence, false) THEN RAISE EXCEPTION 'You need a valid driving licence for a %', vehicle; END IF;
  IF NOT coalesce(has_smartphone, false) THEN RAISE EXCEPTION 'You need a smartphone with WhatsApp to take deliveries'; END IF;
  IF NOT coalesce(can_get_clearance, false) THEN RAISE EXCEPTION 'You need a police clearance certificate before your first delivery'; END IF;
  IF NOT v_avail <@ '{weekdays,saturdays,sundays,evenings}' THEN RAISE EXCEPTION 'Choose when you can work'; END IF;
  IF char_length(v_areas) > 300 OR char_length(v_exp) > 1000 THEN RAISE EXCEPTION 'Keep your answers shorter'; END IF;
  SELECT * INTO open_app FROM rider_applications WHERE user_id = uid AND status IN ('new', 'review', 'info_needed', 'vetting') FOR UPDATE;
  IF FOUND THEN
    IF open_app.status <> 'info_needed' THEN RAISE EXCEPTION 'Your application is already with us. We''ll be in touch.'; END IF;
    UPDATE rider_applications SET full_name = v_name, phone = v_phone, email = v_email, town = v_town, areas = v_areas, vehicle = submit_rider_application.vehicle,
      owns_vehicle = coalesce(submit_rider_application.owns_vehicle, false), availability = v_avail, experience = v_exp, is_adult = true,
      has_licence = coalesce(submit_rider_application.has_licence, false), has_smartphone = true, can_get_clearance = true, status = 'new', updated_at = now()
      WHERE id = open_app.id;
    RETURN open_app.id;
  END IF;
  IF (SELECT count(*) FROM rider_applications WHERE user_id = uid AND created_at > now() - interval '30 days') >= 3 THEN
    RAISE EXCEPTION 'You''ve applied several times recently. Contact us on WhatsApp for help.';
  END IF;
  INSERT INTO rider_applications (user_id, full_name, phone, email, town, areas, vehicle, owns_vehicle, availability, experience,
      is_adult, has_licence, has_smartphone, can_get_clearance)
    VALUES (uid, v_name, v_phone, v_email, v_town, v_areas, submit_rider_application.vehicle, coalesce(submit_rider_application.owns_vehicle, false), v_avail, v_exp,
      true, coalesce(submit_rider_application.has_licence, false), true, true)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.withdraw_rider_application(application uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE rider_applications SET status = 'withdrawn', updated_at = now(), decided_at = now()
   WHERE id = application AND user_id = app.user_id() AND status IN ('new', 'review', 'info_needed', 'vetting');
  IF NOT FOUND THEN RAISE EXCEPTION 'No open application was found for your account'; END IF;
END $$;

-- Staff decisions. Approval only after the in-person checks (status vetting), recorded by the
-- staff member who did them; asking, inviting and rejecting need a message the rider sees.
CREATE FUNCTION public.staff_review_rider_application(application uuid, decision text, note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a rider_applications; v_note text := nullif(btrim(note), '');
BEGIN
  PERFORM app.staff_only('review_rider_application', application::text, jsonb_build_object('decision', decision, 'note', v_note));
  IF decision IS NULL OR decision NOT IN ('review', 'info_needed', 'vetting', 'approved', 'rejected') THEN RAISE EXCEPTION 'Choose a decision'; END IF;
  IF decision IN ('info_needed', 'vetting', 'rejected') AND char_length(coalesce(v_note, '')) < 5 THEN RAISE EXCEPTION 'Write a message to the rider'; END IF;
  IF char_length(v_note) > 1000 THEN RAISE EXCEPTION 'Keep the message under 1,000 characters'; END IF;
  SELECT * INTO a FROM rider_applications WHERE id = application FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('new', 'review', 'info_needed', 'vetting') THEN RAISE EXCEPTION 'No open application'; END IF;
  IF decision = 'approved' AND a.status <> 'vetting' THEN RAISE EXCEPTION 'Invite the rider to the in-person checks before approving'; END IF;
  IF decision = 'vetting' AND a.status = 'vetting' THEN RAISE EXCEPTION 'This rider is already invited to the checks'; END IF;
  UPDATE rider_applications SET status = decision, staff_note = coalesce(v_note, staff_note), reviewed_by = app.user_id(), updated_at = now(),
    vetted_by = CASE WHEN decision = 'approved' THEN app.user_id() ELSE vetted_by END,
    decided_at = CASE WHEN decision IN ('approved', 'rejected') THEN now() END
   WHERE id = application RETURNING * INTO a;
  IF decision <> 'review' THEN PERFORM app.notify_rider_application(a); END IF;
END $$;

REVOKE ALL ON FUNCTION public.submit_rider_application(text, text, text, text, boolean, boolean, boolean, boolean, boolean, text, text[], text),
  public.withdraw_rider_application(uuid), public.staff_review_rider_application(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_rider_application(text, text, text, text, boolean, boolean, boolean, boolean, boolean, text, text[], text),
  public.withdraw_rider_application(uuid), public.staff_review_rider_application(uuid, text, text) TO authenticated, service_role;
COMMIT;
