-- Run after db/tests/supabase_stub.sql and all migrations on an isolated test database.
-- Leaves no fixtures. Covers 032: voucher kinds, caps and limits when ordering, checking a code
-- in the cart, staff managing vouchers by role, and the sales report.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejection(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR unique_violation OR raise_exception
    OR insufficient_privilege OR invalid_text_representation OR datatype_mismatch OR invalid_datetime_format THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %', statement; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.signed_in(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'none', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
-- A guest collection order for one kettle at K1,000
CREATE FUNCTION pg_temp.order_with(ref text, code text, phone text, qty int DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
  SELECT app.place_order(jsonb_build_object('ref', ref, 'contact_name', 'Guest', 'recipient_phone', phone, 'fulfilment', 'collection',
    'voucher_code', code, 'items', jsonb_build_array(jsonb_build_object('product_id', 'VSA', 'quantity', qty))))
$$;

UPDATE shop_settings SET vat_registered = false, vat_registration_verified = false;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-00000000e0f1', 'catalogue@v.test', now()),
  ('00000000-0000-0000-0000-00000000e0f2', 'finance@v.test', now()),
  ('00000000-0000-0000-0000-00000000e0f3', 'support@v.test', now()),
  ('00000000-0000-0000-0000-00000000e0f4', 'buyer@v.test', now());
UPDATE users SET is_staff = true WHERE email IN ('catalogue@v.test', 'finance@v.test', 'support@v.test');
INSERT INTO staff_roles (user_id, role) SELECT id, split_part(email, '@', 1) FROM users WHERE email IN ('catalogue@v.test', 'finance@v.test', 'support@v.test');
INSERT INTO sellers (id, name) VALUES ('v-store', 'Voucher store');
INSERT INTO departments (id, name) VALUES ('vdept', 'Voucher test');
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status) VALUES
  ('VSA', 'Kettle', 'vdept', 'v-store', 1000, 'active'), ('VSB', 'Mug', 'vdept', 'v-store', 40, 'active');

-- ---------- Managing vouchers: catalogue only ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000e0f3');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"TRY10","percent":10}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_vouchers()$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000e0f2');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"TRY10","percent":10}')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000e0f1');
SELECT pg_temp.assert_true((public.staff_save_voucher('{"code":"big20","percent":20,"max_off":150,"label":"20% off, up to K150"}') ->> 'created')::boolean, 'a new voucher');
SELECT public.staff_save_voucher('{"code":"TAKE50","amount":50,"min_spend":100,"max_uses":2}');
SELECT public.staff_save_voucher('{"code":"ONCE","percent":5,"uses_per_buyer":1}');
SELECT public.staff_save_voucher('{"code":"LATER","percent":5,"starts":"2099-01-01"}');
SELECT public.staff_save_voucher('{"code":"MIN500","percent":10,"min_spend":500}');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"BOTH","percent":10,"amount":50}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"NONE"}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"CAPAMT","amount":50,"max_off":20}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"HUGE","percent":95}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"OVER","amount":200,"min_spend":100}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"BACK","percent":5,"starts":"2026-12-01","ends":"2026-11-01"}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"no-dash","percent":5}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"EXTRA","percent":5,"sales":1}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_voucher('{"code":"HALF","amount":10.5}')$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT count(*) = 5 FROM staff_actions WHERE action = 'save_voucher'), 'each voucher change is logged');

