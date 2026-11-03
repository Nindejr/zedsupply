-- Store teams: an owner invites people by email and gives each a role that matches their job.
-- Apply after 019. Every store permission check moves from "any member" to "a member whose role
-- allows it"; existing members keep owner rights, and the old 'staff' role becomes 'manager'.
--
--   owner     everything, including the team, payouts and store details
--   manager   store details, listings, prices, offers, promotions, deals, orders, shipments, complaints
--   listings  products, prices, stock, photos, offers and product questions
--   dispatch  orders, packing, shipments and delivery evidence
--   finance   orders, sales and payouts (view only)
BEGIN;

-- ---------- Roles ----------
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.seller_members'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%role%' LOOP
    EXECUTE format('ALTER TABLE seller_members DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
UPDATE seller_members SET role = 'manager' WHERE role = 'staff';
ALTER TABLE seller_members ADD CONSTRAINT seller_members_role_check
  CHECK (role IN ('owner', 'manager', 'listings', 'dispatch', 'finance'));
ALTER TABLE seller_members ADD COLUMN added_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION app.role_allows(member_role text, perm text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE perm
    WHEN 'team'       THEN member_role = 'owner'
    WHEN 'payouts'    THEN member_role IN ('owner', 'finance')
    WHEN 'store'      THEN member_role IN ('owner', 'manager')
    WHEN 'promotions' THEN member_role IN ('owner', 'manager')
    WHEN 'support'    THEN member_role IN ('owner', 'manager')
    WHEN 'sales'      THEN member_role IN ('owner', 'manager', 'finance')
    WHEN 'listings'   THEN member_role IN ('owner', 'manager', 'listings')
    WHEN 'fulfil'     THEN member_role IN ('owner', 'manager', 'dispatch')
    WHEN 'orders'     THEN member_role IN ('owner', 'manager', 'dispatch', 'finance')
    ELSE false END
$$;
CREATE FUNCTION app.seller_ids_for(perm text) RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.seller_id FROM seller_members m JOIN users u ON u.id = m.user_id
   WHERE u.auth_id = auth.uid() AND app.role_allows(m.role, perm)
$$;
CREATE FUNCTION app.seller_can(sid text, perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT sid IS NOT NULL AND sid IN (SELECT app.seller_ids_for(perm))
$$;

-- ---------- Permissions by role ----------
-- Any member still sees the store's unpublished listings and its performance figures (app.is_seller).
ALTER POLICY "Sellers add their own listings" ON products WITH CHECK (app.seller_can(seller_id, 'listings'));
ALTER POLICY "Sellers edit their own listings" ON products
  USING (app.seller_can(seller_id, 'listings')) WITH CHECK (app.seller_can(seller_id, 'listings'));
ALTER POLICY "Sellers delete unpublished listings" ON products
  USING (app.seller_can(seller_id, 'listings') AND status IN ('draft', 'pending'));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['product_options', 'product_option_values', 'product_variants', 'variant_option_values', 'product_components', 'product_images', 'price_tiers'] LOOP
    EXECUTE format('ALTER POLICY "Seller manages" ON public.%I USING (app.seller_can(app.product_seller(product_id), %L)) WITH CHECK (app.seller_can(app.product_seller(product_id), %L))', t, 'listings', 'listings');
  END LOOP;
END $$;
ALTER POLICY "Offers you made or received" ON price_commitments
  USING (buyer_id = app.user_id() OR app.seller_can(app.product_seller(product_id), 'listings') OR app.is_staff());
ALTER POLICY "Answer or withdraw offers" ON price_commitments
  USING (buyer_id = app.user_id() OR app.seller_can(app.product_seller(product_id), 'listings'))
  WITH CHECK (buyer_id = app.user_id() OR app.seller_can(app.product_seller(product_id), 'listings'));
ALTER POLICY "Sellers answer questions on their products" ON product_questions
  USING (app.seller_can(app.product_seller(product_id), 'listings')) WITH CHECK (app.seller_can(app.product_seller(product_id), 'listings'));

ALTER POLICY "Store members edit their store" ON sellers USING (app.seller_can(id, 'store')) WITH CHECK (app.seller_can(id, 'store'));
ALTER POLICY "Store members manage location" ON seller_locations
  USING (app.seller_can(seller_id, 'store')) WITH CHECK (app.seller_can(seller_id, 'store'));
ALTER POLICY "Store members manage delivery areas" ON seller_delivery_areas
  USING (app.seller_can(seller_id, 'store')) WITH CHECK (app.seller_can(seller_id, 'store'));

ALTER POLICY "Store members manage promotions" ON promotions
  USING (app.seller_can(seller_id, 'promotions')) WITH CHECK (app.seller_can(seller_id, 'promotions'));
ALTER POLICY "Store members manage promotion products" ON promotion_products
  USING (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id AND app.seller_can(p.seller_id, 'promotions')))
  WITH CHECK (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id AND app.seller_can(p.seller_id, 'promotions')));
ALTER POLICY "Store members manage promotion areas" ON promotion_areas
  USING (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id AND app.seller_can(p.seller_id, 'promotions')))
  WITH CHECK (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id AND app.seller_can(p.seller_id, 'promotions')));
