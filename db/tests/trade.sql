-- Run after db/tests/supabase_stub.sql and all migrations on an isolated test database.
-- Leaves no fixtures. Covers 023: trade listings (units, minimum orders, multiples, up to 9999),
-- bulk prices for trade quantities, heavy items flagged for a truck quote, and business details
-- on accounts and orders.
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
CREATE FUNCTION pg_temp.place(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT app.place_order(p) $$;

-- ---------- Fixtures ----------
INSERT INTO departments (id, name) VALUES ('tt', 'Trade test');
INSERT INTO sellers (id, name) VALUES ('ts', 'Trade seller');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000071b1', 'tbuyer@example.com', now()),
  ('00000000-0000-0000-0000-0000000071b2', 'tseller@example.com', now());
CREATE TEMP TABLE ids AS SELECT
  (SELECT id FROM users WHERE email = 'tbuyer@example.com') AS buyer,
  (SELECT id FROM users WHERE email = 'tseller@example.com') AS seller;
GRANT SELECT ON ids TO authenticated;
INSERT INTO seller_members (seller_id, user_id) SELECT 'ts', seller FROM ids;
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status, stock_qty, trade, sell_unit, min_order_qty, order_step, heavy_delivery, unit_weight_kg) VALUES
  ('TC', 'Cement, 50 kg bag', 'tt', 'ts', 200, 'active', 5000, true, 'bag', 20, 10, true, 50),
  ('TF', 'Fertiliser, 50 kg', 'tt', 'ts', 900, 'active', NULL, true, 'bag', 1, 1, false, NULL),
  ('TO', 'Ordinary kettle', 'tt', 'ts', 300, 'active', NULL, false, NULL, 1, 1, false, NULL);
INSERT INTO price_tiers (product_id, min_qty, price_zmw) VALUES ('TC', 100, 190), ('TC', 1000, 180);

-- ---------- Listing rules ----------
SELECT pg_temp.expect_rejection($q$INSERT INTO products (id, title, department_id, seller_id, price_zmw, min_order_qty) VALUES ('TX1', 'Min without trade', 'tt', 'ts', 10, 5)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO products (id, title, department_id, seller_id, price_zmw, trade, min_order_qty, order_step) VALUES ('TX2', 'Min not a multiple', 'tt', 'ts', 10, true, 15, 10)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO products (id, title, department_id, seller_id, price_zmw, sell_unit) VALUES ('TX3', 'Unknown unit', 'tt', 'ts', 10, 'barrel')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO products (id, title, department_id, seller_id, price_zmw, unit_weight_kg) VALUES ('TX4', 'No weight', 'tt', 'ts', 10, 0)$q$);
-- Bulk prices: trade listings reach 9999, ordinary ones stop at 99, and none start at or below the minimum
SELECT pg_temp.expect_rejection($q$INSERT INTO price_tiers (product_id, min_qty, price_zmw) VALUES ('TO', 100, 250)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO price_tiers (product_id, min_qty, price_zmw) VALUES ('TC', 20, 195)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO price_tiers (product_id, min_qty, price_zmw) VALUES ('TC', 10000, 170)$q$);
INSERT INTO price_tiers (product_id, min_qty, price_zmw) VALUES ('TO', 10, 280);

-- A store member can set the trade columns on their own listing
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000071b2');
UPDATE products SET trade = true, sell_unit = 'piece', min_order_qty = 6, order_step = 6 WHERE id = 'TO';
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT trade AND min_order_qty = 6 FROM products WHERE id = 'TO'), 'members set trade quantities');
DELETE FROM price_tiers WHERE product_id = 'TO';
UPDATE products SET trade = false, sell_unit = NULL, min_order_qty = 1, order_step = 1 WHERE id = 'TO';

