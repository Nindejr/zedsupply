-- Run after db/tests/supabase_stub.sql and all migrations on an isolated test database.
-- Leaves no fixtures. Covers 025: delivery priced per seller parcel from the rate card (zone,
-- speed, weight, courier's own price, free delivery, same-day and truck rules), checkout storing
-- the fee and parcels and refusing a changed fee, a courier's saved live price, receipts for the
-- buyer only, sending receipts, tracking numbers and courier events, and email claims.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejection(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR unique_violation OR raise_exception
    OR insufficient_privilege OR invalid_text_representation THEN rejected := true;
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
-- A quote for the Lusaka buyer, with extra fields
CREATE FUNCTION pg_temp.q(extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT app.delivery_quote('{"buyer_town":"Lusaka","buyer_province_id":"lusaka","items":[{"product_id":"DA1","quantity":3},{"product_id":"DB1","quantity":1}]}'::jsonb || extra)
$$;
CREATE FUNCTION pg_temp.fee(q jsonb, store text) RETURNS numeric LANGUAGE sql AS $$
  SELECT (x ->> 'fee')::numeric FROM jsonb_array_elements(q -> 'parcels') x WHERE x ->> 'seller_id' = store
$$;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', pg_my_temp_schema()::regnamespace); END $$;

-- ---------- Fixtures: a Lusaka store, a Kitwe store, a buyer and a rate card ----------
UPDATE shop_settings SET vat_registered = false;
INSERT INTO departments (id, name) VALUES ('dt', 'Delivery test');
INSERT INTO sellers (id, name) VALUES ('da', 'Lusaka store'), ('db', 'Kitwe store');
INSERT INTO provinces (id, name) VALUES ('lusaka', 'Lusaka'), ('copperbelt', 'Copperbelt') ON CONFLICT DO NOTHING;
INSERT INTO towns (name, province_id, lat, lng) VALUES ('Lusaka', 'lusaka', -15.417, 28.283), ('Kitwe', 'copperbelt', -12.802, 28.213) ON CONFLICT DO NOTHING;
INSERT INTO seller_locations (seller_id, town, province_id) VALUES ('da', 'Lusaka', 'lusaka'), ('db', 'Kitwe', 'copperbelt');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000091b1', 'dbuyer@example.com', now()),
  ('00000000-0000-0000-0000-0000000091b2', 'dother@example.com', now()),
  ('00000000-0000-0000-0000-0000000091a1', 'dseller@example.com', now());
INSERT INTO seller_members (seller_id, user_id) SELECT 'da', id FROM users WHERE email = 'dseller@example.com';
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status, unit_weight_kg, heavy_delivery) VALUES
  ('DA1', 'Kettle', 'dt', 'da', 100, 'active', 2, false),
  ('DB1', 'Lamp', 'dt', 'db', 200, 'active', NULL, false),
  ('DH1', 'Cement', 'dt', 'da', 100, 'active', 50, true);
INSERT INTO delivery_rates (courier_id, zone, speed, fee_zmw, included_kg, per_kg_zmw, min_days, max_days) VALUES
  (NULL, 'town', 'standard', 45, 5, 5, 1, 2), (NULL, 'town', 'express', 85, 5, 8, 1, 1), (NULL, 'town', 'same_day', 120, 5, 10, NULL, NULL),
  (NULL, 'country', 'standard', 150, 5, 12, 3, 7), (NULL, 'country', 'express', 290, 5, 20, 2, 3),
  ('zampost', 'country', 'standard', 125, 5, 10, 4, 8), (NULL, 'town', 'truck', 450, 500, 0.6, 1, 3);

-- ---------- Pricing ----------
-- 3 kettles weigh 6 kg: K45 plus one kg over at K5. The lamp has no weight, so 1 kg: K150.
SELECT pg_temp.assert_true(pg_temp.fee(pg_temp.q(), 'da') = 50 AND pg_temp.fee(pg_temp.q(), 'db') = 150 AND (pg_temp.q() ->> 'total')::numeric = 200, 'standard: zone, weight and default weight');
SELECT pg_temp.assert_true(pg_temp.fee(pg_temp.q('{"courier_id":"zampost"}'), 'db') = 125 AND pg_temp.fee(pg_temp.q('{"courier_id":"zampost"}'), 'da') = 50, 'a courier''s own price applies to its route only');
SELECT pg_temp.assert_true((pg_temp.q('{"delivery_speed":"express"}') ->> 'total')::numeric = 93 + 290, 'express');
-- The Lusaka store doesn't offer same day, so that parcel goes express and says so
SELECT pg_temp.assert_true((SELECT x ->> 'speed' = 'express' AND x ->> 'note' = 'fallback' FROM jsonb_array_elements(pg_temp.q('{"delivery_speed":"same_day"}') -> 'parcels') x WHERE x ->> 'seller_id' = 'da'), 'same day falls back to express');
-- Free standard delivery over K500 in town and province, not across the country
UPDATE shop_settings SET free_delivery_min_zmw = 500;
SELECT pg_temp.assert_true(pg_temp.fee(pg_temp.q('{"items_total_zmw":600}'), 'da') = 0 AND pg_temp.fee(pg_temp.q('{"items_total_zmw":600}'), 'db') = 150, 'free delivery in its zones above the threshold');
SELECT pg_temp.assert_true(pg_temp.fee(pg_temp.q('{"items_total_zmw":499}'), 'da') = 50, 'no free delivery below it');
SELECT pg_temp.assert_true(pg_temp.fee(pg_temp.q('{"items_total_zmw":600,"delivery_speed":"express"}'), 'da') = 93, 'free delivery is for standard only');
UPDATE shop_settings SET free_delivery_min_zmw = NULL;
-- Heavy items go by truck; without a truck rate for the route, or a known town, it waits for a quote
SELECT pg_temp.assert_true((app.delivery_quote('{"buyer_town":"Lusaka","items":[{"product_id":"DH1","quantity":2}]}') ->> 'total')::numeric = 450, 'truck rate, province from the town list');
SELECT pg_temp.assert_true((SELECT (q ->> 'pending')::boolean AND q ->> 'total' IS NULL FROM (SELECT app.delivery_quote('{"buyer_town":"Kitwe","items":[{"product_id":"DH1","quantity":1}]}') q) x), 'no truck rate: quoted later');
SELECT pg_temp.assert_true((app.delivery_quote('{"items":[{"product_id":"DA1","quantity":1}]}') -> 'parcels' -> 0 ->> 'note') = 'location', 'unknown destination: quoted later');
SELECT pg_temp.assert_true((app.delivery_quote('{"fulfilment":"collection","items":[{"product_id":"DA1","quantity":1}]}') ->> 'total')::numeric = 0, 'collection costs nothing');
SELECT pg_temp.expect_rejection($q$SELECT app.delivery_quote('{"delivery_speed":"rocket","items":[{"product_id":"DA1"}]}')$q$);
-- Anyone can ask for an estimate; nobody outside the server reads saved quotes or edits rates
SET LOCAL role anon;
SELECT pg_temp.assert_true((public.delivery_quote('{"buyer_town":"Lusaka","items":[{"product_id":"DA1","quantity":1}]}') ->> 'total')::numeric = 45, 'guests get an estimate');
SELECT pg_temp.expect_rejection($q$SELECT * FROM delivery_quotes$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO delivery_rates (zone, speed, fee_zmw) VALUES ('province', 'standard', 1)$q$);
RESET role;

-- ---------- Checkout stores the fee and the parcels (the place-order function runs as the server) ----------
SELECT pg_temp.expect_rejection($q$SELECT app.place_order('{"ref":"ZS-DLVY0009","buyer_town":"Lusaka","buyer_province_id":"lusaka","delivery_speed":"express","expected_delivery_zmw":300,
  "items":[{"product_id":"DA1","quantity":3},{"product_id":"DB1","quantity":1}]}'::jsonb || jsonb_build_object('user_id', (SELECT id FROM users WHERE email = 'dbuyer@example.com')))$q$);
SELECT pg_temp.expect_rejection($q$SELECT app.place_order('{"ref":"ZS-DLVY0008","receipt_email":"not-an-email","items":[{"product_id":"DA1"}]}'::jsonb || jsonb_build_object('user_id', (SELECT id FROM users WHERE email = 'dbuyer@example.com')))$q$);
SELECT pg_temp.assert_true((SELECT (r ->> 'delivery')::numeric = 383 AND (r ->> 'grand_total')::numeric = 500 + 383 FROM (SELECT app.place_order(
  '{"ref":"ZS-DLVY0001","buyer_town":"Lusaka","buyer_province_id":"lusaka","delivery_speed":"express","expected_delivery_zmw":383,"receipt_email":"dbuyer@example.com",
    "items":[{"product_id":"DA1","quantity":3},{"product_id":"DB1","quantity":1}]}'::jsonb || jsonb_build_object('user_id', (SELECT id FROM users WHERE email = 'dbuyer@example.com'))) r) x), 'the order is charged the quoted delivery');
SELECT pg_temp.assert_true((SELECT (r ->> 'replayed')::boolean AND (r ->> 'delivery')::numeric = 383 FROM (SELECT app.place_order(
  '{"ref":"ZS-DLVY0001","items":[{"product_id":"DA1","quantity":3}]}'::jsonb || jsonb_build_object('user_id', (SELECT id FROM users WHERE email = 'dbuyer@example.com'))) r) x), 'a retry returns the same delivery');
-- The quote rolls everything back and reports the fee
UPDATE shop_settings SET vat_registration_verified = true;
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000091b1');
SELECT pg_temp.assert_true((SELECT (r ->> 'delivery')::numeric = 200 AND NOT (r ->> 'delivery_pending')::boolean AND NOT r ? 'order_id' FROM (SELECT public.checkout_quote(
  '{"buyer_town":"Lusaka","buyer_province_id":"lusaka","items":[{"product_id":"DA1","quantity":3},{"product_id":"DB1","quantity":1}]}') r) x), 'checkout quote includes delivery');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT delivery_zmw = 383 AND delivery_speed = 'express' AND delivery_source = 'rate_card' AND receipt_email = 'dbuyer@example.com' FROM orders WHERE ref = 'ZS-DLVY0001'), 'order fields');
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND sum(fee_zmw) = 383 AND bool_and(speed = 'express') FROM order_parcels pc JOIN orders o ON o.id = pc.order_id WHERE o.ref = 'ZS-DLVY0001'), 'one parcel per seller');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM notifications n JOIN orders o ON o.id = n.order_id WHERE o.ref = 'ZS-DLVY0001' AND n.channel = 'email' AND n.template = 'order_receipt'), 'the email receipt is queued');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM orders WHERE ref LIKE 'ZS-DLVY000_' AND ref <> 'ZS-DLVY0001'), 'refused orders leave nothing');