ALTER POLICY "Store members manage deals" ON deals
  USING (app.seller_can(app.product_seller(product_id), 'promotions')) WITH CHECK (app.seller_can(app.product_seller(product_id), 'promotions'));

-- Orders carry the buyer's name, phone and address: only roles that work with orders see them
CREATE OR REPLACE FUNCTION app.order_has_seller(oid bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = oid AND p.seller_id IN (SELECT app.seller_ids_for('orders')))
$$;
ALTER POLICY "Items you bought or sold" ON order_items
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id())
         OR app.seller_can(app.product_seller(product_id), 'orders') OR app.is_staff());
ALTER POLICY "Shipment parties read" ON shipment_events USING (
  app.is_staff() OR app.seller_can(seller_id, 'orders') OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id()));

ALTER POLICY "Your complaints, or shared ones about your store" ON complaints
  USING (user_id = app.user_id() OR (share_with_seller AND app.seller_can(seller_id, 'support')) OR app.is_staff());
ALTER POLICY "Reply as the buyer or the seller" ON complaint_messages
  WITH CHECK (EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id AND (
    (author = 'buyer' AND c.user_id = app.user_id()) OR (author = 'seller' AND c.share_with_seller AND app.seller_can(c.seller_id, 'support')))));

ALTER POLICY "Your store's payouts" ON seller_payouts USING (app.seller_can(seller_id, 'payouts') OR app.is_staff());

DROP POLICY "Stores upload to their own folder" ON storage.objects;
CREATE POLICY "Stores upload to their own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT app.seller_ids_for('listings')));
DROP POLICY "Operators upload delivery evidence" ON storage.objects;
CREATE POLICY "Operators upload delivery evidence" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'delivery-proofs' AND (storage.foldername(name))[1] = auth.uid()::text
  AND (app.is_staff() OR EXISTS (SELECT 1 FROM app.seller_ids_for('fulfil'))));

CREATE OR REPLACE FUNCTION app.guard_commitment_status() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR app.is_staff() OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.buyer_id = app.user_id() AND NEW.status = 'withdrawn' THEN RETURN NEW; END IF;
  IF app.seller_can(app.product_seller(OLD.product_id), 'listings') AND NEW.status IN ('accepted', 'declined') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'You can''t set this offer to %', NEW.status;
END $$;

