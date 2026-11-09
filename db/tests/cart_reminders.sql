-- Run after db/tests/supabase_stub.sql and all migrations on an isolated test database.
-- Leaves no fixtures. Covers 033: cart reminders are opt-in, the cart is kept only while they're
-- on, and the daily job sends one reminder per cart, at most once a week, never after an order.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejection(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN raise_exception OR insufficient_privilege OR invalid_text_representation OR check_violation THEN rejected := true;
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
-- Moves a buyer's saved cart back in time, as if it had sat unchanged
CREATE FUNCTION pg_temp.age_cart(p_email text, p_age interval) RETURNS void LANGUAGE sql AS $$
  UPDATE cart_reminders SET cart_updated_at = now() - p_age WHERE user_id = (SELECT id FROM users WHERE email = p_email)
$$;
CREATE FUNCTION pg_temp.reminders(p_email text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM notifications WHERE template = 'cart_reminder' AND user_id = (SELECT id FROM users WHERE email = p_email)
$$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-00000000c0a1', 'mail@cart.test', now()),
  ('00000000-0000-0000-0000-00000000c0a2', 'wa@cart.test', now()),
  ('00000000-0000-0000-0000-00000000c0a3', 'off@cart.test', now());
UPDATE users SET name = 'Chipo', phone = '+260970000301' WHERE email = 'wa@cart.test';
UPDATE users SET name = 'Mutale' WHERE email = 'mail@cart.test';
INSERT INTO sellers (id, name) VALUES ('cart-store', 'Cart store');
INSERT INTO departments (id, name) VALUES ('cartdept', 'Cart test');
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status, stock_qty) VALUES
  ('CRA', 'Solar lantern', 'cartdept', 'cart-store', 250, 'active', 5),
  ('CRB', 'Phone charger', 'cartdept', 'cart-store', 80, 'active', 5),
  ('CRC', 'Sold-out kettle', 'cartdept', 'cart-store', 300, 'active', 0);

-- Signed out: nothing
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_rejection($q$SELECT public.save_cart('[]')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.set_cart_reminders(true, 'email')$q$);
RESET ROLE;

-- Off by default: the cart isn't kept
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a3');
SELECT pg_temp.assert_true((SELECT r ->> 'on' = 'false' AND r ->> 'can_whatsapp' = 'false' AND r ->> 'can_email' = 'true' FROM public.cart_reminder_settings() r), 'off by default');
SELECT pg_temp.assert_true((SELECT r ->> 'saved' = 'false' FROM public.save_cart('[{"product_id":"CRA","quantity":1}]') r), 'nothing kept while off');
SELECT pg_temp.expect_rejection($q$SELECT public.set_cart_reminders(true, 'whatsapp')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.set_cart_reminders(true, 'sms')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.set_cart_reminders(true)$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM cart_reminders r JOIN users u ON u.id = r.user_id WHERE u.email = 'off@cart.test'), 'no row while off');
SELECT pg_temp.expect_rejection($q$SET LOCAL ROLE authenticated; SELECT * FROM cart_reminders$q$);
RESET ROLE;

