-- Run after db/tests/supabase_stub.sql and migrations 001–015 on an isolated test database.
-- Leaves no fixtures. Covers 015: bulk prices, pickup points, pay on delivery limits, lay-by,
-- payments and payouts held until delivery, notifications, alerts, saved searches, review
-- photos, questions and answers, seller trust and performance, bought together, staff actions.
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
CREATE FUNCTION pg_temp.place(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT app.place_order(p) $$;

-- ---------- Fixtures ----------
INSERT INTO provinces VALUES ('lusaka', 'Lusaka') ON CONFLICT DO NOTHING;
INSERT INTO departments (id, name) VALUES ('mt', 'Marketplace test');
INSERT INTO sellers (id, name) VALUES ('ms', 'Market seller');
INSERT INTO auth.users (id, phone, email, email_confirmed_at, phone_confirmed_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '260971110001', 'mbuyer@example.com', now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', NULL, 'mseller@example.com', now(), NULL),
  ('00000000-0000-0000-0000-0000000000d3', NULL, 'mstaff@example.com', now(), NULL);
CREATE TEMP TABLE ids AS SELECT
  (SELECT id FROM users WHERE email = 'mbuyer@example.com') AS buyer,
  (SELECT id FROM users WHERE email = 'mseller@example.com') AS seller,
  (SELECT id FROM users WHERE email = 'mstaff@example.com') AS staff;
GRANT SELECT ON ids TO anon, authenticated;
INSERT INTO seller_members (seller_id, user_id) SELECT 'ms', seller FROM ids;
UPDATE users SET is_staff = true WHERE id = (SELECT staff FROM ids);
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status, stock_qty) VALUES
  ('MA', 'Bale of shirts', 'mt', 'ms', 100, 'active', 50),
  ('MB', 'Hangers, pack of 10', 'mt', 'ms', 40, 'active', 0),
  ('MC', 'Shoe rack', 'mt', 'ms', 3000, 'active', 5);
INSERT INTO pickup_points (id, name, partner, town, province_id, address, hours) VALUES
  ('lsk-cairo', 'Cairo Road pickup', 'Partner shop', 'Lusaka', 'lusaka', 'Shop 4, Cairo Road', 'Mon–Sat 08:00–17:00');

-- ---------- Bulk prices ----------
INSERT INTO price_tiers VALUES ('MA', 5, 90), ('MA', 10, 80);
SELECT pg_temp.expect_rejection($q$INSERT INTO price_tiers VALUES ('MA', 20, 85)$q$);    -- more must cost less
SELECT pg_temp.expect_rejection($q$INSERT INTO price_tiers VALUES ('MA', 3, 120)$q$);    -- below the normal price
SELECT pg_temp.place(format('{"ref":"ZS-BULK01","user_id":%s,"items":[{"product_id":"MA","quantity":10}]}', (SELECT buyer FROM ids))::jsonb);
SELECT pg_temp.assert_true((SELECT unit_price_zmw = 80 AND price_source = 'bulk' FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.ref = 'ZS-BULK01'), 'bulk price for 10');
SELECT pg_temp.place(format('{"ref":"ZS-BULK02","user_id":%s,"items":[{"product_id":"MA","quantity":4}]}', (SELECT buyer FROM ids))::jsonb);
SELECT pg_temp.assert_true((SELECT unit_price_zmw = 100 AND price_source = 'fixed' FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.ref = 'ZS-BULK02'), 'normal price below the first tier');

-- ---------- Pickup points ----------
SELECT pg_temp.place('{"ref":"ZS-PICK01","contact_name":"Guest","recipient_phone":"+260970000001","pickup_point_id":"lsk-cairo","items":[{"product_id":"MA"}]}');
SELECT pg_temp.assert_true((SELECT fulfilment = 'pickup' AND collection_point = 'Cairo Road pickup: Shop 4, Cairo Road' FROM orders WHERE ref = 'ZS-PICK01'), 'pickup point recorded');
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-PICK02","contact_name":"G","recipient_phone":"+260970000001","pickup_point_id":"nowhere","items":[{"product_id":"MA"}]}')$q$);

-- ---------- Pay on delivery ----------
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-COD001","contact_name":"G","recipient_phone":"+260970000001","payment_method":"cod","items":[{"product_id":"MA"}]}')$q$);
SELECT pg_temp.expect_rejection(format($q$SELECT pg_temp.place('{"ref":"ZS-COD002","user_id":%s,"payment_method":"cod","items":[{"product_id":"MA"}]}')$q$, (SELECT buyer FROM ids)));

-- ---------- Payments, buyer protection and payouts ----------
-- A part payment, the rest, then the same webhook again
SELECT app.record_payment('testpay', 'TX-1', 'ZS-BULK01', 400, 'paid', 'mtn');
SELECT pg_temp.assert_true((SELECT payment_status = 'part' AND status = 'placed' FROM orders WHERE ref = 'ZS-BULK01'), 'part payment');
SELECT app.record_payment('testpay', 'TX-2', 'ZS-BULK01', 400, 'paid', 'mtn');
SELECT app.record_payment('testpay', 'TX-2', 'ZS-BULK01', 400, 'paid', 'mtn');
SELECT app.record_payment('testpay', 'TX-2', 'ZS-BULK01', 400, 'pending', 'mtn');
SELECT pg_temp.assert_true((SELECT paid_zmw = 800 AND payment_status = 'paid' AND status = 'confirmed' FROM orders WHERE ref = 'ZS-BULK01'), 'paid once, confirmed, a late "pending" changes nothing');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.ref = 'ZS-BULK01'), 'two payments recorded');
SELECT pg_temp.assert_true((SELECT amount_zmw = 800 AND sp.status = 'held' AND sp.release_after IS NULL FROM seller_payouts sp JOIN orders o ON o.id = sp.order_id WHERE o.ref = 'ZS-BULK01'), 'seller''s share held');
SELECT pg_temp.assert_true((SELECT count(*) >= 3 FROM notifications n JOIN orders o ON o.id = n.order_id WHERE o.ref = 'ZS-BULK01'
  AND n.template IN ('order_placed', 'order_confirmed', 'payment_received') AND n.to_address = '+260971110001'), 'order updates queued for WhatsApp');
