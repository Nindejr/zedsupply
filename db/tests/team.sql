-- Store teams (migration 020): invitations, roles and what each role can do. Isolated test database only; rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.reject(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN rejected := true; END;
IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %',statement; END IF; END $$;
CREATE FUNCTION pg_temp.actor(suffix text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','22222222-2222-2222-2222-2222222222' || suffix,'role','authenticated')::text,true);
PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION pg_temp.admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role','none',true); PERFORM set_config('request.jwt.claims','',true); END $$;
CREATE FUNCTION pg_temp.uid(mail text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT id FROM public.users WHERE email = mail $$;
CREATE TEMP TABLE ids(name text PRIMARY KEY, id uuid);
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %s TO authenticated,anon',pg_my_temp_schema()::regnamespace); END $$;
GRANT SELECT, INSERT ON ids TO authenticated;

INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('22222222-2222-2222-2222-2222222222d1','team-owner@test.example',now(),'{"name":"Owner"}'),
 ('22222222-2222-2222-2222-2222222222d2','team-finance@test.example',now(),'{"name":"Finance"}'),
 ('22222222-2222-2222-2222-2222222222d3','team-listings@test.example',now(),'{"name":"Listings"}'),
 ('22222222-2222-2222-2222-2222222222d4','team-dispatch@test.example',now(),'{"name":"Dispatch"}'),
 ('22222222-2222-2222-2222-2222222222d5','team-buyer@test.example',now(),'{"name":"Buyer"}'),
 ('22222222-2222-2222-2222-2222222222d6','team-staff@test.example',now(),'{"name":"Staff"}'),
 ('22222222-2222-2222-2222-2222222222d7','team-unconfirmed@test.example',NULL,'{"name":"Unconfirmed"}');
UPDATE users SET is_staff = true WHERE email = 'team-staff@test.example';
-- Migration 029: staff need a role, and these tests don't cover the second sign-in step (staff_admin.sql does)
INSERT INTO staff_roles (user_id, role) SELECT id, 'owner' FROM users WHERE is_staff ON CONFLICT DO NOTHING;
UPDATE shop_settings SET staff_mfa_required = false;
INSERT INTO departments(id,name) VALUES ('team','Team tests') ON CONFLICT DO NOTHING;
INSERT INTO sellers(id,name,about) VALUES ('team-store','Team store','Original');
INSERT INTO seller_members(seller_id,user_id) VALUES ('team-store',pg_temp.uid('team-owner@test.example'));
SELECT pg_temp.assert_true((SELECT role = 'owner' FROM seller_members WHERE seller_id = 'team-store'),'staff-added member defaults to owner');
INSERT INTO products(id,title,department_id,seller_id,price_zmw,stock_qty,status) VALUES ('TM1','Team lamp','team','team-store',100,5,'active');
UPDATE shop_settings SET vat_registered = false;
SELECT app.place_order(jsonb_build_object('ref','ZS-TEAMTEST1','user_id',pg_temp.uid('team-buyer@test.example'),'fulfilment','collection','expected_total_zmw',100,'items','[{"product_id":"TM1","quantity":1}]'::jsonb));

-- Only owners invite
SELECT pg_temp.actor('d5');
SELECT pg_temp.reject($q$SELECT public.seller_team('team-store')$q$);
SELECT pg_temp.reject($q$SELECT public.seller_invite('team-store','someone@test.example','manager')$q$);
SELECT pg_temp.actor('d1');
SELECT pg_temp.reject($q$SELECT public.seller_invite('team-store','not-an-email','manager')$q$);
SELECT pg_temp.reject($q$SELECT public.seller_invite('team-store','someone@test.example','superuser')$q$);
SELECT pg_temp.reject($q$SELECT public.seller_invite('team-store','TEAM-OWNER@test.example','manager')$q$);
INSERT INTO ids VALUES ('listings', public.seller_invite('team-store',' Team-Listings@Test.example ','dispatch'));
SELECT pg_temp.assert_true(public.seller_invite('team-store','team-listings@test.example','listings') = (SELECT id FROM ids WHERE name = 'listings'),'re-sending updates the same invitation');
INSERT INTO ids VALUES ('dispatch', public.seller_invite('team-store','team-dispatch@test.example','dispatch'));
INSERT INTO ids VALUES ('finance', public.seller_invite('team-store','team-finance@test.example','finance'));
INSERT INTO ids VALUES ('unconfirmed', public.seller_invite('team-store','team-unconfirmed@test.example','manager'));
SELECT pg_temp.assert_true(jsonb_array_length(public.seller_team('team-store')->'invites') = 4,'owner sees open invitations');
SELECT pg_temp.reject($q$SELECT * FROM seller_invites$q$);

-- Only the confirmed email's account can accept
SELECT pg_temp.actor('d5');
SELECT pg_temp.assert_true(jsonb_array_length(public.my_seller_invites()) = 0,'other accounts see no invitation');
SELECT pg_temp.reject($q$SELECT public.seller_respond_invite((SELECT id FROM ids WHERE name = 'listings'), true)$q$);
SELECT pg_temp.actor('d7');
SELECT pg_temp.reject($q$SELECT public.seller_respond_invite((SELECT id FROM ids WHERE name = 'unconfirmed'), true)$q$);
SELECT pg_temp.actor('d3');
SELECT pg_temp.assert_true((public.my_seller_invites()->0->>'role') = 'listings' AND (public.my_seller_invites()->0->>'store') = 'Team store','invitee sees the store and role');
SELECT pg_temp.assert_true(public.seller_respond_invite((SELECT id FROM ids WHERE name = 'listings'), true) = 'team-store','listings joins');
SELECT pg_temp.reject($q$SELECT public.seller_respond_invite((SELECT id FROM ids WHERE name = 'listings'), true)$q$);
SELECT pg_temp.actor('d4'); SELECT public.seller_respond_invite((SELECT id FROM ids WHERE name = 'dispatch'), true);
SELECT pg_temp.actor('d2'); SELECT public.seller_respond_invite((SELECT id FROM ids WHERE name = 'finance'), true);

-- Listings: products and prices, not the store, orders, sales or the team
SELECT pg_temp.actor('d3');
UPDATE products SET price_zmw = 120 WHERE id = 'TM1';
UPDATE sellers SET about = 'Changed by listings' WHERE id = 'team-store';
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM orders WHERE ref = 'ZS-TEAMTEST1'),'listings role cannot read orders');
SELECT pg_temp.reject($q$SELECT public.seller_sales('team-store')$q$);
SELECT pg_temp.reject($q$SELECT public.record_shipment('ZS-TEAMTEST1','team-store','packed')$q$);
SELECT pg_temp.reject($q$SELECT public.seller_invite('team-store','x@test.example','owner')$q$);
SELECT pg_temp.assert_true((SELECT count(*) FROM jsonb_array_elements(public.seller_team('team-store')->'members') m WHERE m->>'email' IS NOT NULL) = 1,'members see only their own email');
SELECT pg_temp.assert_true(jsonb_array_length(public.seller_team('team-store')->'log') = 0,'the log is for owners');
SELECT public.seller_performance('team-store');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT price_zmw = 120 FROM products WHERE id = 'TM1'),'listings role edits prices');
SELECT pg_temp.assert_true((SELECT about = 'Original' FROM sellers WHERE id = 'team-store'),'listings role cannot edit the store');

