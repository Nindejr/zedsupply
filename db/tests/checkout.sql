-- Run after db/tests/supabase_stub.sql and migrations 001–014 on an isolated test database.
-- Leaves no fixtures. Covers 014: server-side order placement (prices, promotions, deals, offers,
-- add-ons, vouchers, VAT, stock, repeated references), guest orders, cancellations giving stock
-- back, carts kept per account, posting limits and typo-tolerant search.
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
CREATE FUNCTION pg_temp.signed_out() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true); PERFORM set_config('role', 'anon', true); END $$;
CREATE FUNCTION pg_temp.admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'none', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', pg_my_temp_schema()::regnamespace); END $$;
-- Place an order and return the result, as the server function will
CREATE FUNCTION pg_temp.place(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT app.place_order(p) $$;

-- ---------- Fixtures ----------
INSERT INTO provinces VALUES ('lusaka', 'Lusaka'), ('copperbelt', 'Copperbelt') ON CONFLICT DO NOTHING;
INSERT INTO departments (id, name) VALUES ('ct', 'Checkout test');
INSERT INTO sellers (id, name) VALUES ('cs', 'Checkout seller');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-00000000c0b1', 'cbuyer1@example.com', now()),
  ('00000000-0000-0000-0000-00000000c0b2', 'cbuyer2@example.com', now());
CREATE TEMP TABLE ids AS SELECT
  (SELECT id FROM users WHERE email = 'cbuyer1@example.com') AS b1,
  (SELECT id FROM users WHERE email = 'cbuyer2@example.com') AS b2;
GRANT SELECT ON ids TO authenticated;
INSERT INTO products (id, title, tags, department_id, seller_id, price_zmw, status, stock_qty) VALUES
  ('CA', 'Solar panel kit 100W', 'solar power panel', 'ct', 'cs', 100, 'active', 2),
  ('CV', 'Running shoes', 'sneakers trainers', 'ct', 'cs', 150, 'active', NULL),
  ('CR', 'Sourced lamp', 'light', 'ct', 'cs', 80, 'active', NULL),
  ('CP', 'Paused radio', 'radio', 'ct', 'cs', 60, 'paused', 5);
INSERT INTO product_options (id, product_id, kind, name) VALUES (8810, 'CV', 'size', 'Size');
INSERT INTO product_option_values (id, option_id, product_id, option_kind, label) VALUES (8820, 8810, 'CV', 'size', '42');
INSERT INTO product_variants (id, product_id, sku, combo_key, stock_qty, price_zmw) VALUES (8830, 'CV', 'CV-42', '8820', 1, 160);
INSERT INTO variant_option_values VALUES (8830, 8810, 8820, 'CV');
INSERT INTO product_components (id, product_id, name, kind, addon_price_zmw) VALUES (8840, 'CA', 'Mounting kit', 'addon', 25), (8841, 'CA', 'Cable', 'included', NULL);
INSERT INTO promotions (id, seller_id, title, discount, starts, ends) VALUES (8850, 'cs', 'Ten off', 10, current_date - 1, current_date + 1);
INSERT INTO promotion_products VALUES (8850, 'CA');
INSERT INTO promotions (id, seller_id, title, discount, starts, ends) VALUES (8851, 'cs', 'Copperbelt only', 50, current_date - 1, current_date + 1);
INSERT INTO promotion_products VALUES (8851, 'CR');
INSERT INTO promotion_areas VALUES (8851, 'copperbelt');
INSERT INTO deals (product_id, price_zmw, reason) VALUES ('CR', 70, 'reduced');
INSERT INTO vouchers (code, percent, min_spend_zmw) VALUES ('SAVE10', 10, 100);

-- ---------- Placing orders ----------
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-GUEST1","items":[{"product_id":"CA","quantity":1}]}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"bad ref","contact_name":"G","recipient_phone":"+260970000001","items":[{"product_id":"CA"}]}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-EMPTY1","contact_name":"G","recipient_phone":"+260970000001","items":[]}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-PAUSE1","contact_name":"G","recipient_phone":"+260970000001","items":[{"product_id":"CP"}]}')$q$);
-- A guest buys both panels at the 10% promotion, with one mounting kit each
CREATE TEMP TABLE r1 AS SELECT pg_temp.place('{"ref":"ZS-GUEST1","contact_name":"Guest","recipient_phone":"+260970000001","buyer_province_id":"lusaka","items":[{"product_id":"CA","quantity":2,"addons":[8840]}]}') AS r;
SELECT pg_temp.assert_true((SELECT (r ->> 'subtotal')::numeric = 230 AND (r ->> 'vat')::numeric = 31.72 AND (r ->> 'total')::numeric = 230 AND NOT (r ->> 'replayed')::boolean FROM r1), 'server prices: promotion, add-ons and VAT included');
SELECT pg_temp.assert_true((SELECT unit_price_zmw = 90 AND price_source = 'promotion' AND stock_taken FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.ref = 'ZS-GUEST1'), 'line stored at the promotion price');
SELECT pg_temp.assert_true((SELECT stock_qty = 0 FROM products WHERE id = 'CA'), 'stock taken');
-- The same reference again returns the first order and takes nothing more
SELECT pg_temp.assert_true((SELECT (pg_temp.place('{"ref":"ZS-GUEST1","contact_name":"Guest","recipient_phone":"+260970000001","items":[{"product_id":"CA","quantity":2}]}') ->> 'replayed')::boolean), 'a repeated reference is replayed');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM orders WHERE ref = 'ZS-GUEST1'), 'still one order');
SELECT pg_temp.expect_rejection(format($q$SELECT pg_temp.place('{"ref":"ZS-GUEST1","user_id":%s,"items":[{"product_id":"CR"}]}')$q$, (SELECT b1 FROM ids)));
-- Sold out: nothing is taken and no order is left behind
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-SOLD01","contact_name":"G","recipient_phone":"+260970000002","items":[{"product_id":"CA"}]}')$q$);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM orders WHERE ref = 'ZS-SOLD01'), 'a failed order leaves nothing');
-- Variations: must be chosen, use their own price, and take their own stock
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-VAR001","contact_name":"G","recipient_phone":"+260970000003","items":[{"product_id":"CV"}]}')$q$);
SELECT pg_temp.place(format('{"ref":"ZS-VAR002","user_id":%s,"items":[{"product_id":"CV","variant_id":8830}],"voucher_code":"save10"}', (SELECT b1 FROM ids))::jsonb);
SELECT pg_temp.assert_true((SELECT subtotal_zmw = 160 AND discount_zmw = 16 AND total_zmw = 144 AND voucher_code = 'SAVE10' FROM orders WHERE ref = 'ZS-VAR002'), 'variation price and voucher');
SELECT pg_temp.assert_true((SELECT stock_qty = 0 FROM product_variants WHERE id = 8830), 'variation stock taken');
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-VAR003","contact_name":"G","recipient_phone":"+260970000003","items":[{"product_id":"CV","variant_id":8830}]}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-VCH001","contact_name":"G","recipient_phone":"+260970000003","items":[{"product_id":"CR"}],"voucher_code":"NOPE"}')$q$);
-- Add-ons must be the product's own optional ones
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-ADD001","contact_name":"G","recipient_phone":"+260970000003","items":[{"product_id":"CR","addons":[8840]}]}')$q$);
-- Deals beat promotions when lower; area promotions apply only in their provinces
SELECT pg_temp.place('{"ref":"ZS-AREA01","contact_name":"G","recipient_phone":"+260970000004","buyer_province_id":"lusaka","items":[{"product_id":"CR"}]}');
SELECT pg_temp.place('{"ref":"ZS-AREA02","contact_name":"G","recipient_phone":"+260970000004","buyer_province_id":"copperbelt","items":[{"product_id":"CR"}]}');
SELECT pg_temp.assert_true((SELECT unit_price_zmw = 70 AND price_source = 'deal' FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.ref = 'ZS-AREA01'), 'deal outside the promotion''s province');
SELECT pg_temp.assert_true((SELECT unit_price_zmw = 40 AND price_source = 'promotion' FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.ref = 'ZS-AREA02'), 'province promotion inside it');
SELECT pg_temp.assert_true((SELECT stock_taken = false FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.ref = 'ZS-AREA01'), 'uncounted stock isn''t taken');
-- Accepted offers: only the buyer's own
UPDATE products SET pricing_mode = 'commit', commit_min_zmw = 60, commit_max_zmw = 80 WHERE id = 'CR';
INSERT INTO price_commitments (id, product_id, buyer_id, amount_zmw) VALUES (8860, 'CR', (SELECT b2 FROM ids), 65);
UPDATE price_commitments SET status = 'accepted' WHERE id = 8860;
SELECT pg_temp.expect_rejection(format($q$SELECT pg_temp.place('{"ref":"ZS-OFF001","user_id":%s,"items":[{"product_id":"CR","commitment_id":8860}]}')$q$, (SELECT b1 FROM ids)));
SELECT pg_temp.place(format('{"ref":"ZS-OFF002","user_id":%s,"items":[{"product_id":"CR","commitment_id":8860}]}', (SELECT b2 FROM ids))::jsonb);
SELECT pg_temp.assert_true((SELECT unit_price_zmw = 65 AND price_source = 'commit' FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.ref = 'ZS-OFF002'), 'accepted offer price');
-- Cancelling gives the stock back, once
INSERT INTO order_cancellations (order_id, reason) SELECT id, 'Changed my mind' FROM orders WHERE ref = 'ZS-GUEST1';
UPDATE order_cancellations SET status = 'approved', decided_at = now() WHERE order_id = (SELECT id FROM orders WHERE ref = 'ZS-GUEST1');
SELECT pg_temp.assert_true((SELECT stock_qty = 2 FROM products WHERE id = 'CA'), 'cancellation returns stock');
UPDATE orders SET status = 'cancelled' WHERE ref = 'ZS-GUEST1';
SELECT pg_temp.assert_true((SELECT stock_qty = 2 FROM products WHERE id = 'CA'), 'stock is returned only once');
-- Only server functions may place orders
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0b1');
SELECT pg_temp.expect_rejection($q$SELECT app.place_order('{"ref":"ZS-HACK01","user_id":1,"items":[{"product_id":"CR"}]}')$q$);
SELECT pg_temp.admin();
SELECT pg_temp.signed_out();
SELECT pg_temp.expect_rejection($q$SELECT app.place_order('{"ref":"ZS-HACK02","contact_name":"G","recipient_phone":"+1","items":[{"product_id":"CR"}]}')$q$);
SELECT pg_temp.admin();