-- Only the buyer sees the payments; only the store sees its payout
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000d1');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM payments), 'buyer sees their payments');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM seller_payouts), 'buyer can''t see payouts');
SELECT pg_temp.expect_rejection($q$SELECT app.record_payment('testpay', 'TX-9', 'ZS-BULK01', 1, 'paid')$q$);
-- The buyer confirms delivery; the payout waits out the hold, and an open complaint keeps it held
SELECT confirm_delivery('ZS-BULK01');
SELECT pg_temp.expect_rejection($q$SELECT confirm_delivery('ZS-PICK01')$q$);
INSERT INTO complaints (ref, user_id, contact_name, order_id, seller_id, type, wanted, details)
  SELECT 'ZC-MKT001', buyer, 'Buyer', (SELECT id FROM orders WHERE ref = 'ZS-BULK01'), 'ms', 'damaged', 'refund', 'Two shirts were torn.' FROM ids;
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT status = 'delivered' FROM orders WHERE ref = 'ZS-BULK01'), 'buyer confirmed delivery');
UPDATE seller_payouts SET release_after = now() - interval '1 minute' WHERE order_id = (SELECT id FROM orders WHERE ref = 'ZS-BULK01');
SELECT pg_temp.assert_true(app.release_due_payouts() = 0, 'open complaint keeps the payout held');
UPDATE complaints SET status = 'resolved', resolved_at = now() WHERE ref = 'ZC-MKT001';
SELECT pg_temp.assert_true(app.release_due_payouts() = 1, 'payout due once the complaint is resolved');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000d2');
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(seller_payouts.status = 'due') FROM seller_payouts), 'store sees its payout');
SELECT pg_temp.admin();
-- Pay on delivery now opens for this buyer, up to the limit
SELECT pg_temp.place(format('{"ref":"ZS-COD003","user_id":%s,"payment_method":"cod","items":[{"product_id":"MA"}]}', (SELECT buyer FROM ids))::jsonb);
SELECT pg_temp.expect_rejection(format($q$SELECT pg_temp.place('{"ref":"ZS-COD004","user_id":%s,"payment_method":"cod","items":[{"product_id":"MC"}]}')$q$, (SELECT buyer FROM ids)));
-- Cancelling a paid order cancels its payout
SELECT app.record_payment('testpay', 'TX-3', 'ZS-BULK02', 400, 'paid');
UPDATE orders SET status = 'cancelled' WHERE ref = 'ZS-BULK02';
SELECT pg_temp.assert_true((SELECT sp.status = 'cancelled' FROM seller_payouts sp JOIN orders o ON o.id = sp.order_id WHERE o.ref = 'ZS-BULK02'), 'cancelled order, cancelled payout');