-- Dispatch: orders and shipments, not listings or money
UPDATE orders SET status = 'confirmed' WHERE ref = 'ZS-TEAMTEST1';
SELECT pg_temp.actor('d4');
SELECT pg_temp.assert_true(EXISTS (SELECT 1 FROM orders WHERE ref = 'ZS-TEAMTEST1'),'dispatch reads the order');
SELECT public.record_shipment('ZS-TEAMTEST1','team-store','packed');
UPDATE products SET price_zmw = 1 WHERE id = 'TM1';
SELECT pg_temp.reject($q$SELECT public.seller_sales('team-store')$q$);

-- Finance: orders, sales and payouts, read only
SELECT pg_temp.actor('d2');
SELECT pg_temp.assert_true(EXISTS (SELECT 1 FROM orders WHERE ref = 'ZS-TEAMTEST1'),'finance reads the order');
SELECT pg_temp.assert_true(public.seller_sales('team-store') IS NOT NULL,'finance sees sales');
SELECT pg_temp.reject($q$SELECT public.record_shipment('ZS-TEAMTEST1','team-store','collected')$q$);
UPDATE products SET price_zmw = 2 WHERE id = 'TM1';
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT price_zmw = 120 FROM products WHERE id = 'TM1'),'dispatch and finance cannot edit listings');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM shipment_events WHERE seller_id = 'team-store'),'dispatch recorded the shipment');

-- Owners change roles; a store always keeps an owner
SELECT pg_temp.actor('d1');
SELECT pg_temp.assert_true((SELECT count(*) FROM jsonb_array_elements(public.seller_team('team-store')->'members') m WHERE m->>'email' IS NOT NULL) = 4,'owner sees every email');
SELECT pg_temp.assert_true((public.seller_team('team-store')->'members'->0->>'role') = 'owner','owners are listed first');
SELECT public.seller_set_member_role('team-store',pg_temp.uid('team-listings@test.example'),'manager');
SELECT pg_temp.reject($q$SELECT public.seller_set_member_role('team-store',app.user_id(),'manager')$q$);
SELECT pg_temp.reject($q$SELECT public.seller_remove_member('team-store',app.user_id())$q$);
SELECT pg_temp.actor('d3');
UPDATE sellers SET about = 'Changed by manager' WHERE id = 'team-store';
SELECT pg_temp.reject($q$SELECT public.seller_remove_member('team-store',pg_temp.uid('team-dispatch@test.example'))$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT about = 'Changed by manager' FROM sellers WHERE id = 'team-store'),'a new manager edits the store');

