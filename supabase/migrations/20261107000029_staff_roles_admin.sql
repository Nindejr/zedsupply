-- Staff roles, a second sign-in step for staff, and the admin panel's server functions.
--
-- 1. Roles. A staff account (users.is_staff) has one or more roles: owner, operations, support,
--    catalogue or finance. Every staff action already passes through app.staff_only(), which now
--    also checks the action is one the person's roles allow; the owner may take every action.
--    Existing staff become owners, so nobody is locked out.
-- 2. Second step. While shop_settings.staff_mfa_required is on (the default), app.is_staff() is
--    true only for a session that completed an authenticator-app code (Supabase's aal2). That
--    covers staff reads (row-level security) as well as actions, so an email account alone
--    can't open staff data. No staff action is possible before the second step.
-- 3. The admin panel (/admin/): who you are (staff_me), what needs attention (staff_dashboard),
--    setting an order's delivery fee, the message queue with retry (handover codes are never
--    shown to staff), and the audit log.
BEGIN;

-- ---------- 1. Roles ----------
CREATE TABLE staff_roles (
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'operations', 'support', 'catalogue', 'finance')),
  granted_by bigint REFERENCES users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);
ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see the roles" ON staff_roles FOR SELECT TO authenticated USING (app.is_staff());
REVOKE ALL ON staff_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON staff_roles TO authenticated;
GRANT ALL ON staff_roles TO service_role;
INSERT INTO staff_roles (user_id, role) SELECT id, 'owner' FROM users WHERE is_staff ON CONFLICT DO NOTHING;

-- Losing staff status (or the sign-in identity) removes every role
CREATE FUNCTION app.drop_staff_roles() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM staff_roles WHERE user_id = NEW.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.drop_staff_roles() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER users_drop_staff_roles AFTER UPDATE OF is_staff ON users FOR EACH ROW
  WHEN (OLD.is_staff AND NOT NEW.is_staff) EXECUTE FUNCTION app.drop_staff_roles();

-- ---------- 2. The second sign-in step ----------
ALTER TABLE shop_settings ADD COLUMN staff_mfa_required boolean NOT NULL DEFAULT true;
-- The session's assurance level, from the sign-in token (aal1: email code; aal2: plus an app code)
CREATE FUNCTION app.session_aal() RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;
CREATE OR REPLACE FUNCTION app.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT is_staff FROM users WHERE auth_id = auth.uid()), false)
    AND (NOT coalesce((SELECT staff_mfa_required FROM shop_settings), true) OR app.session_aal() = 'aal2')
$$;