CREATE OR REPLACE FUNCTION public.record_shipment(order_ref text, store_id text, new_status text,
  tracking text DEFAULT NULL, message text DEFAULT NULL, evidence text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders; last_status text; event_id bigint;
BEGIN
  IF app.user_id() IS NULL OR NOT (app.is_staff() OR app.seller_can(store_id, 'fulfil')) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO o FROM orders WHERE ref = order_ref FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id AND p.seller_id = store_id) THEN RAISE EXCEPTION 'No order for this store'; END IF;
  IF o.status NOT IN ('confirmed','dispatched') THEN RAISE EXCEPTION 'Only confirmed orders can be fulfilled'; END IF;
  SELECT status INTO last_status FROM shipment_events WHERE order_id = o.id AND seller_id = store_id ORDER BY id DESC LIMIT 1;
  IF ((new_status = 'packed' AND last_status IS NULL)
    OR (new_status = 'dispatched' AND last_status IN ('packed','delivery_failed') AND o.fulfilment = 'delivery')
    OR (new_status IN ('delivered','delivery_failed') AND last_status = 'dispatched')
    OR (new_status = 'collected' AND last_status = 'packed' AND o.fulfilment IN ('collection','pickup'))) IS NOT TRUE THEN
    RAISE EXCEPTION 'That shipment status does not follow the last recorded event';
  END IF;
  IF new_status IN ('delivered','collected') THEN
    IF evidence IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'delivery-proofs' AND name = evidence
      AND ((storage.foldername(name))[1] = auth.uid()::text OR app.is_staff())) THEN RAISE EXCEPTION 'Upload private delivery evidence first'; END IF;
  END IF;
  INSERT INTO shipment_events(order_id,seller_id,status,tracking_ref,note,proof_path,created_by)
    VALUES (o.id,store_id,new_status,tracking,message,evidence,app.user_id()) RETURNING id INTO event_id;
  IF new_status = 'dispatched' THEN UPDATE orders SET status = 'dispatched', dispatched_at = coalesce(dispatched_at,now()) WHERE id = o.id; END IF;
  IF NOT EXISTS (SELECT 1 FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id AND NOT EXISTS (
    SELECT 1 FROM shipment_events e WHERE e.order_id = o.id AND e.seller_id = p.seller_id AND e.status IN ('delivered','collected'))) THEN
    PERFORM app.mark_delivered(o.id);
  END IF;
  RETURN event_id;
END $$;

CREATE OR REPLACE FUNCTION public.seller_sales(sid text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb;
BEGIN
  IF NOT (app.seller_can(sid, 'sales') OR app.is_staff()) THEN RAISE EXCEPTION 'Your role on this store can''t see sales'; END IF;
  SELECT jsonb_build_object(
    'sales_30d', coalesce(sum(oi.unit_price_zmw * oi.quantity) FILTER (WHERE o.created_at > now() - interval '30 days'), 0),
    'orders_30d', count(DISTINCT o.id) FILTER (WHERE o.created_at > now() - interval '30 days'),
    'units_30d', coalesce(sum(oi.quantity) FILTER (WHERE o.created_at > now() - interval '30 days'), 0),
    'payouts_held', (SELECT coalesce(sum(amount_zmw), 0) FROM seller_payouts WHERE seller_id = sid AND status = 'held'),
    'payouts_due', (SELECT coalesce(sum(amount_zmw), 0) FROM seller_payouts WHERE seller_id = sid AND status = 'due'),
    'low_stock', (SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', id, 'title', title, 'stock', stock_qty)), '[]') FROM products
                   WHERE seller_id = sid AND status = 'active' AND stock_qty IS NOT NULL AND stock_qty <= 3))
  INTO r
  FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
  WHERE p.seller_id = sid AND o.status <> 'cancelled';
  RETURN r;
END $$;

-- ---------- Invitations and the team log ----------
-- An invitation names an email; only the account that has confirmed that email can accept it.
CREATE TABLE seller_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    text NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$' AND email = lower(email)),
  role         text NOT NULL CHECK (role IN ('owner', 'manager', 'listings', 'dispatch', 'finance')),
  invited_by   bigint REFERENCES users (id) ON DELETE SET NULL,
  state        text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '7 days',
  responded_at timestamptz
);
CREATE UNIQUE INDEX seller_invites_pending_key ON seller_invites (seller_id, email) WHERE state = 'pending';
CREATE INDEX seller_invites_email_idx ON seller_invites (email) WHERE state = 'pending';

