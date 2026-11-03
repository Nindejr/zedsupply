-- Seller applications (migration 022): applying, the staff queue and approval. Isolated test database only; rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.reject(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN rejected := true; END;
IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %',statement; END IF; END $$;
CREATE FUNCTION pg_temp.actor(suffix text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','33333333-3333-3333-3333-3333333333' || suffix,'role','authenticated')::text,true);
PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION pg_temp.admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role','none',true); PERFORM set_config('request.jwt.claims','',true); END $$;
CREATE TEMP TABLE ids(name text PRIMARY KEY, id uuid);
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %s TO authenticated,anon',pg_my_temp_schema()::regnamespace); END $$;
GRANT SELECT, INSERT ON ids TO authenticated;

INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('33333333-3333-3333-3333-3333333333e1','apply-one@test.example',now(),'{"name":"Applicant One"}'),
 ('33333333-3333-3333-3333-3333333333e2','apply-two@test.example',now(),'{"name":"Applicant Two"}'),
 ('33333333-3333-3333-3333-3333333333e3','apply-staff@test.example',now(),'{"name":"Reviewer"}'),
 ('33333333-3333-3333-3333-3333333333e4','apply-unconfirmed@test.example',NULL,'{"name":"Unconfirmed"}');
UPDATE users SET is_staff = true WHERE email = 'apply-staff@test.example';
INSERT INTO sellers(id,name) VALUES ('taken-store','Already here');

-- Applying
SELECT pg_temp.actor('e4');
SELECT pg_temp.reject($q$SELECT public.submit_seller_application('Unconfirmed Ltd','Someone','0977123456','Lusaka')$q$);
SELECT pg_temp.actor('e1');
SELECT pg_temp.reject($q$SELECT public.submit_seller_application('Good Shop','Applicant One','12345','Lusaka')$q$);
SELECT pg_temp.reject($q$SELECT public.submit_seller_application('G','Applicant One','0977123456','Lusaka')$q$);
SELECT pg_temp.reject($q$INSERT INTO seller_applications(user_id,business,contact_name,phone,email,town) VALUES (app.user_id(),'Direct','Me','+260977123456','x@test.example','Lusaka')$q$);
INSERT INTO ids VALUES ('one', public.submit_seller_application(' Good Shop ','Applicant One','0977 123-456','Lusaka','PACRA-1',ARRAY['Solar, Power & Energy','Solar, Power & Energy',' '],'Solar lamps and panels'));
SELECT pg_temp.assert_true((SELECT phone = '+260977123456' AND business = 'Good Shop' AND email = 'apply-one@test.example' AND categories = ARRAY['Solar, Power & Energy'] AND status = 'new'
  FROM seller_applications WHERE id = (SELECT id FROM ids WHERE name = 'one')),'application stored with a normalised phone and the confirmed email');
SELECT pg_temp.reject($q$SELECT public.submit_seller_application('Good Shop again','Applicant One','0977123456','Lusaka')$q$);
SELECT pg_temp.reject($q$SELECT public.staff_review_application((SELECT id FROM ids WHERE name = 'one'),'review')$q$);
SELECT pg_temp.reject($q$UPDATE seller_applications SET status = 'approved'$q$);
SELECT pg_temp.actor('e2');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM seller_applications),'applicants see only their own');

-- Staff review
SELECT pg_temp.actor('e3');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM seller_applications),'staff see the queue');
SELECT public.staff_review_application((SELECT id FROM ids WHERE name = 'one'),'review');
SELECT pg_temp.reject($q$SELECT public.staff_review_application((SELECT id FROM ids WHERE name = 'one'),'info_needed')$q$);
SELECT pg_temp.reject($q$SELECT public.staff_review_application((SELECT id FROM ids WHERE name = 'one'),'approved','Looks good')$q$);
SELECT public.staff_review_application((SELECT id FROM ids WHERE name = 'one'),'info_needed','Please send your PACRA certificate number.');
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM notifications WHERE template = 'seller_application_update' AND to_address = '+260977123456'
  AND payload->>'status' = 'info_needed'),'the applicant is told more information is needed');

