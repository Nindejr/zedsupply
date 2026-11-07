-- Admin panel, phase 2: managing staff and their roles, shop settings, and paying sellers.
--
-- 1. Staff (owner only). Make an existing account staff with roles, change the roles, or remove
--    them from staff. The last owner can't be removed or lose the owner role, so the shop can't
--    lock itself out. Authenticator resets stay in Supabase's dashboard (Authentication → Users).
-- 2. Shop settings (owner only): VAT, cash on delivery, lay-by, the payout hold and commission,
--    support reply hours, the staff second-step requirement and the site address. Each change
--    is checked and logged with the values before and after.
-- 3. Seller payouts (finance): record that due payouts were paid, with the transfer reference.
-- Every change goes through app.staff_only(), so it's role-checked and in the audit log.
BEGIN;

-- Payments to sellers are finance's; the rest stays owner-only (not listed)
CREATE OR REPLACE FUNCTION app.action_roles(p_action text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_action IN ('order_step', 'decide_cancellation', 'set_delivery_fee', 'save_delivery_rate', 'delete_delivery_rate',
      'set_delivery_settings', 'review_rider_application', 'retry_notification') THEN ARRAY['operations']
    WHEN p_action IN ('decide_complaint', 'decide_return', 'assign support case', 'hide_review', 'hide_question') THEN ARRAY['support']
    WHEN p_action IN ('moderate_listing', 'verify_seller', 'review_seller_application', 'approve_seller_application') THEN ARRAY['catalogue']
    WHEN p_action IN ('close_payment_attempt', 'mark_payouts_paid') THEN ARRAY['finance']
    ELSE ARRAY[]::text[] END
$$;

-- ---------- 1. Staff ----------
CREATE FUNCTION public.staff_list() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app.has_role('owner') THEN RAISE EXCEPTION 'Only the owner manages staff' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'you', u.id = app.user_id(),
      'roles', (SELECT coalesce(jsonb_agg(r.role ORDER BY r.role), '[]') FROM staff_roles r WHERE r.user_id = u.id),
      'last_action', (SELECT max(created_at) FROM staff_actions a WHERE a.staff_id = u.id)) ORDER BY u.name, u.email), '[]')
    FROM users u WHERE u.is_staff);
END $$;

