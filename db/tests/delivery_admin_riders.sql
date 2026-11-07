-- Run after db/tests/supabase_stub.sql and all migrations on an isolated test database.
-- Leaves no fixtures. Covers 028: delivery settings from one source, staff-only and logged
-- price changes, handover codes sent on dispatch, and rider applications with in-person vetting.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejection(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR unique_violation OR raise_exception
    OR insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %', statement; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.signed_in(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'none', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', pg_my_temp_schema()::regnamespace); END $$;

INSERT INTO provinces (id, name) VALUES ('lusaka', 'Lusaka') ON CONFLICT DO NOTHING;
INSERT INTO towns (name, province_id, lat, lng) VALUES ('Lusaka', 'lusaka', -15.417, 28.283) ON CONFLICT DO NOTHING;
INSERT INTO departments (id, name) VALUES ('rt', 'Rates test');
INSERT INTO sellers (id, name) VALUES ('ra', 'Rates store');
INSERT INTO seller_locations (seller_id, town, province_id) VALUES ('ra', 'Lusaka', 'lusaka');
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status, unit_weight_kg) VALUES ('RA1', 'Kettle', 'rt', 'ra', 100, 'active', 2);
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-00000000a5f1', 'rstaff@example.com', now()),
  ('00000000-0000-0000-0000-00000000a5b1', 'rbuyer@example.com', now()),
  ('00000000-0000-0000-0000-00000000a5b2', 'rrider@example.com', now());
UPDATE users SET is_staff = true WHERE email = 'rstaff@example.com';
-- Migration 029: staff need a role, and these tests don't cover the second sign-in step (staff_admin.sql does)
INSERT INTO staff_roles (user_id, role) SELECT id, 'owner' FROM users WHERE is_staff ON CONFLICT DO NOTHING;
UPDATE shop_settings SET staff_mfa_required = false;

-- ---------- Delivery prices: staff only, logged, read by everyone from one place ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5b1');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_delivery_rate(NULL, 'town', 'standard', 45)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO delivery_rates (zone, speed, fee_zmw) VALUES ('town', 'standard', 1)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_delivery_settings(1, '{town}', 1, NULL, NULL, 11, '{}', '{0}')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5f1');
CREATE TEMP TABLE r1 AS SELECT public.staff_save_delivery_rate(NULL, 'town', 'standard', 45, 5, 5, 1, 2) AS id;
SELECT pg_temp.assert_true((SELECT public.staff_save_delivery_rate('', 'town', 'standard', 50, 5, 5, 1, 2) = id FROM r1), 'one rate per courier, zone and speed: saving again updates it');
SELECT public.staff_save_delivery_rate('zampost', 'town', 'express', 80, 5, 8, 1, 1, false);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_delivery_rate(NULL, 'moon', 'standard', 45)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_delivery_rate(NULL, 'town', 'standard', -1)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_delivery_rate(NULL, 'town', 'standard', 45.555)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_delivery_rate(NULL, 'town', 'standard', 45, 5, 5, 3, 1)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_delivery_rate(NULL, 'town', 'standard', 45, 5, 5, 1, NULL)$q$);
SELECT public.staff_set_delivery_settings(500, '{town}', 1.5, 'Lusaka', 'lusaka', 10, '{" Lusaka ", "Lusaka", ""}', '{0}');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_delivery_settings(500, '{moon}', 1, NULL, NULL, 10, '{}', '{0}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_delivery_settings(500, '{town}', 1, NULL, 'atlantis', 10, '{}', '{0}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_delivery_settings(500, '{town}', 1, NULL, NULL, 24, '{}', '{0}')$q$);
SELECT pg_temp.assert_true((SELECT jsonb_array_length(public.delivery_settings() -> 'rates') = 2), 'staff see inactive rates too');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT count(*) >= 3 FROM staff_actions WHERE action IN ('save_delivery_rate', 'set_delivery_settings')), 'every change is logged');
SELECT pg_temp.assert_true((SELECT updated_by IS NOT NULL FROM delivery_rates WHERE zone = 'town' AND speed = 'standard' AND courier_id IS NULL), 'who changed it is kept');
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL role anon;
SELECT pg_temp.assert_true((SELECT s -> 'rates' -> 0 ->> 'fee' = '50.00' AND jsonb_array_length(s -> 'rates') = 1 AND s -> 'freeDelivery' ->> 'min' = '500.00'
  AND s -> 'sameDay' -> 'towns' = '["Lusaka"]' AND (s -> 'sameDay' ->> 'cutoff')::int = 10 AND s -> 'origin' ->> 'town' = 'Lusaka' AND (s ->> 'defaultKg')::numeric = 1.5
  FROM (SELECT public.delivery_settings() s) x), 'shoppers read the active rates and settings');