-- ---------- Ordering ----------
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-TRADE01","user_id":0,"items":[{"product_id":"TC","quantity":10}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids)))$q$);
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-TRADE02","items":[{"product_id":"TC","quantity":25}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids)))$q$);
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-TRADE03","items":[{"product_id":"TC","quantity":10000}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids)))$q$);
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-TRADE04","items":[{"product_id":"TO","quantity":100}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids)))$q$);
-- Business details: a TPIN needs a name and 10 digits
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-TRADE05","business_tpin":"1234567890","items":[{"product_id":"TF","quantity":1}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids)))$q$);
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-TRADE06","business_name":"Mwila Farms","business_tpin":"12345","items":[{"product_id":"TF","quantity":1}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids)))$q$);

-- 120 bags at the 100+ bulk price, plus 150 bags of fertiliser (trade, no minimum)
CREATE TEMP TABLE placed AS SELECT pg_temp.place(('{"ref":"ZS-TRADE07","business_name":" Mwila Farms ","business_tpin":"1234 567 890","business_address":"Plot 4, Chongwe",' ||
  '"items":[{"product_id":"TC","quantity":120},{"product_id":"TF","quantity":150}]}')::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids))) AS r;
SELECT pg_temp.assert_true((SELECT (r ->> 'subtotal')::numeric = 120 * 190 + 150 * 900 FROM placed), 'trade quantities priced with the bulk price');
SELECT pg_temp.assert_true((SELECT business_name = 'Mwila Farms' AND business_tpin = '1234567890' AND business_address = 'Plot 4, Chongwe' AND heavy_delivery
  FROM orders WHERE ref = 'ZS-TRADE07'), 'business details and the truck flag are on the order');
SELECT pg_temp.assert_true((SELECT price_source = 'bulk' FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.ref = 'ZS-TRADE07' AND i.product_id = 'TC'), 'bulk price recorded');
SELECT pg_temp.assert_true((SELECT stock_qty = 4880 FROM products WHERE id = 'TC'), 'trade stock taken');
-- 1,000 bags reach the next price; an ordinary order is not flagged for a truck
SELECT pg_temp.assert_true((SELECT (pg_temp.place('{"ref":"ZS-TRADE08","items":[{"product_id":"TC","quantity":1000}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids))) ->> 'subtotal')::numeric = 180000), '1000+ price');
SELECT pg_temp.place('{"ref":"ZS-TRADE09","items":[{"product_id":"TO","quantity":99}]}'::jsonb || jsonb_build_object('user_id', (SELECT buyer FROM ids)));
SELECT pg_temp.assert_true((SELECT NOT heavy_delivery AND business_name IS NULL FROM orders WHERE ref = 'ZS-TRADE09'), 'ordinary order unflagged');

-- Carts hold trade quantities
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000071b1');
INSERT INTO cart_items (user_id, line_key, product_id, quantity) VALUES ((SELECT buyer FROM ids), 'TC', 'TC', 2000);
SELECT pg_temp.expect_rejection($q$INSERT INTO cart_items (user_id, line_key, product_id, quantity) VALUES ((SELECT buyer FROM ids), 'TC2', 'TC', 10000)$q$);

-- ---------- Business details on the account ----------
SELECT public.set_business_details('Mwila Farms', '1234567890', 'Plot 4, Chongwe');
SELECT pg_temp.assert_true((SELECT business_name = 'Mwila Farms' AND business_tpin = '1234567890' FROM users WHERE id = (SELECT buyer FROM ids)), 'buyer saves business details');
SELECT pg_temp.expect_rejection($q$SELECT public.set_business_details(NULL, '1234567890', NULL)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.set_business_details('Mwila Farms', '12-34', NULL)$q$);
SELECT pg_temp.expect_rejection($q$UPDATE users SET business_tpin = '0000000000' WHERE id = (SELECT buyer FROM ids)$q$);
SELECT public.set_business_details(NULL);
SELECT pg_temp.assert_true((SELECT business_name IS NULL AND business_tpin IS NULL AND business_address IS NULL FROM users WHERE id = (SELECT buyer FROM ids)), 'buyer clears business details');
SELECT pg_temp.admin();
SET LOCAL role anon;
SELECT pg_temp.expect_rejection($q$SELECT public.set_business_details('Anon Ltd')$q$);
RESET role;

ROLLBACK;