-- ---------- Lay-by ----------
SELECT pg_temp.expect_rejection(format($q$SELECT pg_temp.place('{"ref":"ZS-LAY001","user_id":%s,"payment_plan":"layby","items":[{"product_id":"MC"}]}')$q$, (SELECT buyer FROM ids)));
UPDATE shop_settings SET layby_enabled = true;
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.place('{"ref":"ZS-LAY002","contact_name":"G","recipient_phone":"+260970000001","payment_plan":"layby","items":[{"product_id":"MC"}]}')$q$);
SELECT pg_temp.place(format('{"ref":"ZS-LAY003","user_id":%s,"payment_plan":"layby","items":[{"product_id":"MC"}]}', (SELECT buyer FROM ids))::jsonb);
SELECT pg_temp.assert_true((SELECT deposit_zmw = 600 AND layby_due = (now() AT TIME ZONE 'Africa/Lusaka')::date + 56 FROM orders WHERE ref = 'ZS-LAY003'), 'lay-by deposit and date');
SELECT pg_temp.assert_true((SELECT stock_qty = 4 FROM products WHERE id = 'MC'), 'lay-by reserves the stock');
UPDATE orders SET layby_due = current_date - 30 WHERE ref = 'ZS-LAY003';
SELECT pg_temp.assert_true(app.expire_laybys() = 1, 'unpaid lay-by expires');
SELECT pg_temp.assert_true((SELECT stock_qty = 5 FROM products WHERE id = 'MC'), 'expired lay-by returns the stock');
UPDATE shop_settings SET layby_enabled = false;

-- ---------- Alerts and saved searches ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000d1');
INSERT INTO product_alerts (user_id, product_id, kind) SELECT buyer, 'MB', 'back_in_stock' FROM ids;
INSERT INTO product_alerts (user_id, product_id, kind, target_zmw) SELECT buyer, 'MA', 'price_drop', 95 FROM ids;
SELECT pg_temp.expect_rejection($q$INSERT INTO product_alerts (user_id, product_id, kind) SELECT seller, 'MB', 'back_in_stock' FROM ids$q$);
INSERT INTO saved_searches (user_id, query, department_id) SELECT buyer, 'denim jacket', 'mt' FROM ids;
SELECT pg_temp.expect_rejection($q$INSERT INTO saved_searches (user_id, query) SELECT seller, 'not mine' FROM ids$q$);
SELECT pg_temp.admin();
UPDATE products SET stock_qty = 12 WHERE id = 'MB';
UPDATE products SET price_zmw = 98 WHERE id = 'MA';
SELECT pg_temp.assert_true((SELECT notified_at IS NULL FROM product_alerts WHERE product_id = 'MA'), 'price above the target: no alert yet');
UPDATE price_tiers SET price_zmw = 85 WHERE product_id = 'MA' AND min_qty = 5;
UPDATE price_tiers SET price_zmw = 75 WHERE product_id = 'MA' AND min_qty = 10;
UPDATE products SET price_zmw = 90 WHERE id = 'MA';
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM notifications WHERE template IN ('back_in_stock', 'price_drop') AND user_id = (SELECT buyer FROM ids)), 'stock and price alerts queued');
SELECT pg_temp.assert_true((SELECT bool_and(notified_at IS NOT NULL) FROM product_alerts), 'each alert fires once');