-- ---------- A courier's live price, used only for the same cart while fresh ----------
CREATE TEMP TABLE live AS SELECT app.save_delivery_quote(
  '{"buyer_town":"Lusaka","buyer_province_id":"lusaka","items":[{"product_id":"DB1","quantity":1}]}',
  '{"parcels":[{"seller_id":"db","fee":99,"source":"courier_api","min_days":1,"max_days":2}]}') AS id;
GRANT SELECT ON live TO authenticated;
SELECT pg_temp.expect_rejection($q$SELECT app.place_order(jsonb_build_object('ref', 'ZS-DLVY0007', 'buyer_town', 'Lusaka', 'buyer_province_id', 'lusaka', 'delivery_quote_id', (SELECT id FROM live),
  'items', '[{"product_id":"DB1","quantity":2}]'::jsonb, 'user_id', (SELECT id FROM users WHERE email = 'dbuyer@example.com')))$q$);
SELECT pg_temp.assert_true((SELECT (r ->> 'delivery')::numeric = 99 FROM (SELECT app.place_order(jsonb_build_object('ref', 'ZS-DLVY0002', 'buyer_town', 'Lusaka', 'buyer_province_id', 'lusaka',
  'delivery_quote_id', (SELECT id FROM live), 'items', '[{"product_id":"DB1","quantity":1}]'::jsonb, 'user_id', (SELECT id FROM users WHERE email = 'dbuyer@example.com'))) r) x), 'the courier''s live price is charged');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT delivery_source = 'courier_api' FROM orders WHERE ref = 'ZS-DLVY0002'), 'marked as a courier price');