-- The checkout prices from the same rates
SELECT pg_temp.assert_true((public.delivery_quote('{"buyer_town":"Lusaka","items":[{"product_id":"RA1","quantity":1}]}') ->> 'total')::numeric = 50, 'checkout uses the saved rate');
RESET role;
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5f1');
SELECT public.staff_delete_delivery_rate(id) FROM r1;
SELECT pg_temp.expect_rejection($q$SELECT public.staff_delete_delivery_rate(id) FROM r1$q$);
SELECT pg_temp.admin();

-- ---------- Handover codes go to the order's phone when it's dispatched ----------
SELECT app.place_order('{"ref":"ZS-HCODE001","contact_name":"Guest","recipient_phone":"+260970000077","buyer_town":"Lusaka","items":[{"product_id":"RA1","quantity":1}]}');
UPDATE orders SET status = 'confirmed' WHERE ref = 'ZS-HCODE001';
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM notifications n JOIN orders o ON o.id = n.order_id WHERE o.ref = 'ZS-HCODE001' AND n.template = 'handover_code'), 'not before dispatch');
UPDATE orders SET status = 'dispatched' WHERE ref = 'ZS-HCODE001';
SELECT pg_temp.assert_true((SELECT n.to_address = '+260970000077' AND n.payload ->> 'code' = h.code FROM notifications n JOIN orders o ON o.id = n.order_id
  JOIN order_handover_codes h ON h.order_id = o.id WHERE o.ref = 'ZS-HCODE001' AND n.template = 'handover_code'), 'a guest gets the code on WhatsApp at dispatch');

-- ---------- Rider applications ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5b2');
SELECT pg_temp.expect_rejection($q$SELECT public.submit_rider_application('Mutale Phiri', '0977123456', 'Lusaka', 'motorbike', true, false, true, true, true)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.submit_rider_application('Mutale Phiri', '0977123456', 'Lusaka', 'motorbike', true, true, false, true, true)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.submit_rider_application('Mutale Phiri', '0977123456', 'Lusaka', 'motorbike', true, true, true, true, false)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.submit_rider_application('Mutale Phiri', '12345', 'Lusaka', 'bicycle', true, true, false, true, true)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.submit_rider_application('Mutale Phiri', '0977123456', 'Lusaka', 'bicycle', true, true, false, true, true, NULL, '{nights}')$q$);
CREATE TEMP TABLE ra AS SELECT public.submit_rider_application('Mutale Phiri', '0977 123456', 'Lusaka', 'bicycle', true, true, false, true, true, 'Kabulonga, Woodlands', '{weekdays,saturdays}', 'Two years delivering groceries') AS id;
GRANT SELECT ON ra TO authenticated;
SELECT pg_temp.assert_true((SELECT phone = '+260977123456' AND status = 'new' AND email = 'rrider@example.com' FROM rider_applications), 'the rider sees their application');
SELECT pg_temp.expect_rejection($q$SELECT public.submit_rider_application('Mutale Phiri', '0977123456', 'Lusaka', 'bicycle', true, true, false, true, true)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_review_rider_application((SELECT id FROM ra), 'approved', 'Welcome')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5b1');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM rider_applications), 'other people can''t see it');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5f1');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_review_rider_application((SELECT id FROM ra), 'approved', 'Welcome aboard')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_review_rider_application((SELECT id FROM ra), 'vetting', NULL)$q$);
SELECT public.staff_review_rider_application((SELECT id FROM ra), 'info_needed', 'Which days can you work evenings?');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5b2');
SELECT public.submit_rider_application('Mutale Phiri', '0977123456', 'Lusaka', 'bicycle', true, true, false, true, true, NULL, '{weekdays,evenings}');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5f1');
SELECT public.staff_review_rider_application((SELECT id FROM ra), 'vetting', 'Come to our Lusaka office on Monday at 10:00 with your NRC and police clearance.');
SELECT public.staff_review_rider_application((SELECT id FROM ra), 'approved', 'Checks passed. Welcome.');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT status = 'approved' AND vetted_by IS NOT NULL AND decided_at IS NOT NULL AND availability = '{weekdays,evenings}' FROM rider_applications), 'approved after the checks, with who checked');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM notifications WHERE template = 'rider_application_update' AND to_address = '+260977123456'), 'the rider hears each decision');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM staff_actions WHERE action = 'review_rider_application'), 'staff decisions are logged');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000a5b2');
SELECT pg_temp.expect_rejection($q$SELECT public.withdraw_rider_application((SELECT id FROM ra))$q$);
SELECT public.submit_rider_application('Mutale Phiri', '0977123456', 'Lusaka', 'motorbike', true, true, true, true, true);
SELECT public.withdraw_rider_application(id) FROM rider_applications WHERE status = 'new';
SELECT pg_temp.admin();
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL role anon;
SELECT pg_temp.expect_rejection($q$SELECT * FROM rider_applications$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.submit_rider_application('X Y', '0977123456', 'Lusaka', 'bicycle', true, true, false, true, true)$q$);
RESET role;

ROLLBACK;
