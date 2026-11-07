-- Isolated test database only. All fixtures and effects are rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.reject(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN rejected := true; END;
IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %',statement; END IF; END $$;
CREATE FUNCTION pg_temp.actor(suffix text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-1111-1111-1111111111' || suffix,'role','authenticated')::text,true);
PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION pg_temp.admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role','none',true); PERFORM set_config('request.jwt.claims','',true); END $$;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %s TO authenticated,anon',pg_my_temp_schema()::regnamespace); END $$;

INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('11111111-1111-1111-1111-1111111111b1','connected-buyer@test.example',now(),'{"name":"Buyer"}'),
 ('11111111-1111-1111-1111-1111111111b2','connected-other@test.example',now(),'{"name":"Other buyer"}'),
 ('11111111-1111-1111-1111-1111111111a1','connected-seller@test.example',now(),'{"name":"Seller"}'),
 ('11111111-1111-1111-1111-1111111111c1','connected-staff@test.example',now(),'{"name":"Staff"}');
UPDATE users SET is_staff = true WHERE email = 'connected-staff@test.example';
-- Migration 029: staff need a role, and these tests don't cover the second sign-in step (staff_admin.sql does)
INSERT INTO staff_roles (user_id, role) SELECT id, 'owner' FROM users WHERE is_staff ON CONFLICT DO NOTHING;
UPDATE shop_settings SET staff_mfa_required = false;
INSERT INTO departments(id,name) VALUES ('connected','Connected tests');
INSERT INTO sellers(id,name) VALUES ('connected-store','Test store');
INSERT INTO seller_members(seller_id,user_id) SELECT 'connected-store',id FROM users WHERE email = 'connected-seller@test.example';
INSERT INTO products(id,title,department_id,seller_id,price_zmw,stock_qty,status) VALUES
 ('CON1','Blue solar lamp','connected','connected-store',100,5,'active'),
 ('CON2','Hidden lamp','connected','connected-store',200,5,'pending');
UPDATE shop_settings SET vat_registered = false;
SELECT pg_temp.actor('b1');
SELECT pg_temp.assert_true(jsonb_array_length(public.catalogue_page('solar','connected','',24)) = 1,'indexed active catalogue');
SELECT pg_temp.assert_true(jsonb_array_length(public.catalogue_page('','connected','CON1',24)) = 0,'cursor skips previous page and hidden rows');
SELECT pg_temp.assert_true((public.checkout_quote('{"user_id":99999,"fulfilment":"collection","items":[{"product_id":"CON1","quantity":1}]}')->>'total')::numeric = 100,'quote uses server price');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT stock_qty = 5 FROM products WHERE id = 'CON1'),'quote does not reserve stock');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'connected-buyer@test.example')),'quote does not persist orders');
SELECT pg_temp.reject($q$SELECT app.place_order(jsonb_build_object('ref','ZS-CONNECT01','user_id',(SELECT id FROM users WHERE email = 'connected-buyer@test.example'),'fulfilment','collection','expected_total_zmw',99,'items','[{"product_id":"CON1","quantity":1}]'::jsonb))$q$);
SELECT pg_temp.assert_true((SELECT stock_qty = 5 FROM products WHERE id = 'CON1'),'changed total rolls stock back');
SELECT app.place_order(jsonb_build_object('ref','ZS-CONNECT01','user_id',(SELECT id FROM users WHERE email = 'connected-buyer@test.example'),'fulfilment','collection','expected_total_zmw',100,'items','[{"product_id":"CON1","quantity":1}]'::jsonb));
SELECT pg_temp.actor('b2');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM orders WHERE ref = 'ZS-CONNECT01'),'other buyer cannot read order');
SELECT pg_temp.reject($q$SELECT public.open_support_case('ZS-CONNECT01','wrong','refund','Wrong order access must fail')$q$);
SELECT pg_temp.actor('b1');
SELECT public.open_support_case('ZS-CONNECT01','wrong','refund','The item does not match the description');
SELECT public.escalate_support_case((SELECT id FROM complaints WHERE order_id = (SELECT id FROM orders WHERE ref = 'ZS-CONNECT01')));
SELECT pg_temp.assert_true((SELECT escalated_at IS NOT NULL FROM complaints WHERE order_id = (SELECT id FROM orders WHERE ref = 'ZS-CONNECT01')),'buyer escalation persisted');
SELECT pg_temp.reject($q$SELECT public.assign_support_case((SELECT id FROM complaints LIMIT 1),app.user_id())$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((app.begin_payment('ZS-CONNECT01',(SELECT id FROM users WHERE email = 'connected-buyer@test.example'),'+260970000001','PAY-connected01')->>'send')::boolean,'first attempt sends once');
SELECT pg_temp.assert_true(NOT (app.begin_payment('ZS-CONNECT01',(SELECT id FROM users WHERE email = 'connected-buyer@test.example'),'+260970000001','PAY-connected01')->>'send')::boolean,'replayed attempt never resends');
SELECT pg_temp.reject($q$SELECT app.begin_payment('ZS-CONNECT01',(SELECT id FROM users WHERE email = 'connected-buyer@test.example'),'+260970000001','PAY-connected02')$q$);
SELECT app.record_payment('generic','CONNECTED-TX','ZS-CONNECT01',100,'paid',NULL,NULL);
SELECT pg_temp.reject($q$SELECT app.record_payment('generic','CONNECTED-TX','ZS-CONNECT01',1,'paid',NULL,NULL)$q$);
SELECT app.record_refund((SELECT id FROM payments WHERE provider_ref = 'CONNECTED-TX'),'REFUND-CON1',30);
SELECT app.record_refund((SELECT id FROM payments WHERE provider_ref = 'CONNECTED-TX'),'REFUND-CON1',30);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM refund_events WHERE provider_ref = 'REFUND-CON1'),'refund callback replay is idempotent');
SELECT pg_temp.reject($q$SELECT app.record_refund((SELECT id FROM payments WHERE provider_ref = 'CONNECTED-TX'),'REFUND-OVER',80)$q$);
SELECT pg_temp.actor('a1');
SELECT public.record_shipment('ZS-CONNECT01','connected-store','packed');
SELECT pg_temp.reject($q$SELECT public.record_shipment('ZS-CONNECT01','connected-store','collected')$q$);
SELECT pg_temp.admin();
INSERT INTO storage.objects(bucket_id,name) VALUES ('delivery-proofs','11111111-1111-1111-1111-1111111111a1/receipt.webp');
SELECT pg_temp.actor('a1');
SELECT public.record_shipment('ZS-CONNECT01','connected-store','collected',NULL,'Collected at agreed location','11111111-1111-1111-1111-1111111111a1/receipt.webp');
SELECT pg_temp.actor('b2');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM shipment_events),'other buyer cannot read evidence');
SELECT pg_temp.actor('b1');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM shipment_events),'buyer sees their shipment events');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT status = 'delivered' FROM orders WHERE ref = 'ZS-CONNECT01'),'all seller parcels complete the order');
SELECT app.record_refund((SELECT id FROM payments WHERE provider_ref = 'CONNECTED-TX'),'REFUND-CON2',70);
SELECT pg_temp.assert_true((SELECT payment_status = 'refunded' FROM orders WHERE ref = 'ZS-CONNECT01'),'full refund updates order payment state');
SELECT app.record_payment('generic','CONNECTED-TX','ZS-CONNECT01',100,'paid',NULL,NULL);
SELECT pg_temp.assert_true((SELECT payment_status = 'refunded' FROM orders WHERE ref = 'ZS-CONNECT01'),'late paid callback cannot undo refund');
SELECT pg_temp.assert_true((SELECT status = 'cancelled' FROM seller_payouts WHERE order_id = (SELECT id FROM orders WHERE ref = 'ZS-CONNECT01')),'refund blocks unpaid seller payout');

