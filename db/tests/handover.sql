-- Run after db/tests/supabase_stub.sql and all migrations on an isolated test database.
-- Leaves no fixtures. Covers 024: handover codes issued with every order, readable only by the
-- buyer, entered by the rider or seller to record delivery or collection, wrong codes counted and
-- locked after five, and the order marked delivered once every seller has handed over.
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

-- ---------- Fixtures: two stores, one buyer, one order with a parcel from each ----------
INSERT INTO departments (id, name) VALUES ('ht', 'Handover test');
INSERT INTO sellers (id, name) VALUES ('ha', 'Handover store A'), ('hb', 'Handover store B');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000081b1', 'hbuyer@example.com', now()),
  ('00000000-0000-0000-0000-0000000081b2', 'hother@example.com', now()),
  ('00000000-0000-0000-0000-0000000081a1', 'hsellera@example.com', now()),
  ('00000000-0000-0000-0000-0000000081a2', 'hsellerb@example.com', now());
CREATE TEMP TABLE ids AS SELECT
  (SELECT id FROM users WHERE email = 'hbuyer@example.com') AS buyer,
  (SELECT id FROM users WHERE email = 'hsellera@example.com') AS seller_a,
  (SELECT id FROM users WHERE email = 'hsellerb@example.com') AS seller_b;
GRANT SELECT ON ids TO authenticated;
INSERT INTO seller_members (seller_id, user_id) SELECT 'ha', seller_a FROM ids UNION ALL SELECT 'hb', seller_b FROM ids;
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status) VALUES
  ('HA1', 'Kettle', 'ht', 'ha', 300, 'active'), ('HB1', 'Lamp', 'ht', 'hb', 200, 'active');
SELECT app.place_order('{"ref":"ZS-HAND0001","items":[{"product_id":"HA1","quantity":1},{"product_id":"HB1","quantity":1}]}'::jsonb
  || jsonb_build_object('user_id', (SELECT buyer FROM ids)));
SELECT app.place_order('{"ref":"ZS-HAND0002","items":[{"product_id":"HA1","quantity":1}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids)));
UPDATE orders SET status = 'confirmed' WHERE ref IN ('ZS-HAND0001', 'ZS-HAND0002');
CREATE TEMP TABLE codes AS SELECT o.ref, h.code FROM order_handover_codes h JOIN orders o ON o.id = h.order_id WHERE o.ref LIKE 'ZS-HAND%';
GRANT SELECT ON codes TO authenticated;

-- ---------- Issued with every order ----------
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND bool_and(code ~ '^[0-9]{6}$') FROM codes), 'every order gets a 6-digit code');
SELECT pg_temp.assert_true((SELECT count(DISTINCT code) >= 45 FROM (SELECT app.new_handover_code() AS code FROM generate_series(1, 50)) c), 'codes vary');

-- ---------- Only the buyer reads it ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000081b1');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM order_handover_codes), 'the buyer reads their codes');
SELECT pg_temp.expect_rejection($q$UPDATE order_handover_codes SET failed_attempts = 0$q$);
SELECT pg_temp.expect_rejection($q$SELECT failed_attempts FROM order_handover_codes$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000081a1');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM order_handover_codes), 'sellers cannot read codes');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000081b2');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM order_handover_codes), 'other buyers cannot read codes');
SELECT pg_temp.expect_rejection($q$SELECT public.record_handover('ZS-HAND0001', 'ha', (SELECT code FROM codes WHERE ref = 'ZS-HAND0001'))$q$);
SELECT pg_temp.admin();
SET LOCAL role anon;
SELECT pg_temp.expect_rejection($q$SELECT code FROM order_handover_codes$q$);
RESET role;