CREATE TABLE seller_team_events (
  id         bigserial PRIMARY KEY,
  seller_id  text NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  actor_id   bigint REFERENCES users (id) ON DELETE SET NULL,
  action     text NOT NULL CHECK (action IN ('invited', 'invite_cancelled', 'joined', 'declined', 'role_changed', 'removed', 'left')),
  subject    text NOT NULL CHECK (char_length(subject) <= 254),
  role       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_team_events_store_idx ON seller_team_events (seller_id, created_at DESC);

-- Read and changed only through the functions below
ALTER TABLE seller_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_team_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON seller_invites, seller_team_events FROM anon, authenticated;
GRANT ALL ON seller_invites, seller_team_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE seller_team_events_id_seq TO service_role;

CREATE FUNCTION app.team_log(sid text, act text, who text, member_role text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO seller_team_events (seller_id, actor_id, action, subject, role) VALUES (sid, app.user_id(), act, left(who, 254), member_role)
$$;
CREATE FUNCTION app.member_label(uid bigint) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(nullif(name, ''), email, 'Team member') FROM users WHERE id = uid
$$;
-- Owners manage the team; Zed Supply staff can too, and their changes are also kept in staff_actions.
-- Locks the store so two changes can't each leave it without an owner or over the size limit.
CREATE FUNCTION app.team_manager(sid text, act text, detail jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app.user_id() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  PERFORM 1 FROM sellers WHERE id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such store'; END IF;
  IF app.seller_can(sid, 'team') THEN RETURN; END IF;
  IF app.is_staff() THEN PERFORM app.staff_only(act, sid, detail); RETURN; END IF;
  RAISE EXCEPTION 'Only the store''s owners can manage its team' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION app.team_log(text, text, text, text), app.member_label(bigint), app.team_manager(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- The team, its open invitations and recent changes. Every member sees who is on the team;
-- emails, invitations and the log are for owners.
CREATE FUNCTION public.seller_team(sid text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me bigint := app.user_id(); my_role text; full_view boolean;
BEGIN
  SELECT role INTO my_role FROM seller_members WHERE seller_id = sid AND user_id = me;
  IF me IS NULL OR (my_role IS NULL AND NOT app.is_staff()) THEN RAISE EXCEPTION 'Only the store''s members can see this'; END IF;
  full_view := my_role = 'owner' OR app.is_staff();
  RETURN jsonb_build_object(
    'store', (SELECT jsonb_build_object('id', id, 'name', name) FROM sellers WHERE id = sid),
    'my_role', my_role,
    'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', u.id, 'name', app.member_label(u.id), 'role', m.role, 'you', u.id = me,
                  'email', CASE WHEN full_view OR u.id = me THEN u.email END, 'added_at', m.added_at)
                  ORDER BY array_position(ARRAY['owner', 'manager', 'listings', 'dispatch', 'finance'], m.role), app.member_label(u.id)), '[]')
                FROM seller_members m JOIN users u ON u.id = m.user_id WHERE m.seller_id = sid),
    'invites', CASE WHEN full_view THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'role', role, 'expires_at', expires_at) ORDER BY created_at), '[]')
                FROM seller_invites WHERE seller_id = sid AND state = 'pending' AND expires_at > now()) ELSE '[]' END,
    'log', CASE WHEN full_view THEN (SELECT coalesce(jsonb_agg(row_to_json(l)::jsonb ORDER BY l.created_at DESC), '[]') FROM (
                SELECT e.action, e.subject, e.role, e.created_at, coalesce(app.member_label(e.actor_id), 'Zed Supply') AS actor
                FROM seller_team_events e WHERE e.seller_id = sid ORDER BY e.created_at DESC, e.id DESC LIMIT 50) l) ELSE '[]' END);
