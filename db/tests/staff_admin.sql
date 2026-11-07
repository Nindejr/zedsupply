-- Run after db/tests/supabase_stub.sql and all migrations on an isolated test database.
-- Leaves no fixtures. Covers 029: the second sign-in step for staff (reads and actions), staff
-- roles on every action, the admin panel's functions, and that staff never see handover codes.
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
-- Signed in with an email code only (aal1), or also with an authenticator app code (aal2)
CREATE FUNCTION pg_temp.signed_in(uid uuid, aal text DEFAULT 'aal2') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'none', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', pg_my_temp_schema()::regnamespace); END $$;

-- ---------- Fixtures: an owner, one person in each other role, a staff account with no role, a buyer ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-00000000c0f1', 'owner@admin.test', now()),
  ('00000000-0000-0000-0000-00000000c0f2', 'ops@admin.test', now()),
  ('00000000-0000-0000-0000-00000000c0f3', 'support@admin.test', now()),
  ('00000000-0000-0000-0000-00000000c0f4', 'catalogue@admin.test', now()),
  ('00000000-0000-0000-0000-00000000c0f5', 'finance@admin.test', now()),
  ('00000000-0000-0000-0000-00000000c0f6', 'norole@admin.test', now()),
  ('00000000-0000-0000-0000-00000000c0b1', 'buyer@admin.test', now());
UPDATE users SET is_staff = true WHERE email LIKE '%@admin.test' AND email <> 'buyer@admin.test';
INSERT INTO staff_roles (user_id, role) SELECT id, r FROM users, (VALUES ('owner@admin.test', 'owner'), ('ops@admin.test', 'operations'),
  ('support@admin.test', 'support'), ('catalogue@admin.test', 'catalogue'), ('finance@admin.test', 'finance')) v(e, r) WHERE email = v.e;
INSERT INTO departments (id, name) VALUES ('sa', 'Staff admin test');
INSERT INTO sellers (id, name) VALUES ('sa-store', 'Admin test store');
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status, heavy_delivery) VALUES
  ('SA1', 'Cement', 'sa', 'sa-store', 100, 'active', true), ('SA2', 'Pending lamp', 'sa', 'sa-store', 50, 'pending', false);
SELECT app.place_order(jsonb_build_object('ref', 'ZS-ADMIN001', 'buyer_town', 'Lusaka', 'items', '[{"product_id":"SA1","quantity":2}]'::jsonb,
  'user_id', (SELECT id FROM users WHERE email = 'buyer@admin.test')));
INSERT INTO notifications (order_id, channel, to_address, template, payload, status, attempts, last_error)
  SELECT id, 'whatsapp', '+260970000001', 'handover_code', jsonb_build_object('ref', ref, 'code', '482913'), 'failed', 5, 'Provider HTTP 400' FROM orders WHERE ref = 'ZS-ADMIN001';
INSERT INTO notifications (order_id, channel, to_address, template, payload, status)
  SELECT id, 'email', 'buyer@admin.test', 'order_receipt', jsonb_build_object('ref', ref, 'total', 200), 'sent' FROM orders WHERE ref = 'ZS-ADMIN001';

CREATE TEMP TABLE msg AS SELECT template, id FROM notifications WHERE template IN ('handover_code', 'order_receipt') AND order_id = (SELECT id FROM orders WHERE ref = 'ZS-ADMIN001');
GRANT SELECT ON msg TO authenticated;

-- ---------- The second sign-in step ----------
SELECT pg_temp.assert_true((SELECT staff_mfa_required FROM shop_settings), 'the second step is required by default');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f1', 'aal1');
SELECT pg_temp.assert_true((SELECT (m ->> 'staff')::boolean AND NOT (m ->> 'ready')::boolean AND m -> 'roles' = '[]'::jsonb FROM (SELECT public.staff_me() m) x), 'an email code alone isn''t enough');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM orders), 'no staff reads before the second step');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_dashboard()$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_order_step((SELECT 1::bigint), 'confirmed')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f1');
SELECT pg_temp.assert_true((SELECT (m ->> 'ready')::boolean AND m -> 'roles' = '["owner"]'::jsonb FROM (SELECT public.staff_me() m) x), 'with the app code, staff are ready');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM orders WHERE ref = 'ZS-ADMIN001'), 'staff read orders after the second step');
SELECT pg_temp.assert_true((SELECT (d ->> 'fee_to_quote')::int >= 1 AND (d ->> 'listings_to_review')::int >= 1 AND (d ->> 'messages_failed')::int >= 1 AND (d ->> 'to_confirm')::int >= 1
  FROM (SELECT public.staff_dashboard() d) x), 'the dashboard counts what needs attention');

