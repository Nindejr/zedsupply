-- Run after db/tests/supabase_stub.sql and all migrations on an isolated test database.
-- Leaves no fixtures. Covers 030: the owner manages staff and roles (and can't remove the last
-- owner), the owner changes shop settings within limits, and finance records seller payouts.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejection(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR unique_violation OR raise_exception
    OR insufficient_privilege OR invalid_text_representation OR datatype_mismatch THEN rejected := true;
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

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-00000000d0f1', 'owner@p2.test', now()),
  ('00000000-0000-0000-0000-00000000d0f2', 'finance@p2.test', now()),
  ('00000000-0000-0000-0000-00000000d0f3', 'newhire@p2.test', now());
UPDATE users SET is_staff = true WHERE email IN ('owner@p2.test', 'finance@p2.test');
INSERT INTO staff_roles (user_id, role) SELECT id, CASE email WHEN 'owner@p2.test' THEN 'owner' ELSE 'finance' END FROM users WHERE email IN ('owner@p2.test', 'finance@p2.test');
-- Other owners from fixtures elsewhere would hide the last-owner rule: this test is about one shop with one owner
DELETE FROM staff_roles WHERE role = 'owner' AND user_id <> (SELECT id FROM users WHERE email = 'owner@p2.test');
INSERT INTO sellers (id, name) VALUES ('p2-store', 'Payout store'), ('p2-other', 'Other store');
INSERT INTO departments (id, name) VALUES ('p2', 'Phase 2 test');
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status) VALUES ('P2A', 'Kettle', 'p2', 'p2-store', 100, 'active');
SELECT app.place_order('{"ref":"ZS-PAYOUT01","contact_name":"Guest","recipient_phone":"+260970000055","fulfilment":"collection","items":[{"product_id":"P2A"}]}');
INSERT INTO seller_payouts (seller_id, order_id, amount_zmw, commission_zmw, status) SELECT 'p2-store', id, 90, 10, 'due' FROM orders WHERE ref = 'ZS-PAYOUT01';
SELECT app.place_order('{"ref":"ZS-PAYOUT02","contact_name":"Guest","recipient_phone":"+260970000055","fulfilment":"collection","items":[{"product_id":"P2A"}]}');
INSERT INTO seller_payouts (seller_id, order_id, amount_zmw, commission_zmw, status) SELECT 'p2-store', id, 45, 5, 'held' FROM orders WHERE ref = 'ZS-PAYOUT02';
INSERT INTO seller_payouts (seller_id, order_id, amount_zmw, commission_zmw, status) SELECT 'p2-other', id, 30, 3, 'due' FROM orders WHERE ref = 'ZS-PAYOUT01';
CREATE TEMP TABLE pay AS SELECT id, seller_id, status FROM seller_payouts WHERE order_id IN (SELECT id FROM orders WHERE ref IN ('ZS-PAYOUT01', 'ZS-PAYOUT02'));
GRANT SELECT ON pay TO authenticated;

-- ---------- Staff and roles: the owner only ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000d0f2');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_list()$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_roles('newhire@p2.test', '{support}')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000d0f1');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM jsonb_array_elements(public.staff_list()) s WHERE s ->> 'email' LIKE '%@p2.test'), 'the owner sees the staff');
SELECT public.staff_set_roles('NewHire@p2.test', '{support,catalogue,support}');
SELECT pg_temp.assert_true((SELECT s -> 'roles' = '["catalogue", "support"]'::jsonb FROM jsonb_array_elements(public.staff_list()) s WHERE s ->> 'email' = 'newhire@p2.test'), 'a new member with roles');
SELECT public.staff_set_roles('newhire@p2.test', '{operations}');
SELECT pg_temp.assert_true((SELECT s -> 'roles' = '["operations"]'::jsonb FROM jsonb_array_elements(public.staff_list()) s WHERE s ->> 'email' = 'newhire@p2.test'), 'roles replaced');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_roles('nobody@p2.test', '{support}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_roles('newhire@p2.test', '{wizard}')$q$);
-- The last owner can't step down or be removed
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_roles('owner@p2.test', '{operations}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_roles('owner@p2.test', '{}')$q$);
SELECT public.staff_set_roles('newhire@p2.test', '{}');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT NOT is_staff FROM users WHERE email = 'newhire@p2.test') AND NOT EXISTS (SELECT 1 FROM staff_roles r JOIN users u ON u.id = r.user_id WHERE u.email = 'newhire@p2.test'), 'removed from staff');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM staff_actions WHERE action = 'set_staff_roles'), 'each change is logged');
SELECT pg_temp.assert_true((SELECT detail -> 'before' = '["operations"]'::jsonb AND detail -> 'after' = '[]'::jsonb FROM staff_actions WHERE action = 'set_staff_roles' ORDER BY id DESC LIMIT 1), 'the log keeps before and after');