-- ---------- Checking a code in the cart ----------
SELECT pg_temp.expect_rejection($q$SELECT public.voucher_check('BIG20')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000e0f4');
SELECT pg_temp.assert_true((SELECT r ->> 'valid' = 'true' AND (r ->> 'percent')::int = 20 AND (r ->> 'max_off')::numeric = 150 AND r ->> 'label' = '20% off, up to K150'
  FROM public.voucher_check(' big20 ') r), 'a valid code shows what it does');
SELECT pg_temp.assert_true((SELECT r ->> 'valid' = 'false' AND r ->> 'reason' = 'That voucher code isn''t valid' FROM public.voucher_check('LATER') r), 'a voucher that hasn''t started');
SELECT pg_temp.assert_true((SELECT r ->> 'valid' = 'false' FROM public.voucher_check('NOPE') r), 'an unknown code');
SELECT pg_temp.admin();

-- ---------- Ordering ----------
-- A percentage with a cap: 20% of K1,000 is K200, capped at K150
SELECT pg_temp.assert_true((SELECT (r ->> 'discount')::numeric = 150 AND (r ->> 'total')::numeric = 850 FROM pg_temp.order_with('ZS-VOUCH01', 'BIG20', '+260970000101') r), 'the cap holds');
-- Under the cap the percentage stands: 20% of K40 x 2 is K16
SELECT pg_temp.assert_true((SELECT (r ->> 'discount')::numeric = 16 FROM app.place_order('{"ref":"ZS-VOUCH02","contact_name":"Guest","recipient_phone":"+260970000102","fulfilment":"collection","voucher_code":"BIG20","items":[{"product_id":"VSB","quantity":2}]}') r), 'a percentage under the cap');
-- A kwacha amount, limited to two uses
SELECT pg_temp.assert_true((SELECT (r ->> 'discount')::numeric = 50 AND (r ->> 'total')::numeric = 950 FROM pg_temp.order_with('ZS-VOUCH03', 'TAKE50', '+260970000103') r), 'a kwacha amount off');
SELECT pg_temp.order_with('ZS-VOUCH04', 'TAKE50', '+260970000104');
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.order_with('ZS-VOUCH05', 'TAKE50', '+260970000105')$q$);
-- The same reference again replays the order, not a third use
SELECT pg_temp.assert_true((SELECT (r ->> 'replayed')::boolean FROM pg_temp.order_with('ZS-VOUCH04', 'TAKE50', '+260970000104') r), 'a retry is not another use');
-- A cancelled order gives its use back
UPDATE orders SET status = 'cancelled' WHERE ref = 'ZS-VOUCH04';
SELECT pg_temp.assert_true((SELECT (r ->> 'discount')::numeric = 50 FROM pg_temp.order_with('ZS-VOUCH05', 'TAKE50', '+260970000105') r), 'a cancelled order frees its use');
-- Below the minimum spend nothing comes off, and no use is taken
SELECT pg_temp.assert_true((SELECT (r ->> 'discount')::numeric = 0 FROM app.place_order('{"ref":"ZS-VOUCH06","contact_name":"Guest","recipient_phone":"+260970000106","fulfilment":"collection","voucher_code":"MIN500","items":[{"product_id":"VSB"}]}') r), 'below the minimum spend');
SELECT pg_temp.assert_true((SELECT voucher_code IS NULL FROM orders WHERE ref = 'ZS-VOUCH06'), 'no use recorded below the minimum');
-- Once per buyer, by phone for guests and by account when signed in
SELECT pg_temp.order_with('ZS-VOUCH07', 'ONCE', '+260970000107');
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.order_with('ZS-VOUCH08', 'ONCE', '+260970000107')$q$);
SELECT pg_temp.order_with('ZS-VOUCH08', 'ONCE', '+260970000108');
SELECT app.place_order(jsonb_build_object('ref', 'ZS-VOUCH09', 'user_id', (SELECT id FROM users WHERE email = 'buyer@v.test'), 'contact_name', 'Buyer',
  'recipient_phone', '+260970000109', 'fulfilment', 'collection', 'voucher_code', 'ONCE', 'items', '[{"product_id":"VSA"}]'::jsonb));
SELECT pg_temp.expect_rejection($q$SELECT app.place_order(jsonb_build_object('ref', 'ZS-VOUCH10', 'user_id', (SELECT id FROM users WHERE email = 'buyer@v.test'),
  'contact_name', 'Buyer', 'recipient_phone', '+260970000110', 'fulfilment', 'collection', 'voucher_code', 'ONCE', 'items', '[{"product_id":"VSA"}]'::jsonb))$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000e0f4');
SELECT pg_temp.assert_true((SELECT r ->> 'valid' = 'false' AND r ->> 'reason' = 'You''ve already used that voucher' FROM public.voucher_check('ONCE') r), 'the cart says it was used');
SELECT pg_temp.admin();
-- Switched off, a voucher is refused
UPDATE vouchers SET active = false WHERE code = 'BIG20';
SELECT pg_temp.expect_rejection($q$SELECT pg_temp.order_with('ZS-VOUCH11', 'BIG20', '+260970000111')$q$);

-- ---------- What staff see ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000e0f2');
SELECT pg_temp.assert_true((SELECT (v ->> 'uses')::int = 2 AND (v ->> 'discount_given')::numeric = 100 FROM jsonb_array_elements(public.staff_vouchers()) v WHERE v ->> 'code' = 'TAKE50'), 'finance sees the uses');
SELECT pg_temp.assert_true((SELECT (v ->> 'uses')::int = 2 AND (v ->> 'discount_given')::numeric = 166 FROM jsonb_array_elements(public.staff_vouchers()) v WHERE v ->> 'code' = 'BIG20'), 'uses of a switched-off voucher');

-- ---------- Sales report ----------
SELECT pg_temp.assert_true((SELECT jsonb_array_length(r -> 'series') = 7 AND (r -> 'totals' ->> 'orders')::int >= 8 AND (r ->> 'cancelled')::int >= 1
  AND r -> 'products' -> 0 ->> 'id' = 'VSA' AND (r -> 'totals' ->> 'discounts')::numeric >= 316
  FROM public.staff_sales_report(7) r), 'the report for a week');
SELECT pg_temp.assert_true((SELECT (r -> 'series' -> 29 ->> 'day')::date = (now() AT TIME ZONE 'Africa/Lusaka')::date FROM public.staff_sales_report(30) r), 'thirty days end today');
SELECT pg_temp.assert_true((SELECT bool_or(d ->> 'id' = 'vdept') FROM public.staff_sales_report(90) r, jsonb_array_elements(r -> 'departments') d), 'departments are listed');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_sales_report(14)$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000e0f1');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_sales_report(7)$q$);
ROLLBACK;