-- ---------- Roles ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f6');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_moderate_listing('SA2', 'active')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_notifications()$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f3');   -- support
SELECT pg_temp.expect_rejection($q$SELECT public.staff_moderate_listing('SA2', 'active')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_delivery_fee('ZS-ADMIN001', 300)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_save_delivery_rate(NULL, 'town', 'standard', 45)$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f4');   -- catalogue
SELECT public.staff_moderate_listing('SA2', 'active');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_order_step((SELECT id FROM orders WHERE ref = 'ZS-ADMIN001'), 'confirmed')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f5');   -- finance
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_delivery_fee('ZS-ADMIN001', 300)$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f2');   -- operations
SELECT pg_temp.expect_rejection($q$SELECT public.staff_moderate_listing('SA2', 'paused')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_delivery_fee('ZS-ADMIN001', -5)$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_delivery_fee('ZS-NOPE0001', 300)$q$);
SELECT public.staff_set_delivery_fee('zs-admin001', 350, 'Truck from Lusaka depot');
SELECT public.staff_order_step((SELECT id FROM orders WHERE ref = 'ZS-ADMIN001'), 'confirmed');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT delivery_zmw = 350 AND delivery_source = 'staff' AND status = 'confirmed' FROM orders WHERE ref = 'ZS-ADMIN001'), 'operations quote the fee and confirm');
SELECT pg_temp.assert_true((SELECT status = 'active' FROM products WHERE id = 'SA2'), 'catalogue approved the listing');

-- ---------- The message queue: handover codes stay hidden ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f2');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(q) >= 2 AND NOT (q::text LIKE '%482913%') FROM (SELECT public.staff_notifications() q) x), 'staff see the queue without handover codes');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(public.staff_notifications('failed')) >= 1), 'filter by status');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM notifications), 'staff can''t read the queue table itself');
SELECT public.staff_retry_notification(id) FROM msg WHERE template = 'handover_code';
SELECT pg_temp.expect_rejection($q$SELECT public.staff_retry_notification(id) FROM msg WHERE template = 'order_receipt'$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT status = 'queued' AND attempts = 0 AND last_error IS NULL FROM notifications WHERE template = 'handover_code'), 'a failed message is queued again');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND qual LIKE '%is_staff%'), 'staff can''t read the queue table directly');

-- ---------- The audit log ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f4');
SELECT pg_temp.assert_true((SELECT bool_and(e ->> 'by_email' = 'catalogue@admin.test') AND count(*) >= 1 FROM jsonb_array_elements(public.staff_audit()) e), 'others see only their own actions');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f1');
SELECT pg_temp.assert_true((SELECT count(DISTINCT e ->> 'by_email') >= 2 FROM jsonb_array_elements(public.staff_audit()) e), 'the owner sees everyone''s');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(public.staff_audit('set_delivery_fee')) = 1), 'search the log');
SELECT pg_temp.assert_true((SELECT (e -> 'detail' ->> 'fee')::numeric = 350 FROM jsonb_array_elements(public.staff_audit('ZS-ADMIN001')) e WHERE e ->> 'action' = 'set_delivery_fee'), 'the log keeps the detail');

-- ---------- Losing staff status removes the roles; a buyer and a visitor get nothing ----------
SELECT pg_temp.admin();
UPDATE users SET is_staff = false WHERE email = 'support@admin.test';
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM staff_roles r JOIN users u ON u.id = r.user_id WHERE u.email = 'support@admin.test'), 'roles go with staff status');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0b1');
SELECT pg_temp.assert_true((SELECT NOT (m ->> 'staff')::boolean FROM (SELECT public.staff_me() m) x), 'a buyer isn''t staff');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_dashboard()$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_audit()$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO staff_roles (user_id, role) SELECT id, 'owner' FROM users WHERE email = 'buyer@admin.test'$q$);
SELECT pg_temp.admin();
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL role anon;
SELECT pg_temp.expect_rejection($q$SELECT public.staff_me()$q$);
SELECT pg_temp.expect_rejection($q$SELECT * FROM staff_roles$q$);
RESET role;
-- Switching the requirement off (for example during set-up) lets an email-code session act as staff
UPDATE shop_settings SET staff_mfa_required = false;
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000c0f1', 'aal1');
SELECT pg_temp.assert_true((SELECT (public.staff_me() ->> 'ready')::boolean), 'without the requirement, the email code is enough');

ROLLBACK;