-- The applicant updates it
SELECT pg_temp.actor('e1');
SELECT pg_temp.assert_true((SELECT staff_note = 'Please send your PACRA certificate number.' AND status = 'info_needed' FROM seller_applications),'the applicant reads the message');
SELECT pg_temp.assert_true(public.submit_seller_application('Good Shop Ltd','Applicant One','+260977123456','Lusaka','120240001234') = (SELECT id FROM ids WHERE name = 'one'),'updating keeps the same application');
SELECT pg_temp.assert_true((SELECT status = 'new' AND pacra = '120240001234' FROM seller_applications),'an updated application goes back to the queue');

-- Approval opens the store with the applicant as owner
SELECT pg_temp.actor('e3');
SELECT pg_temp.reject($q$SELECT public.staff_approve_application((SELECT id FROM ids WHERE name = 'one'),'Bad ID!')$q$);
SELECT pg_temp.reject($q$SELECT public.staff_approve_application((SELECT id FROM ids WHERE name = 'one'),'taken-store')$q$);
SELECT pg_temp.assert_true(public.staff_approve_application((SELECT id FROM ids WHERE name = 'one'),' Good-Shop ',NULL,'Welcome aboard') = 'good-shop','approval returns the store ID');
SELECT pg_temp.reject($q$SELECT public.staff_approve_application((SELECT id FROM ids WHERE name = 'one'),'good-shop-2')$q$);
SELECT pg_temp.admin();
SELECT pg_temp.assert_true((SELECT name = 'Good Shop Ltd' AND city = 'Lusaka' AND verified AND NOT vat_registered FROM sellers WHERE id = 'good-shop'),'store opened, verified, VAT off until confirmed');
SELECT pg_temp.assert_true((SELECT status = 'approved' AND seller_id = 'good-shop' AND decided_at IS NOT NULL FROM seller_applications WHERE id = (SELECT id FROM ids WHERE name = 'one')),'application approved');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM staff_actions WHERE action IN ('review_seller_application','approve_seller_application')
  AND target = (SELECT id::text FROM ids WHERE name = 'one')),'every staff decision is logged');
SELECT pg_temp.actor('e1');
SELECT pg_temp.assert_true(public.seller_team('good-shop')->>'my_role' = 'owner','the applicant owns the new store');
SELECT pg_temp.assert_true((public.seller_team('good-shop')->'log'->0->>'action') = 'joined','the team log starts with the owner');

-- Withdrawal, rejection and the limit
SELECT pg_temp.actor('e2');
INSERT INTO ids VALUES ('two', public.submit_seller_application('Second Shop','Applicant Two','0966000000','Ndola'));
SELECT public.withdraw_seller_application((SELECT id FROM ids WHERE name = 'two'));
SELECT pg_temp.reject($q$SELECT public.withdraw_seller_application((SELECT id FROM ids WHERE name = 'two'))$q$);
SELECT pg_temp.actor('e3');
SELECT pg_temp.reject($q$SELECT public.staff_review_application((SELECT id FROM ids WHERE name = 'two'),'rejected','Too late')$q$);
SELECT pg_temp.actor('e2');
INSERT INTO ids VALUES ('three', public.submit_seller_application('Second Shop','Applicant Two','0966000000','Ndola'));
SELECT pg_temp.actor('e3');
SELECT public.staff_review_application((SELECT id FROM ids WHERE name = 'three'),'rejected','We can''t verify this business yet.');
SELECT pg_temp.actor('e2');
SELECT pg_temp.assert_true((SELECT status = 'rejected' AND decided_at IS NOT NULL FROM seller_applications WHERE id = (SELECT id FROM ids WHERE name = 'three')),'the applicant sees the rejection');
SELECT public.withdraw_seller_application(public.submit_seller_application('Second Shop','Applicant Two','0966000000','Ndola'));
SELECT pg_temp.reject($q$SELECT public.submit_seller_application('Second Shop','Applicant Two','0966000000','Ndola')$q$);
ROLLBACK;