END $$;

-- Invites someone, or re-sends a pending invitation with a new role and a fresh week to accept.
-- At most 20 people per store, counting open invitations, and 30 invitations a day.
CREATE FUNCTION public.seller_invite(sid text, invitee_email text, member_role text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text := lower(btrim(invitee_email)); v_id uuid;
BEGIN
  PERFORM app.team_manager(sid, 'team_invite', jsonb_build_object('email', v_email, 'role', member_role));
  IF v_email IS NULL OR char_length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email address'; END IF;
  IF member_role IS NULL OR member_role NOT IN ('owner', 'manager', 'listings', 'dispatch', 'finance') THEN RAISE EXCEPTION 'Choose a role'; END IF;
  IF EXISTS (SELECT 1 FROM seller_members m JOIN users u ON u.id = m.user_id WHERE m.seller_id = sid AND lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'That person is already on the team. Change their role instead.';
  END IF;
  UPDATE seller_invites SET state = 'expired' WHERE seller_id = sid AND state = 'pending' AND expires_at <= now();
  UPDATE seller_invites SET role = member_role, expires_at = now() + interval '7 days'
   WHERE seller_id = sid AND email = v_email AND state = 'pending' RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    IF (SELECT count(*) FROM seller_members WHERE seller_id = sid) + (SELECT count(*) FROM seller_invites WHERE seller_id = sid AND state = 'pending') >= 20 THEN
      RAISE EXCEPTION 'A store can have up to 20 people, counting open invitations';
    END IF;
    IF (SELECT count(*) FROM seller_team_events WHERE seller_id = sid AND action = 'invited' AND created_at > now() - interval '1 day') >= 30 THEN
      RAISE EXCEPTION 'Too many invitations today. Try again tomorrow.';
    END IF;
    INSERT INTO seller_invites (seller_id, email, role, invited_by) VALUES (sid, v_email, member_role, app.user_id()) RETURNING id INTO v_id;
  END IF;
  PERFORM app.team_log(sid, 'invited', v_email, member_role);
  RETURN v_id;
END $$;

CREATE FUNCTION public.seller_cancel_invite(invite uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i seller_invites;
BEGIN
  SELECT * INTO i FROM seller_invites WHERE id = invite;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open invitation'; END IF;
  PERFORM app.team_manager(i.seller_id, 'team_cancel_invite', jsonb_build_object('email', i.email));
  UPDATE seller_invites SET state = 'cancelled', responded_at = now() WHERE id = invite AND state = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'No open invitation'; END IF;
  PERFORM app.team_log(i.seller_id, 'invite_cancelled', i.email, i.role);
END $$;

-- Invitations waiting for the signed-in account's confirmed email
CREATE FUNCTION public.my_seller_invites() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'store', s.name, 'role', i.role, 'expires_at', i.expires_at) ORDER BY i.created_at), '[]')
    FROM seller_invites i JOIN sellers s ON s.id = i.seller_id
   WHERE i.state = 'pending' AND i.expires_at > now()
     AND i.email = (SELECT lower(email) FROM users WHERE id = app.user_id() AND email IS NOT NULL)
$$;