-- The roles allowed to take each action (the owner may take every one). Anything not listed,
-- including actions added later, is owner-only until it's given a role here.
CREATE FUNCTION app.action_roles(p_action text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_action IN ('order_step', 'decide_cancellation', 'set_delivery_fee', 'save_delivery_rate', 'delete_delivery_rate',
      'set_delivery_settings', 'review_rider_application', 'retry_notification') THEN ARRAY['operations']
    WHEN p_action IN ('decide_complaint', 'decide_return', 'assign support case', 'hide_review', 'hide_question') THEN ARRAY['support']
    WHEN p_action IN ('moderate_listing', 'verify_seller', 'review_seller_application', 'approve_seller_application') THEN ARRAY['catalogue']
    WHEN p_action IN ('close_payment_attempt') THEN ARRAY['finance']
    ELSE ARRAY[]::text[] END
$$;
CREATE FUNCTION app.my_roles() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(role ORDER BY role), '{}') FROM staff_roles WHERE user_id = app.user_id() AND app.is_staff()
$$;
CREATE FUNCTION app.has_role(p_role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.is_staff() AND EXISTS (SELECT 1 FROM staff_roles WHERE user_id = app.user_id() AND role IN ('owner', p_role))
$$;
CREATE OR REPLACE FUNCTION app.staff_only(p_action text, p_target text, p_detail jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app.is_staff() THEN
    IF coalesce((SELECT is_staff FROM users WHERE auth_id = auth.uid()), false) THEN
      RAISE EXCEPTION 'Confirm it''s you with your authenticator app code first' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Staff only' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff_roles WHERE user_id = app.user_id() AND (role = 'owner' OR role = ANY (app.action_roles(p_action)))) THEN
    RAISE EXCEPTION 'Your staff role doesn''t allow this' USING ERRCODE = '42501';
  END IF;
  INSERT INTO staff_actions (staff_id, action, target, detail) VALUES (app.user_id(), p_action, p_target, p_detail);
END $$;
REVOKE ALL ON FUNCTION app.session_aal(), app.action_roles(text), app.my_roles(), app.has_role(text) FROM PUBLIC, anon, authenticated;

-- ---------- 3. The admin panel ----------
-- Who's signed in, for the admin page: staff or not, roles, and whether the second step is done
CREATE FUNCTION public.staff_me() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'staff', coalesce((SELECT is_staff FROM users WHERE auth_id = auth.uid()), false),
    'mfa_required', coalesce((SELECT staff_mfa_required FROM shop_settings), true),
    'aal', app.session_aal(), 'ready', app.is_staff(),
    'roles', CASE WHEN app.is_staff() THEN to_jsonb(app.my_roles()) ELSE '[]'::jsonb END,
    'name', (SELECT name FROM users WHERE auth_id = auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.staff_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_me() TO authenticated;

-- What needs attention, in counts (Zambian dates for "today")
CREATE FUNCTION public.staff_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE today date := (now() AT TIME ZONE 'Africa/Lusaka')::date;
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'Staff only' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'orders_today', (SELECT count(*) FROM orders WHERE (created_at AT TIME ZONE 'Africa/Lusaka')::date = today),
    'sales_today', (SELECT coalesce(sum(total_zmw + coalesce(delivery_zmw, 0)), 0) FROM orders WHERE (created_at AT TIME ZONE 'Africa/Lusaka')::date = today AND status <> 'cancelled'),
    'to_confirm', (SELECT count(*) FROM orders WHERE status = 'placed'),
    'to_dispatch', (SELECT count(*) FROM orders WHERE status = 'confirmed'),
    'in_transit', (SELECT count(*) FROM orders WHERE status = 'dispatched'),
    'fee_to_quote', (SELECT count(*) FROM orders WHERE fulfilment = 'delivery' AND delivery_zmw IS NULL AND status IN ('placed', 'confirmed')),
    'payments_to_check', (SELECT count(*) FROM payment_attempts WHERE state = 'unknown' OR (state IN ('created', 'submitted') AND created_at < now() - interval '30 minutes')),
    'cancellations', (SELECT count(*) FROM order_cancellations WHERE status = 'requested'),
    'returns', (SELECT count(*) FROM return_requests WHERE status IN ('requested', 'approved', 'collected', 'received')),
    'complaints', (SELECT count(*) FROM complaints WHERE status NOT IN ('resolved', 'closed')),
    'seller_applications', (SELECT count(*) FROM seller_applications WHERE status IN ('new', 'review')),
    'rider_applications', (SELECT count(*) FROM rider_applications WHERE status IN ('new', 'review', 'vetting')),
    'listings_to_review', (SELECT count(*) FROM products WHERE status = 'pending'),
    'messages_failed', (SELECT count(*) FROM notifications WHERE status = 'failed'),
    'messages_waiting', (SELECT count(*) FROM notifications WHERE status IN ('queued', 'processing')),
    'staff_actions_today', (SELECT count(*) FROM staff_actions WHERE (created_at AT TIME ZONE 'Africa/Lusaka')::date = today));
END $$;
REVOKE ALL ON FUNCTION public.staff_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_dashboard() TO authenticated;

-- Quote the delivery fee for an order waiting for one (heavy items, places with no rate)
CREATE FUNCTION public.staff_set_delivery_fee(order_ref text, fee numeric, note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders;
BEGIN
  PERFORM app.staff_only('set_delivery_fee', order_ref, jsonb_build_object('fee', fee, 'note', note));
  IF fee IS NULL OR fee < 0 OR fee > 100000 OR fee <> round(fee, 2) THEN RAISE EXCEPTION 'Enter a delivery fee from K0 to K100,000'; END IF;
  SELECT * INTO o FROM orders WHERE ref = upper(btrim(order_ref)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No order with that reference'; END IF;
  IF o.fulfilment <> 'delivery' THEN RAISE EXCEPTION 'This order isn''t delivered'; END IF;
  IF o.status NOT IN ('placed', 'confirmed') THEN RAISE EXCEPTION 'The fee can be set only before dispatch'; END IF;
  IF o.paid_zmw > 0 THEN RAISE EXCEPTION 'Payment has started: change the fee with the buyer and finance'; END IF;
  UPDATE orders SET delivery_zmw = fee, delivery_source = 'staff' WHERE id = o.id;
END $$;

-- The message queue. Handover codes are never shown to staff: only the buyer may read them.
CREATE FUNCTION public.staff_notifications(p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_before bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (app.has_role('operations') OR app.has_role('support')) THEN RAISE EXCEPTION 'Your staff role doesn''t allow this' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'channel', n.channel, 'to', n.to_address, 'template', n.template, 'status', n.status,
      'attempts', n.attempts, 'last_error', n.last_error, 'created_at', n.created_at, 'sent_at', n.sent_at, 'order_ref', o.ref,
      'payload', CASE WHEN n.template = 'handover_code' THEN n.payload - 'code' ELSE n.payload END) ORDER BY n.id DESC), '[]')
    FROM (SELECT * FROM notifications WHERE (p_status IS NULL OR status = p_status) AND (p_before IS NULL OR id < p_before)
          ORDER BY id DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) n
    LEFT JOIN orders o ON o.id = n.order_id);
END $$;
CREATE FUNCTION public.staff_retry_notification(notification_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('retry_notification', notification_id::text, '{}');
  UPDATE notifications SET status = 'queued', attempts = 0, last_error = NULL, claimed_at = NULL, claim_token = NULL
   WHERE id = notification_id AND status IN ('failed', 'skipped');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only failed or skipped messages can be sent again'; END IF;
END $$;

-- The audit log: the owner sees everyone's actions, others their own
CREATE FUNCTION public.staff_audit(search text DEFAULT NULL, p_before bigint DEFAULT NULL, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE q text := nullif(btrim(left(search, 80)), '');
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'Staff only' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'target', a.target, 'detail', a.detail,
      'at', a.created_at, 'by', u.name, 'by_email', u.email) ORDER BY a.id DESC), '[]')
    FROM (SELECT * FROM staff_actions s
          WHERE (app.has_role('owner') OR s.staff_id = app.user_id())
            AND (p_before IS NULL OR s.id < p_before)
            AND (q IS NULL OR s.action ILIKE '%' || q || '%' OR s.target ILIKE '%' || q || '%'
                 OR EXISTS (SELECT 1 FROM users x WHERE x.id = s.staff_id AND (x.name ILIKE '%' || q || '%' OR x.email ILIKE '%' || q || '%')))
          ORDER BY s.id DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) a
    LEFT JOIN users u ON u.id = a.staff_id);
END $$;

REVOKE ALL ON FUNCTION public.staff_set_delivery_fee(text, numeric, text), public.staff_notifications(text, integer, bigint),
  public.staff_retry_notification(bigint), public.staff_audit(text, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_delivery_fee(text, numeric, text), public.staff_notifications(text, integer, bigint),
  public.staff_retry_notification(bigint), public.staff_audit(text, bigint, integer) TO authenticated;
COMMIT;