-- A provider that doesn't echo our reference still settles the pending request, so the buyer can retry.
SELECT app.place_order(jsonb_build_object('ref','ZS-CONNECT02','user_id',(SELECT id FROM users WHERE email = 'connected-buyer@test.example'),'fulfilment','collection','items','[{"product_id":"CON1","quantity":1}]'::jsonb));
SELECT app.begin_payment('ZS-CONNECT02',(SELECT id FROM users WHERE email = 'connected-buyer@test.example'),'+260970000001','PAY-connected03');
SELECT app.record_payment('generic','CONNECTED-FAIL','ZS-CONNECT02',100,'failed',NULL,'{"transaction_id":"CONNECTED-FAIL"}');
SELECT pg_temp.assert_true((SELECT state = 'failed' FROM payment_attempts WHERE attempt_key = 'PAY-connected03'),'reference-less failure settles the pending request');
SELECT pg_temp.assert_true((app.begin_payment('ZS-CONNECT02',(SELECT id FROM users WHERE email = 'connected-buyer@test.example'),'+260970000001','PAY-connected04')->>'send')::boolean,'buyer can retry after a failed prompt');
SELECT pg_temp.actor('b1');
SELECT pg_temp.reject($q$SELECT public.staff_close_payment_attempt((SELECT id FROM payment_attempts WHERE attempt_key = 'PAY-connected04'),'not staff')$q$);
SELECT pg_temp.actor('c1');
SELECT public.staff_close_payment_attempt((SELECT id FROM payment_attempts WHERE attempt_key = 'PAY-connected04'),'Provider shows no payment');
SELECT pg_temp.assert_true((SELECT state = 'failed' FROM payment_attempts WHERE attempt_key = 'PAY-connected04'),'staff can close an unsettled prompt');
SELECT public.assign_support_case((SELECT id FROM complaints WHERE order_id = (SELECT id FROM orders WHERE ref = 'ZS-CONNECT01')),app.user_id());
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT status = 'review' AND assigned_to IS NOT NULL FROM complaints WHERE order_id = (SELECT id FROM orders WHERE ref = 'ZS-CONNECT01')),'staff assignment moves the case to review');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM staff_actions WHERE action IN ('close_payment_attempt','assign support case')),'staff actions are logged');
ROLLBACK;