-- Review regressions: guest references are bound to their contact, and inactive
-- variations must not turn into an uncounted base-product purchase.
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-GUEST1","contact_name":"Other guest","recipient_phone":"+260970009999","items":[{"product_id":"CA"}]}')$q$);
UPDATE product_variants SET active = false WHERE id = 8830;
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-INACT1","contact_name":"G","recipient_phone":"+260970000003","items":[{"product_id":"CV"}]}')$q$);
INSERT INTO user_addresses (user_id, label, recipient, phone, town, instructions)
SELECT b1, 'Home', 'Buyer', '+260970000001', 'Lusaka', 'Test address' FROM ids;
SELECT pg_temp.expect_rejection(format($q$SELECT pg_temp.place('{"ref":"ZS-ADDR01","contact_name":"G","recipient_phone":"+260970000003","address_id":%s,"items":[{"product_id":"CR"}]}')$q$, (SELECT id FROM user_addresses WHERE user_id = (SELECT b1 FROM ids))));
UPDATE sellers SET vat_registered = false WHERE id = 'cs';
SELECT pg_temp.place('{"ref":"ZS-NOVAT1","contact_name":"G","recipient_phone":"+260970000003","items":[{"product_id":"CR"}]}');
SELECT pg_temp.assert_true((SELECT vat_zmw = 0 AND total_zmw = subtotal_zmw FROM orders WHERE ref = 'ZS-NOVAT1'), 'unregistered seller is excluded from VAT');
UPDATE shop_settings SET vat_included = false;
SELECT pg_temp.place('{"ref":"ZS-NOVAT2","contact_name":"G","recipient_phone":"+260970000003","items":[{"product_id":"CR"}]}');
SELECT pg_temp.assert_true((SELECT vat_zmw = 0 AND total_zmw = subtotal_zmw FROM orders WHERE ref = 'ZS-NOVAT2'), 'exclusive VAT also excludes unregistered sellers');
UPDATE shop_settings SET vat_included = true;
UPDATE sellers SET vat_registered = true WHERE id = 'cs';