-- Leaving and removal
SELECT pg_temp.actor('d4');
SELECT public.seller_remove_member('team-store',app.user_id());
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM orders WHERE ref = 'ZS-TEAMTEST1'),'a member who left loses access');
SELECT pg_temp.actor('d1');
SELECT public.seller_set_member_role('team-store',pg_temp.uid('team-finance@test.example'),'owner');
SELECT public.seller_remove_member('team-store',app.user_id());
SELECT pg_temp.actor('d2');
SELECT public.seller_remove_member('team-store',pg_temp.uid('team-listings@test.example'));
SELECT pg_temp.assert_true(jsonb_array_length(public.seller_team('team-store')->'members') = 1,'one owner remains');

-- Cancelled and expired invitations
INSERT INTO ids VALUES ('cancel', public.seller_invite('team-store','team-buyer@test.example','manager'));
SELECT public.seller_cancel_invite((SELECT id FROM ids WHERE name = 'cancel'));
SELECT pg_temp.actor('d5');
SELECT pg_temp.reject($q$SELECT public.seller_respond_invite((SELECT id FROM ids WHERE name = 'cancel'), true)$q$);
SELECT pg_temp.actor('d2');
INSERT INTO ids VALUES ('expire', public.seller_invite('team-store','team-buyer@test.example','dispatch'));
SELECT pg_temp.assert_true((SELECT id FROM ids WHERE name = 'expire') <> (SELECT id FROM ids WHERE name = 'cancel'),'a cancelled invitation is not reused');
SELECT pg_temp.admin();
UPDATE seller_invites SET expires_at = now() - interval '1 minute' WHERE id = (SELECT id FROM ids WHERE name = 'expire');
SELECT pg_temp.actor('d5');
SELECT pg_temp.assert_true(jsonb_array_length(public.my_seller_invites()) = 0,'expired invitations are hidden');
SELECT pg_temp.reject($q$SELECT public.seller_respond_invite((SELECT id FROM ids WHERE name = 'expire'), true)$q$);
SELECT pg_temp.actor('d2');
SELECT pg_temp.assert_true(public.seller_invite('team-store','team-buyer@test.example','dispatch') <> (SELECT id FROM ids WHERE name = 'expire'),'an expired invitation can be sent again');
SELECT pg_temp.actor('d5');
SELECT public.seller_respond_invite((public.my_seller_invites()->0->>'id')::uuid, false);
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM orders o WHERE o.ref = 'ZS-TEAMTEST1' AND app.order_has_seller(o.id)),'declining grants nothing');

-- Size limit, Zed Supply staff and the log
SELECT pg_temp.actor('d2');
DO $$ DECLARE n int := 0; BEGIN
  LOOP
    BEGIN PERFORM public.seller_invite('team-store','cap' || n || '@test.example','listings'); EXCEPTION WHEN OTHERS THEN EXIT; END;
    n := n + 1; IF n > 25 THEN EXIT; END IF;
  END LOOP;
  IF n <> 18 THEN RAISE EXCEPTION 'Assertion failed: limit allowed % invitations', n; END IF;
END $$;
SELECT pg_temp.actor('d6');
SELECT pg_temp.assert_true(public.seller_team('team-store')->>'my_role' IS NULL,'staff read a team they are not on');
SELECT public.seller_cancel_invite((SELECT (i->>'id')::uuid FROM jsonb_array_elements(public.seller_team('team-store')->'invites') i LIMIT 1));
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM staff_actions WHERE action = 'team_cancel_invite' AND target = 'team-store'),'staff team changes are in the staff log');
-- Staff who are also on the team in a smaller role still manage it, as staff (the Store team page relies on this)
INSERT INTO seller_members(seller_id,user_id,role) VALUES ('team-store',pg_temp.uid('team-staff@test.example'),'dispatch');
SELECT pg_temp.actor('d6');
SELECT pg_temp.assert_true(public.seller_team('team-store')->>'my_role' = 'dispatch' AND jsonb_array_length(public.seller_team('team-store')->'invites') > 0,'staff with a team role see invitations');
SELECT public.seller_cancel_invite((SELECT (i->>'id')::uuid FROM jsonb_array_elements(public.seller_team('team-store')->'invites') i LIMIT 1));
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM staff_actions WHERE action = 'team_cancel_invite' AND target = 'team-store'),'their changes are logged as staff actions');
SELECT pg_temp.assert_true((SELECT array_agg(DISTINCT action ORDER BY action) FROM seller_team_events WHERE seller_id = 'team-store')
  = ARRAY['declined','invite_cancelled','invited','joined','left','removed','role_changed'],'every kind of change is logged');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM seller_members WHERE role NOT IN ('owner','manager','listings','dispatch','finance')),'only known roles');
ROLLBACK;