-- On, by email: the cart is kept, cleaned and capped
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a1');
SELECT public.set_cart_reminders(true, 'email');
SELECT pg_temp.assert_true((SELECT r ->> 'on' = 'true' AND r ->> 'channel' = 'email' FROM public.cart_reminder_settings() r), 'switched on');
SELECT pg_temp.assert_true((SELECT (r ->> 'lines')::int = 2 FROM public.save_cart('[{"product_id":"CRA","quantity":2},{"product_id":"NOPE"},{"product_id":"CRB","quantity":5000,"sku":"BLK"},"junk"]') r), 'unknown lines dropped');
SELECT pg_temp.expect_rejection($q$SELECT public.save_cart('{"product_id":"CRA"}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.save_cart((SELECT jsonb_agg(jsonb_build_object('product_id', 'CRA')) FROM generate_series(1, 51)))$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT items -> 1 ->> 'quantity' = '999' AND items -> 1 ->> 'sku' = 'BLK' FROM cart_reminders r JOIN users u ON u.id = r.user_id WHERE u.email = 'mail@cart.test'), 'quantities capped');

-- On, by WhatsApp
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a2');
SELECT public.set_cart_reminders(true, 'whatsapp');
SELECT public.save_cart('[{"product_id":"CRC"},{"product_id":"CRB"}]');
SELECT pg_temp.admin();

-- Too soon: nothing yet
SELECT pg_temp.assert_true(app.queue_cart_reminders() = 0, 'nothing within a day');
-- A day later: one each, to the chosen channel, naming something that can still be bought
SELECT pg_temp.age_cart('mail@cart.test', interval '25 hours');
SELECT pg_temp.age_cart('wa@cart.test', interval '25 hours');
SELECT pg_temp.assert_true(app.queue_cart_reminders() = 2, 'two reminders queued');
SELECT pg_temp.assert_true((SELECT channel = 'email' AND to_address = 'mail@cart.test' AND payload ->> 'name' = 'Mutale' AND payload ->> 'title' = 'Solar lantern' AND (payload ->> 'more')::int = 1
  FROM notifications WHERE template = 'cart_reminder' AND to_address = 'mail@cart.test'), 'the email reminder');
SELECT pg_temp.assert_true((SELECT channel = 'whatsapp' AND to_address = '+260970000301' AND payload ->> 'title' = 'Phone charger' AND (payload ->> 'more')::int = 0
  FROM notifications WHERE template = 'cart_reminder' AND to_address = '+260970000301'), 'the WhatsApp reminder skips the sold-out item');
-- Only once for the same cart
SELECT pg_temp.assert_true(app.queue_cart_reminders() = 0, 'once per cart');

-- A changed cart, a day old, still waits for the weekly limit
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a1');
SELECT public.save_cart('[{"product_id":"CRB"}]');
SELECT pg_temp.admin();
SELECT pg_temp.age_cart('mail@cart.test', interval '2 days');
SELECT pg_temp.assert_true(app.queue_cart_reminders() = 0, 'at most once a week');
UPDATE cart_reminders SET last_reminded_at = now() - interval '8 days' WHERE user_id = (SELECT id FROM users WHERE email = 'mail@cart.test');
SELECT pg_temp.assert_true(app.queue_cart_reminders() = 1 AND pg_temp.reminders('mail@cart.test') = 2, 'after a week, the new cart is reminded');

-- Saving the same cart again doesn't restart it
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a1');
SELECT public.save_cart('[{"product_id":"CRB"}]');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT reminded_at IS NOT NULL FROM cart_reminders WHERE user_id = (SELECT id FROM users WHERE email = 'mail@cart.test')), 'an unchanged cart stays reminded');

-- No reminder after an order, nor for a cart more than a week old, nor when nothing can be bought
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a2');
SELECT public.save_cart('[{"product_id":"CRA"}]');
SELECT pg_temp.admin();
UPDATE cart_reminders SET last_reminded_at = NULL;
SELECT pg_temp.age_cart('wa@cart.test', interval '2 days');
SELECT app.place_order(jsonb_build_object('ref', 'ZS-CARTR01', 'user_id', (SELECT id FROM users WHERE email = 'wa@cart.test'), 'contact_name', 'Chipo',
  'recipient_phone', '+260970000301', 'fulfilment', 'collection', 'items', '[{"product_id":"CRA"}]'::jsonb));
SELECT pg_temp.assert_true(app.queue_cart_reminders() = 0 AND pg_temp.reminders('wa@cart.test') = 1, 'not after an order');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a2');
SELECT public.save_cart('[{"product_id":"CRB"}]');
SELECT pg_temp.admin();
SELECT pg_temp.age_cart('wa@cart.test', interval '8 days');
SELECT pg_temp.assert_true(app.queue_cart_reminders() = 0, 'not for an old cart');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a2');
SELECT public.save_cart('[{"product_id":"CRC"}]');
SELECT pg_temp.admin();
SELECT pg_temp.age_cart('wa@cart.test', interval '2 days');
SELECT pg_temp.assert_true(app.queue_cart_reminders() = 0 AND pg_temp.reminders('wa@cart.test') = 1, 'not when nothing can be bought');

-- Switching off deletes the saved cart
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0a2');
SELECT public.set_cart_reminders(false);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM cart_reminders WHERE user_id = (SELECT id FROM users WHERE email = 'wa@cart.test')), 'off deletes the cart');
SELECT pg_temp.expect_rejection($q$SET LOCAL ROLE authenticated; SELECT app.queue_cart_reminders()$q$);
RESET ROLE;
ROLLBACK;