UPDATE delivery_quotes SET expires_at = now() - interval '1 minute';
SELECT pg_temp.expect_rejection($q$SELECT app.place_order(jsonb_build_object('ref', 'ZS-DLVY0006', 'buyer_town', 'Lusaka', 'buyer_province_id', 'lusaka', 'delivery_quote_id', (SELECT id FROM live),
  'items', '[{"product_id":"DB1","quantity":1}]'::jsonb, 'user_id', (SELECT id FROM users WHERE email = 'dbuyer@example.com')))$q$);

-- ---------- Receipts ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000091b1');
SELECT pg_temp.assert_true((SELECT (r ->> 'grand_total')::numeric = 883 AND jsonb_array_length(r -> 'items') = 2 AND jsonb_array_length(r -> 'parcels') = 2
  FROM (SELECT public.order_receipt('zs-dlvy0001') r) x), 'the buyer reads the receipt');
SELECT public.send_receipt('ZS-DLVY0001', 'whatsapp', '097 123 4567');
SELECT pg_temp.expect_rejection($q$SELECT public.send_receipt('ZS-DLVY0001', 'whatsapp', '12345')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.send_receipt('ZS-DLVY0001', 'email', 'nope@')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.send_receipt('ZS-DLVY0001', 'fax', 'x')$q$);
SELECT public.send_receipt('ZS-DLVY0001', 'email', 'me@example.com') FROM generate_series(1, 3);
SELECT pg_temp.expect_rejection($q$SELECT public.send_receipt('ZS-DLVY0001', 'email', 'me@example.com')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000091b2');
SELECT pg_temp.expect_rejection($q$SELECT public.order_receipt('ZS-DLVY0001')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.send_receipt('ZS-DLVY0001', 'email', 'me@example.com')$q$);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM order_parcels), 'other buyers see no parcels');
SELECT pg_temp.admin();
SET LOCAL role anon;
SELECT pg_temp.expect_rejection($q$SELECT public.order_receipt('ZS-DLVY0001')$q$);
RESET role;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM notifications WHERE to_address = '+260971234567' AND channel = 'whatsapp'), 'WhatsApp numbers are normalised');
SELECT pg_temp.assert_true((SELECT count(*) = 4 AND bool_and(channel = 'email') FROM app.claim_notifications('email') n JOIN orders o ON o.id = n.order_id WHERE o.ref = 'ZS-DLVY0001'), 'the email channel is claimed on its own');