CREATE FUNCTION public.staff_set_roles(account_email text, new_roles text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target users; v_roles text[] := ARRAY(SELECT DISTINCT r FROM unnest(coalesce(new_roles, '{}')) r ORDER BY 1); before jsonb;
BEGIN
  IF NOT app.has_role('owner') THEN RAISE EXCEPTION 'Only the owner manages staff' USING ERRCODE = '42501'; END IF;
  IF NOT v_roles <@ ARRAY['owner', 'operations', 'support', 'catalogue', 'finance'] THEN RAISE EXCEPTION 'Unknown role'; END IF;
  SELECT * INTO target FROM users WHERE lower(email) = lower(btrim(account_email)) FOR UPDATE;
  IF NOT FOUND OR target.auth_id IS NULL THEN RAISE EXCEPTION 'No account with that email. They need to sign in to the shop once first.'; END IF;
  -- The shop always keeps an owner
  IF NOT ('owner' = ANY (v_roles)) AND EXISTS (SELECT 1 FROM staff_roles WHERE user_id = target.id AND role = 'owner')
     AND NOT EXISTS (SELECT 1 FROM staff_roles r JOIN users u ON u.id = r.user_id WHERE r.role = 'owner' AND u.is_staff AND r.user_id <> target.id) THEN
    RAISE EXCEPTION 'Make someone else an owner first: the shop must always have one';
  END IF;
  before := (SELECT coalesce(jsonb_agg(role ORDER BY role), '[]') FROM staff_roles WHERE user_id = target.id);
  PERFORM app.staff_only('set_staff_roles', target.email, jsonb_build_object('before', before, 'after', to_jsonb(v_roles)));
  IF cardinality(v_roles) = 0 THEN
    UPDATE users SET is_staff = false WHERE id = target.id;   -- the trigger removes the roles
    DELETE FROM staff_roles WHERE user_id = target.id;
  ELSE
    UPDATE users SET is_staff = true WHERE id = target.id;
    DELETE FROM staff_roles WHERE user_id = target.id AND NOT (role = ANY (v_roles));
    INSERT INTO staff_roles (user_id, role, granted_by) SELECT target.id, r, app.user_id() FROM unnest(v_roles) r ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('email', target.email, 'roles', to_jsonb(v_roles));
END $$;

-- ---------- 2. Shop settings ----------
CREATE FUNCTION public.staff_set_shop_settings(changes jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s shop_settings; k text;
  allowed text[] := ARRAY['vat_registered', 'vat_rate', 'vat_included', 'vat_registration_verified', 'cod_max_zmw', 'cod_min_delivered',
    'layby_enabled', 'layby_deposit_pct', 'layby_weeks', 'payout_hold_days', 'commission_pct', 'support_reply_hours', 'staff_mfa_required', 'site_url'];
BEGIN
  IF changes IS NULL OR jsonb_typeof(changes) <> 'object' THEN RAISE EXCEPTION 'Send the settings to change'; END IF;
  FOR k IN SELECT jsonb_object_keys(changes) LOOP
    IF NOT (k = ANY (allowed)) THEN RAISE EXCEPTION 'That setting can''t be changed here: %', k; END IF;
  END LOOP;
  SELECT * INTO s FROM shop_settings FOR UPDATE;
  PERFORM app.staff_only('set_shop_settings', 'shop', jsonb_build_object('before', (SELECT jsonb_object_agg(key, value) FROM jsonb_each(to_jsonb(s)) WHERE changes ? key), 'after', changes));
  s := jsonb_populate_record(s, changes);
  IF s.vat_rate IS NULL OR s.vat_rate < 0 OR s.vat_rate > 30 THEN RAISE EXCEPTION 'Enter a VAT rate from 0 to 30%%'; END IF;
  IF s.vat_registration_verified AND NOT s.vat_registered THEN RAISE EXCEPTION 'Only a VAT-registered shop can be marked as verified'; END IF;
  IF s.cod_max_zmw IS NULL OR s.cod_max_zmw < 0 OR s.cod_max_zmw > 100000 THEN RAISE EXCEPTION 'Enter a cash on delivery limit from K0 to K100,000'; END IF;
  IF s.cod_min_delivered IS NULL OR s.cod_min_delivered < 0 OR s.cod_min_delivered > 50 THEN RAISE EXCEPTION 'Enter 0 to 50 delivered orders'; END IF;
  IF s.layby_deposit_pct IS NULL OR s.layby_deposit_pct NOT BETWEEN 5 AND 90 THEN RAISE EXCEPTION 'Enter a lay-by deposit from 5 to 90%%'; END IF;
  IF s.layby_weeks IS NULL OR s.layby_weeks NOT BETWEEN 1 AND 26 THEN RAISE EXCEPTION 'Enter 1 to 26 weeks for lay-by'; END IF;
  IF s.payout_hold_days IS NULL OR s.payout_hold_days NOT BETWEEN 0 AND 60 THEN RAISE EXCEPTION 'Enter a payout hold of 0 to 60 days'; END IF;
  IF s.commission_pct IS NULL OR s.commission_pct < 0 OR s.commission_pct > 50 THEN RAISE EXCEPTION 'Enter a commission from 0 to 50%%'; END IF;
  IF s.support_reply_hours IS NOT NULL AND s.support_reply_hours NOT BETWEEN 1 AND 336 THEN RAISE EXCEPTION 'Enter support reply hours from 1 to 336, or leave it empty'; END IF;
  IF s.site_url IS NULL OR s.site_url !~ '^https://[^\s]+/$' THEN RAISE EXCEPTION 'Enter the site address starting https:// and ending with /'; END IF;
  UPDATE shop_settings SET vat_registered = s.vat_registered, vat_rate = s.vat_rate, vat_included = s.vat_included,
    vat_registration_verified = s.vat_registration_verified, cod_max_zmw = s.cod_max_zmw, cod_min_delivered = s.cod_min_delivered,
    layby_enabled = s.layby_enabled, layby_deposit_pct = s.layby_deposit_pct, layby_weeks = s.layby_weeks, payout_hold_days = s.payout_hold_days,
    commission_pct = s.commission_pct, support_reply_hours = s.support_reply_hours, staff_mfa_required = s.staff_mfa_required, site_url = s.site_url;
END $$;

-- ---------- 3. Seller payouts ----------
CREATE FUNCTION public.staff_mark_payouts_paid(payout_ids bigint[], transfer_reference text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ref text := nullif(btrim(transfer_reference), ''); n integer;
BEGIN
  IF payout_ids IS NULL OR cardinality(payout_ids) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Choose 1 to 200 payouts'; END IF;
  IF v_ref IS NULL OR char_length(v_ref) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'Enter the transfer reference from the bank or mobile money'; END IF;
  PERFORM app.staff_only('mark_payouts_paid', array_to_string(payout_ids, ','), jsonb_build_object('reference', v_ref,
    'total', (SELECT sum(amount_zmw) FROM seller_payouts WHERE id = ANY (payout_ids))));
  IF EXISTS (SELECT 1 FROM unnest(payout_ids) i WHERE NOT EXISTS (SELECT 1 FROM seller_payouts p WHERE p.id = i AND p.status = 'due')) THEN
    RAISE EXCEPTION 'Only payouts that are due can be marked paid';
  END IF;
  IF (SELECT count(DISTINCT seller_id) FROM seller_payouts WHERE id = ANY (payout_ids)) > 1 THEN RAISE EXCEPTION 'Mark one seller''s payouts at a time'; END IF;
  UPDATE seller_payouts SET status = 'paid', paid_at = now(), reference = v_ref WHERE id = ANY (payout_ids) AND status = 'due';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.staff_list(), public.staff_set_roles(text, text[]), public.staff_set_shop_settings(jsonb),
  public.staff_mark_payouts_paid(bigint[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_list(), public.staff_set_roles(text, text[]), public.staff_set_shop_settings(jsonb),
  public.staff_mark_payouts_paid(bigint[], text) TO authenticated;
COMMIT;