-- ---------- Carts ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0b1');
INSERT INTO cart_items (user_id, line_key, product_id, quantity) VALUES ((SELECT b1 FROM ids), 'CA', 'CA', 2);
SELECT pg_temp.expect_rejection($q$INSERT INTO cart_items (user_id, line_key, product_id, quantity) VALUES ((SELECT b2 FROM ids), 'CA', 'CA', 1)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO cart_items (user_id, line_key, product_id, quantity) VALUES ((SELECT b1 FROM ids), 'CR', 'CR', 500)$q$);
INSERT INTO cart_items (user_id, line_key, product_id, quantity) SELECT (SELECT b1 FROM ids), 'L' || g, 'CR', 1 FROM generate_series(1, 99) g;
SELECT pg_temp.expect_rejection($q$INSERT INTO cart_items (user_id, line_key, product_id, quantity) VALUES ((SELECT b1 FROM ids), 'L100', 'CR', 1)$q$);
SELECT pg_temp.admin();
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0b2');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM cart_items), 'carts are private');
-- ---------- Posting limits ----------
INSERT INTO complaints (ref, user_id, contact_name, type, wanted, details)
  SELECT 'ZC-CLIM' || g, (SELECT b2 FROM ids), 'Buyer', 'other', 'inform', 'Limit test number ' || g FROM generate_series(1, 5) g;
SELECT pg_temp.expect_rejection($q$INSERT INTO complaints (ref, user_id, contact_name, type, wanted, details) VALUES ('ZC-CLIM6', (SELECT b2 FROM ids), 'Buyer', 'other', 'inform', 'One too many complaints')$q$);
SELECT pg_temp.admin();
-- Staff and server functions aren't limited
INSERT INTO complaints (ref, user_id, contact_name, type, wanted, details) VALUES ('ZC-CLIM7', (SELECT b2 FROM ids), 'Buyer', 'other', 'inform', 'Logged by staff for the buyer');

-- ---------- Search ----------
SELECT pg_temp.signed_out();
SELECT pg_temp.assert_true((SELECT array_agg(id) = ARRAY['CA'] FROM search_products('solr panel', 'ct')), 'a misspelling finds the product');
SELECT pg_temp.assert_true((SELECT array_agg(id) = ARRAY['CV'] FROM search_products('trainers', 'ct')), 'tags are searched');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM search_products('radio', 'ct')), 'paused listings aren''t found');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM search_products('x', 'ct')), 'one letter finds nothing');
SELECT pg_temp.admin();

ROLLBACK;