CREATE FUNCTION public.seller_respond_invite(invite uuid, accept boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me bigint := app.user_id(); i seller_invites;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO i FROM seller_invites WHERE id = invite;
  IF NOT FOUND OR i.email IS DISTINCT FROM (SELECT lower(email) FROM users WHERE id = me) THEN RAISE EXCEPTION 'No invitation for this account'; END IF;
  PERFORM 1 FROM sellers WHERE id = i.seller_id FOR UPDATE;
  SELECT * INTO i FROM seller_invites WHERE id = invite FOR UPDATE;
  IF i.state <> 'pending' OR i.expires_at <= now() THEN RAISE EXCEPTION 'This invitation has expired or was withdrawn. Ask the store owner to invite you again.'; END IF;
  IF accept THEN
    IF EXISTS (SELECT 1 FROM seller_members WHERE seller_id = i.seller_id AND user_id = me) THEN RAISE EXCEPTION 'You are already on this store''s team'; END IF;
    INSERT INTO seller_members (seller_id, user_id, role) VALUES (i.seller_id, me, i.role);
  END IF;
  UPDATE seller_invites SET state = CASE WHEN accept THEN 'accepted' ELSE 'declined' END, responded_at = now() WHERE id = invite;
  PERFORM app.team_log(i.seller_id, CASE WHEN accept THEN 'joined' ELSE 'declined' END, coalesce(app.member_label(me), i.email), i.role);
  RETURN i.seller_id;
END $$;

-- A store always keeps at least one owner
CREATE FUNCTION public.seller_set_member_role(sid text, member bigint, member_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text;
BEGIN
  PERFORM app.team_manager(sid, 'team_set_role', jsonb_build_object('member', member, 'role', member_role));
  IF member_role IS NULL OR member_role NOT IN ('owner', 'manager', 'listings', 'dispatch', 'finance') THEN RAISE EXCEPTION 'Choose a role'; END IF;
  SELECT role INTO v_role FROM seller_members WHERE seller_id = sid AND user_id = member;
  IF NOT FOUND THEN RAISE EXCEPTION 'That person is not on this team'; END IF;
  IF v_role = member_role THEN RETURN; END IF;
  IF v_role = 'owner' AND NOT EXISTS (SELECT 1 FROM seller_members WHERE seller_id = sid AND role = 'owner' AND user_id <> member) THEN
    RAISE EXCEPTION 'A store needs at least one owner. Make someone else an owner first.';
  END IF;
  UPDATE seller_members SET role = member_role WHERE seller_id = sid AND user_id = member;
  PERFORM app.team_log(sid, 'role_changed', app.member_label(member), member_role);
END $$;

-- Owners remove anyone; any member can leave
CREATE FUNCTION public.seller_remove_member(sid text, member bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me bigint := app.user_id(); v_role text;
BEGIN
  IF me IS NOT NULL AND member = me THEN
    PERFORM 1 FROM sellers WHERE id = sid FOR UPDATE;
  ELSE
    PERFORM app.team_manager(sid, 'team_remove', jsonb_build_object('member', member));
  END IF;
  SELECT role INTO v_role FROM seller_members WHERE seller_id = sid AND user_id = member;
  IF NOT FOUND THEN RAISE EXCEPTION 'That person is not on this team'; END IF;
  IF v_role = 'owner' AND NOT EXISTS (SELECT 1 FROM seller_members WHERE seller_id = sid AND role = 'owner' AND user_id <> member) THEN
    RAISE EXCEPTION 'A store needs at least one owner. Make someone else an owner first.';
  END IF;
  PERFORM app.team_log(sid, CASE WHEN member = me THEN 'left' ELSE 'removed' END, app.member_label(member), v_role);
  DELETE FROM seller_members WHERE seller_id = sid AND user_id = member;
END $$;

REVOKE ALL ON FUNCTION public.seller_team(text), public.seller_invite(text, text, text), public.seller_cancel_invite(uuid),
  public.my_seller_invites(), public.seller_respond_invite(uuid, boolean), public.seller_set_member_role(text, bigint, text),
  public.seller_remove_member(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_team(text), public.seller_invite(text, text, text), public.seller_cancel_invite(uuid),
  public.my_seller_invites(), public.seller_respond_invite(uuid, boolean), public.seller_set_member_role(text, bigint, text),
  public.seller_remove_member(text, bigint) TO authenticated, service_role;
COMMIT;