-- ---------- Review photos, questions and answers ----------
INSERT INTO reviews (product_id, user_id, order_item_id, rating, review_title, review_body)
  SELECT 'MA', buyer, (SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.ref = 'ZS-BULK01'), 5, 'Good bale', 'Mostly good shirts.' FROM ids;
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000d1');
INSERT INTO review_photos (review_id, src, position) SELECT id, 'https://example.com/r1.webp', 0 FROM reviews WHERE product_id = 'MA';
INSERT INTO product_questions (product_id, user_id, question) SELECT 'MA', buyer, 'How many shirts are in a bale?' FROM ids;
UPDATE product_questions SET answer = 'Answering myself' WHERE product_id = 'MA';   -- row-level security skips it
SELECT pg_temp.assert_true((SELECT answer IS NULL FROM product_questions WHERE product_id = 'MA'), 'buyers can''t answer questions');
SELECT pg_temp.admin();
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000d2');
SELECT pg_temp.expect_rejection($q$INSERT INTO review_photos (review_id, src, position) SELECT id, 'https://example.com/fake.webp', 1 FROM reviews WHERE product_id = 'MA'$q$);
UPDATE product_questions SET answer = 'About 60, mixed sizes.' WHERE product_id = 'MA';
SELECT pg_temp.admin();
SELECT pg_temp.signed_out();
SELECT pg_temp.assert_true((SELECT answer = 'About 60, mixed sizes.' AND answered_at IS NOT NULL FROM product_questions WHERE product_id = 'MA'), 'visitors see the answered question');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM review_photos), 'visitors see review photos');
SELECT pg_temp.expect_rejection($q$INSERT INTO product_questions (product_id, question) VALUES ('MA', 'Signed out question here')$q$);

-- ---------- Seller trust, performance, bought together ----------
SELECT pg_temp.assert_true((SELECT (t ->> 'orders_delivered')::int = 1 AND (t ->> 'rating')::numeric = 5 FROM seller_trust('ms') t), 'public trust figures');
SELECT pg_temp.expect_rejection($q$SELECT seller_performance('ms')$q$);
SELECT pg_temp.expect_rejection($q$SELECT seller_sales('ms')$q$);
SELECT pg_temp.admin();
SELECT pg_temp.place(format('{"ref":"ZS-TOG001","user_id":%s,"items":[{"product_id":"MA"},{"product_id":"MB"}]}', (SELECT buyer FROM ids))::jsonb);
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM bought_together('MA')), 'one shared order isn''t enough');
SELECT pg_temp.place('{"ref":"ZS-TOG002","contact_name":"G","recipient_phone":"+260970000002","items":[{"product_id":"MA"},{"product_id":"MB"}]}');
SELECT pg_temp.assert_true((SELECT array_agg(product_id) = ARRAY['MB'] FROM bought_together('MA')), 'bought together after two orders');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000d2');
SELECT pg_temp.assert_true((SELECT (p ->> 'level') IS NOT NULL AND (p ->> 'orders_90d')::int >= 5 FROM seller_performance('ms') p), 'store sees its performance');
SELECT pg_temp.assert_true((SELECT (s ->> 'payouts_due')::numeric = 800 FROM seller_sales('ms') s), 'store sees its sales and payouts');
SELECT pg_temp.expect_rejection($q$SELECT staff_verify_seller('ms', true)$q$);
SELECT pg_temp.admin();

-- ---------- Staff back office ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000d3');
SELECT staff_verify_seller('ms', true);
SELECT staff_moderate_listing('MC', 'paused', 'Photo unclear');
SELECT staff_order_step((SELECT id FROM orders WHERE ref = 'ZS-TOG001'), 'dispatched');
SELECT staff_hide_content('question', (SELECT id FROM product_questions WHERE product_id = 'MA'));
SELECT pg_temp.expect_rejection($q$SELECT staff_order_step((SELECT id FROM orders WHERE ref = 'ZS-TOG001'), 'teleported')$q$);
SELECT pg_temp.assert_true((SELECT count(*) = 4 FROM staff_actions), 'every staff action is logged');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT verified FROM sellers WHERE id = 'ms') AND (SELECT status = 'paused' FROM products WHERE id = 'MC')
  AND (SELECT status = 'dispatched' AND dispatched_at IS NOT NULL FROM orders WHERE ref = 'ZS-TOG001'), 'staff decisions applied');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM notifications WHERE template = 'order_dispatched'), 'dispatch message queued');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000d1');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM staff_actions), 'buyers can''t read the staff log');
SELECT pg_temp.admin();

ROLLBACK;