-- ---------- Tracking: the seller's tracking number, then the courier's updates ----------
UPDATE orders SET status = 'confirmed', recipient_phone = '+260970000001' WHERE ref = 'ZS-DLVY0001';
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000091a1');
SELECT public.record_shipment('ZS-DLVY0001', 'da', 'packed');
SELECT public.record_shipment('ZS-DLVY0001', 'da', 'dispatched', 'TRK-0001');
SELECT pg_temp.assert_true((SELECT tracking_ref = 'TRK-0001' FROM order_parcels WHERE seller_id = 'da'), 'the tracking number reaches the parcel');
SELECT pg_temp.expect_rejection($q$SELECT app.record_courier_event('dropsync', 'e1', 'TRK-0001', 'in_transit', NULL, NULL, now())$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((app.record_courier_event('dropsync', 'e2', 'TRK-0001', 'out_for_delivery', 'With the rider', 'Lusaka', now()) ->> 'recorded')::boolean, 'a courier event is recorded');
SELECT pg_temp.assert_true((app.record_courier_event('dropsync', 'e2', 'TRK-0001', 'out_for_delivery', 'With the rider', 'Lusaka', now()) ->> 'replayed')::boolean, 'a repeated event is recorded once');
SELECT app.record_courier_event('dropsync', 'e1', 'TRK-0001', 'picked_up', 'Collected', 'Lusaka', now() - interval '2 hours');
SELECT pg_temp.assert_true((SELECT courier_status = 'out_for_delivery' AND courier_id = 'dropsync' FROM order_parcels WHERE seller_id = 'da'), 'the latest event by time wins, and names the courier');
SELECT pg_temp.expect_rejection($q$SELECT app.record_courier_event('dropsync', 'e3', 'TRK-NONE', 'in_transit', NULL, NULL, now())$q$);
SELECT pg_temp.expect_rejection($q$SELECT app.record_courier_event('dropsync', 'e4', 'TRK-0001', 'teleported', NULL, NULL, now())$q$);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM notifications n JOIN orders o ON o.id = n.order_id WHERE o.ref = 'ZS-DLVY0001' AND n.template = 'parcel_update'), 'the buyer hears when it''s out for delivery');
SELECT pg_temp.assert_true((SELECT status = 'dispatched' FROM orders WHERE ref = 'ZS-DLVY0001'), 'courier events alone don''t complete the order');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000091b1');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM courier_tracking_events), 'the buyer reads their tracking');

ROLLBACK;