-- ---------- Shop settings: the owner only, within limits ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000d0f2');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_shop_settings('{"commission_pct": 12}')$q$);
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000d0f1');
SELECT public.staff_set_shop_settings('{"commission_pct": 12.5, "payout_hold_days": 5, "layby_enabled": true}');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_shop_settings('{"commission_pct": 80}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_shop_settings('{"vat_registration_verified": true, "vat_registered": false}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_shop_settings('{"site_url": "http://example.test"}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_shop_settings('{"free_delivery_min_zmw": 1}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_shop_settings('{"id": false}')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_set_shop_settings('{"payout_hold_days": "soon"}')$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT commission_pct = 12.5 AND payout_hold_days = 5 AND layby_enabled FROM shop_settings), 'settings changed');
SELECT pg_temp.assert_true((SELECT (detail -> 'after' ->> 'commission_pct')::numeric = 12.5 AND detail -> 'before' ? 'commission_pct' FROM staff_actions WHERE action = 'set_shop_settings' ORDER BY id DESC LIMIT 1), 'settings changes are logged with before and after');

-- ---------- Seller payouts: finance ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000d0f2');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_mark_payouts_paid(ARRAY(SELECT id FROM pay WHERE status = 'due' AND seller_id = 'p2-store'), '')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_mark_payouts_paid(ARRAY(SELECT id FROM pay WHERE seller_id = 'p2-store'), 'MTN-778899')$q$);
SELECT pg_temp.expect_rejection($q$SELECT public.staff_mark_payouts_paid(ARRAY(SELECT id FROM pay WHERE status = 'due'), 'MTN-778899')$q$);
SELECT pg_temp.assert_true((SELECT public.staff_mark_payouts_paid(ARRAY(SELECT id FROM pay WHERE status = 'due' AND seller_id = 'p2-store'), 'MTN-778899') = 1), 'finance records a payout');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_mark_payouts_paid(ARRAY(SELECT id FROM pay WHERE status = 'due' AND seller_id = 'p2-store'), 'MTN-778899')$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT p.status = 'paid' AND p.reference = 'MTN-778899' AND p.paid_at IS NOT NULL FROM seller_payouts p JOIN pay ON pay.id = p.id WHERE pay.status = 'due' AND pay.seller_id = 'p2-store'), 'paid with the reference');
SELECT pg_temp.assert_true((SELECT (detail ->> 'total')::numeric = 90 FROM staff_actions WHERE action = 'mark_payouts_paid'), 'the log keeps the amount');
-- Others can't
INSERT INTO staff_roles (user_id, role) SELECT id, 'support' FROM users WHERE email = 'finance@p2.test';
DELETE FROM staff_roles WHERE role = 'finance' AND user_id = (SELECT id FROM users WHERE email = 'finance@p2.test');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-00000000d0f2');
SELECT pg_temp.expect_rejection($q$SELECT public.staff_mark_payouts_paid(ARRAY(SELECT id FROM pay WHERE seller_id = 'p2-other'), 'MTN-1')$q$);

ROLLBACK;