-- ---------- Store A hands over with the code ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000081a1');
-- Not before the parcel is on its way, and not for another store's parcel
SELECT pg_temp.expect_rejection($q$SELECT public.record_handover('ZS-HAND0001', 'ha', (SELECT code FROM codes WHERE ref = 'ZS-HAND0001'))$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.record_handover('ZS-HAND0001', 'hb', (SELECT code FROM codes WHERE ref = 'ZS-HAND0001'))$q$);
SELECT public.record_shipment('ZS-HAND0001', 'ha', 'packed');
SELECT public.record_shipment('ZS-HAND0001', 'ha', 'dispatched');
-- A wrong code is counted, not accepted
SELECT pg_temp.assert_true((SELECT public.record_handover('ZS-HAND0001', 'ha', CASE WHEN code = '000000' THEN '111111' ELSE '000000' END)
  = '{"ok": false, "attempts_left": 4}'::jsonb FROM codes WHERE ref = 'ZS-HAND0001'), 'a wrong code is refused with the tries left');
SELECT pg_temp.assert_true((SELECT status = 'dispatched' FROM orders WHERE ref = 'ZS-HAND0001'), 'a wrong code records nothing');
-- The right code, with spaces as people read it out, records the delivery without photo evidence
SELECT pg_temp.assert_true((SELECT (public.record_handover('ZS-HAND0001', 'ha', (SELECT substr(code, 1, 3) || ' ' || substr(code, 4) FROM codes WHERE ref = 'ZS-HAND0001'), 'Left with the buyer')) ->> 'status' = 'delivered'), 'the right code records delivery');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT e.handover AND e.status = 'delivered' AND e.proof_path IS NULL FROM shipment_events e JOIN orders o ON o.id = e.order_id
  WHERE o.ref = 'ZS-HAND0001' AND e.seller_id = 'ha' ORDER BY e.id DESC LIMIT 1), 'the event says the code confirmed it');
SELECT pg_temp.assert_true((SELECT status = 'dispatched' AND delivered_at IS NULL FROM orders WHERE ref = 'ZS-HAND0001'), 'still waiting for store B');
SELECT pg_temp.assert_true((SELECT used_at IS NOT NULL FROM order_handover_codes h JOIN orders o ON o.id = h.order_id WHERE o.ref = 'ZS-HAND0001'), 'the code is marked used');
-- Handover is a delivery or collection only
SELECT pg_temp.expect_rejection($q$INSERT INTO shipment_events (order_id, seller_id, status, handover, created_by)
  SELECT o.id, 'ha', 'packed', true, (SELECT seller_a FROM ids) FROM orders o WHERE o.ref = 'ZS-HAND0001'$q$);

-- ---------- Store B uses the same code; the order is then delivered ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000081a2');
SELECT public.record_shipment('ZS-HAND0001', 'hb', 'packed');
SELECT public.record_shipment('ZS-HAND0001', 'hb', 'dispatched');
SELECT public.record_handover('ZS-HAND0001', 'hb', (SELECT code FROM codes WHERE ref = 'ZS-HAND0001'));
-- Once handed over, there is nothing left to hand over
SELECT pg_temp.expect_rejection($q$SELECT public.record_handover('ZS-HAND0001', 'hb', (SELECT code FROM codes WHERE ref = 'ZS-HAND0001'))$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT status = 'delivered' AND delivered_at IS NOT NULL FROM orders WHERE ref = 'ZS-HAND0001'), 'delivered once every store has handed over');

-- ---------- Five wrong codes lock it; photo evidence is then the way ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000081a1');
SELECT public.record_shipment('ZS-HAND0002', 'ha', 'packed');
SELECT public.record_shipment('ZS-HAND0002', 'ha', 'dispatched');
SELECT public.record_handover('ZS-HAND0002', 'ha', CASE WHEN code = '111111' THEN '222222' ELSE '111111' END) FROM codes, generate_series(1, 5) WHERE ref = 'ZS-HAND0002';
SELECT pg_temp.expect_rejection($q$SELECT public.record_handover('ZS-HAND0002', 'ha', (SELECT code FROM codes WHERE ref = 'ZS-HAND0002'))$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT failed_attempts = 5 AND used_at IS NULL FROM order_handover_codes h JOIN orders o ON o.id = h.order_id WHERE o.ref = 'ZS-HAND0002'), 'locked after five wrong codes');
SELECT pg_temp.assert_true((SELECT status = 'dispatched' FROM orders WHERE ref = 'ZS-HAND0002'), 'a locked code records nothing');

ROLLBACK;
