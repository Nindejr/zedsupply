-- Marketplace features (PostgreSQL 15+). Apply after 001–014.
-- Buyer protection (Zed Supply holds the payment until the buyer confirms delivery, then pays
-- the seller), payments recorded from the provider's webhook, pay on delivery with limits,
-- lay-by, bulk prices, pickup points, seller trust and performance figures, a notification
-- outbox for WhatsApp and SMS, stock and price alerts, saved searches, review photos,
-- questions and answers, "bought together", staff actions with an audit log, and seller sales.
-- Everything that needs an outside account (payments, WhatsApp, SMS) waits in tables here
-- until the server functions in supabase/functions are given their keys.
BEGIN;

-- ---------- Settings ----------
ALTER TABLE shop_settings
  ADD COLUMN cod_max_zmw            numeric(12,2) NOT NULL DEFAULT 1500 CHECK (cod_max_zmw >= 0),
  ADD COLUMN cod_min_delivered      smallint NOT NULL DEFAULT 1 CHECK (cod_min_delivered >= 0),
  ADD COLUMN layby_enabled          boolean NOT NULL DEFAULT false,
  ADD COLUMN layby_deposit_pct      smallint NOT NULL DEFAULT 20 CHECK (layby_deposit_pct BETWEEN 1 AND 100),
  ADD COLUMN layby_weeks            smallint NOT NULL DEFAULT 8 CHECK (layby_weeks BETWEEN 1 AND 26),
  ADD COLUMN payout_hold_days       smallint NOT NULL DEFAULT 3 CHECK (payout_hold_days BETWEEN 0 AND 30),
  ADD COLUMN commission_pct         numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct < 100);

-- ---------- Orders: dispatch, payment plan, pickup points ----------
CREATE TABLE pickup_points (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  partner     text CHECK (char_length(partner) <= 80),
  town        text NOT NULL CHECK (char_length(btrim(town)) BETWEEN 1 AND 60),
  province_id text NOT NULL REFERENCES provinces (id),
  address     text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 1 AND 200),
  hours       text CHECK (char_length(hours) <= 100),
  active      boolean NOT NULL DEFAULT true
);
CREATE INDEX pickup_points_town_idx ON pickup_points (province_id, town) WHERE active;

ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('placed', 'confirmed', 'dispatched', 'delivered', 'cancelled'));
ALTER TABLE orders DROP CONSTRAINT orders_fulfilment_check;
ALTER TABLE orders ADD CONSTRAINT orders_fulfilment_check CHECK (fulfilment IN ('delivery', 'collection', 'pickup'));
ALTER TABLE orders DROP CONSTRAINT orders_check2;
ALTER TABLE orders ADD CONSTRAINT orders_check2 CHECK (fulfilment IN ('collection', 'pickup') OR collection_point IS NULL);
ALTER TABLE orders
  ADD COLUMN pickup_point_id text REFERENCES pickup_points (id),
  ADD COLUMN payment_plan    text NOT NULL DEFAULT 'full' CHECK (payment_plan IN ('full', 'layby')),
  ADD COLUMN deposit_zmw     numeric(12,2) CHECK (deposit_zmw >= 0),
  ADD COLUMN layby_due       date,
  ADD COLUMN paid_zmw        numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_zmw >= 0),
  ADD COLUMN payment_status  text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'part', 'paid', 'refunded')),
  ADD COLUMN dispatched_at   timestamptz,
  ADD CONSTRAINT orders_pickup_point CHECK ((fulfilment = 'pickup') = (pickup_point_id IS NOT NULL)),
  ADD CONSTRAINT orders_layby CHECK ((payment_plan = 'layby') = (layby_due IS NOT NULL AND deposit_zmw IS NOT NULL));
CREATE INDEX orders_status_idx ON orders (status, created_at);
CREATE INDEX orders_layby_idx ON orders (layby_due) WHERE payment_plan = 'layby' AND status <> 'cancelled';
ALTER TABLE order_items DROP CONSTRAINT order_items_price_source_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_price_source_check CHECK (price_source IN ('fixed', 'deal', 'promotion', 'commit', 'bulk'));
ALTER TABLE sellers ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Bulk prices: buy at least min_qty and each costs price_zmw
CREATE TABLE price_tiers (
  product_id text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  min_qty    smallint NOT NULL CHECK (min_qty BETWEEN 2 AND 99),
  price_zmw  numeric(12,2) NOT NULL CHECK (price_zmw > 0 AND price_zmw < 'Infinity'),
  PRIMARY KEY (product_id, min_qty)
);
CREATE FUNCTION app.check_price_tier() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.price_zmw >= (SELECT price_zmw FROM products WHERE id = NEW.product_id) THEN
    RAISE EXCEPTION 'A bulk price must be lower than the normal price';
  END IF;
  IF (SELECT count(*) FROM price_tiers WHERE product_id = NEW.product_id AND min_qty <> NEW.min_qty) >= 4 THEN
    RAISE EXCEPTION 'A product has up to 4 bulk prices';
  END IF;
  IF EXISTS (SELECT 1 FROM price_tiers WHERE product_id = NEW.product_id
             AND ((min_qty > NEW.min_qty AND price_zmw >= NEW.price_zmw) OR (min_qty < NEW.min_qty AND price_zmw <= NEW.price_zmw))) THEN
    RAISE EXCEPTION 'Bigger quantities must have lower prices';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER price_tiers_check BEFORE INSERT OR UPDATE ON price_tiers FOR EACH ROW EXECUTE FUNCTION app.check_price_tier();

-- ---------- Placing an order (014, plus bulk prices, pickup points, pay on delivery, lay-by) ----------
-- Extra fields in p: payment_plan ('full' or 'layby'), pickup_point_id.
-- Pay on delivery ('cod') is limited to totals up to cod_max_zmw, for signed-in buyers with at
-- least cod_min_delivered delivered orders. Lay-by takes a deposit and reserves the stock until
-- layby_due; app.expire_laybys() cancels unpaid ones, which returns the stock.
CREATE OR REPLACE FUNCTION app.place_order(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ref text := p ->> 'ref';
  v_user bigint := (p ->> 'user_id')::bigint;
  v_prov text := nullif(p ->> 'buyer_province_id', '');
  v_plan text := coalesce(nullif(p ->> 'payment_plan', ''), 'full');
  v_pickup pickup_points;
  o orders; it record; pr products; va product_variants; cm price_commitments; s shop_settings;
  v_order bigint; v_item bigint; base numeric; unit numeric; promo_off smallint; deal_price numeric; tier_price numeric;
  src text; adds numeric; subtotal numeric := 0; discount numeric := 0; total numeric; vat numeric := 0;
  taxable numeric := 0; taxable_total numeric; deposit numeric;
  vc vouchers; n_items int := jsonb_array_length(coalesce(p -> 'items', '[]'));
  v_today date := (now() AT TIME ZONE 'Africa/Lusaka')::date;   -- promotions and deals run on Zambian dates
BEGIN
  IF v_ref IS NULL OR v_ref !~ '^ZS-[A-Z0-9]{4,12}$' THEN RAISE EXCEPTION 'A valid order reference is needed'; END IF;
  IF n_items NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'An order has 1 to 50 lines'; END IF;
  SELECT * INTO s FROM shop_settings;

  -- Same reference again (double click, retry): return the first order, never a second one
  SELECT * INTO o FROM orders WHERE ref = v_ref;
  IF FOUND THEN
    IF o.user_id IS DISTINCT FROM v_user OR (v_user IS NULL AND
       o.recipient_phone IS DISTINCT FROM nullif(btrim(p ->> 'recipient_phone'), '')) THEN RAISE EXCEPTION 'This order reference is already used'; END IF;
    RETURN jsonb_build_object('order_id', o.id, 'ref', o.ref, 'subtotal', o.subtotal_zmw, 'discount', o.discount_zmw,
      'vat', o.vat_zmw, 'total', o.total_zmw, 'deposit', o.deposit_zmw, 'replayed', true);
  END IF;
  IF v_plan = 'layby' AND NOT s.layby_enabled THEN RAISE EXCEPTION 'Lay-by isn''t available yet'; END IF;
  IF nullif(p ->> 'pickup_point_id', '') IS NOT NULL THEN
    SELECT * INTO v_pickup FROM pickup_points WHERE id = p ->> 'pickup_point_id' AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'That pickup point isn''t available'; END IF;
  END IF;
  BEGIN
    INSERT INTO orders (user_id, ref, status, contact_name, recipient_phone, fulfilment, buyer_town, buyer_province_id,
      collection_point, pickup_point_id, deliver_to, address_id, delivery_scope, courier_id, preferred_date, preferred_slot, is_gift,
      gift_message, hide_prices, payment_method, notes)
    VALUES (v_user, v_ref, 'placed', nullif(btrim(p ->> 'contact_name'), ''), nullif(btrim(p ->> 'recipient_phone'), ''),
      CASE WHEN v_pickup.id IS NOT NULL THEN 'pickup' ELSE coalesce(p ->> 'fulfilment', 'delivery') END,
      nullif(btrim(p ->> 'buyer_town'), ''), v_prov,
      CASE WHEN v_pickup.id IS NOT NULL THEN left(v_pickup.name || ': ' || v_pickup.address, 200) ELSE nullif(btrim(p ->> 'collection_point'), '') END,
      v_pickup.id, nullif(btrim(p ->> 'deliver_to'), ''), (p ->> 'address_id')::bigint,
      p ->> 'delivery_scope', p ->> 'courier_id', (p ->> 'preferred_date')::date, p ->> 'preferred_slot',
      coalesce((p ->> 'is_gift')::boolean, false), p ->> 'gift_message', coalesce((p ->> 'hide_prices')::boolean, false),
      p ->> 'payment_method', p ->> 'notes')
    RETURNING id INTO v_order;
  EXCEPTION WHEN unique_violation THEN
    -- The same reference was placed at the same moment by another request, which has now committed
    SELECT * INTO o FROM orders WHERE ref = v_ref;
    IF o.user_id IS DISTINCT FROM v_user OR (v_user IS NULL AND
       o.recipient_phone IS DISTINCT FROM nullif(btrim(p ->> 'recipient_phone'), '')) THEN RAISE EXCEPTION 'This order reference is already used'; END IF;
    RETURN jsonb_build_object('order_id', o.id, 'ref', o.ref, 'subtotal', o.subtotal_zmw, 'discount', o.discount_zmw,
      'vat', o.vat_zmw, 'total', o.total_zmw, 'deposit', o.deposit_zmw, 'replayed', true);
  END;
  IF (p ->> 'address_id') IS NOT NULL
     AND (v_user IS NULL OR NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = (p ->> 'address_id')::bigint AND user_id = v_user)) THEN
    RAISE EXCEPTION 'That saved address isn''t yours';
  END IF;

  -- Lines in a fixed order, so two orders lock the same rows in the same order and can't deadlock
  FOR it IN
    SELECT (x ->> 'product_id') AS product_id, (x ->> 'variant_id')::bigint AS variant_id,
           coalesce((x ->> 'quantity')::int, 1) AS quantity, (x ->> 'commitment_id')::bigint AS commitment_id,
           coalesce(ARRAY(SELECT jsonb_array_elements_text(x -> 'addons')::bigint), '{}') AS addons
    FROM jsonb_array_elements(p -> 'items') x
    ORDER BY 1, 2 NULLS FIRST
  LOOP
    IF it.quantity NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'Quantity must be 1 to 99'; END IF;
    SELECT * INTO pr FROM products WHERE id = it.product_id FOR UPDATE;
    IF NOT FOUND OR pr.status <> 'active' THEN RAISE EXCEPTION 'Product % is no longer available', it.product_id; END IF;
    base := pr.price_zmw; va := NULL;
    IF it.variant_id IS NOT NULL THEN
      SELECT * INTO va FROM product_variants WHERE id = it.variant_id AND product_id = it.product_id FOR UPDATE;
      IF NOT FOUND OR NOT va.active THEN RAISE EXCEPTION 'That variation of % is no longer available', it.product_id; END IF;
      IF va.stock_qty < it.quantity THEN RAISE EXCEPTION 'Only % left of that variation of %', va.stock_qty, pr.title; END IF;
      UPDATE product_variants SET stock_qty = stock_qty - it.quantity WHERE id = va.id;
      base := coalesce(va.price_zmw, base);
    ELSE
      IF EXISTS (SELECT 1 FROM product_variants WHERE product_id = it.product_id) THEN
        RAISE EXCEPTION 'Choose a variation of %', pr.title;
      END IF;
      IF pr.stock_qty IS NOT NULL THEN
        IF pr.stock_qty < it.quantity THEN RAISE EXCEPTION 'Only % left of %', pr.stock_qty, pr.title; END IF;
        UPDATE products SET stock_qty = stock_qty - it.quantity WHERE id = pr.id;
      END IF;
    END IF;

    -- Price as the website shows it: the best live promotion for the buyer's province, then a
    -- lower live deal, then a lower bulk price for this quantity; an accepted offer replaces all
    unit := base; src := 'fixed';
    SELECT max(pm.discount) INTO promo_off FROM promotions pm JOIN promotion_products pp ON pp.promotion_id = pm.id
     WHERE pp.product_id = it.product_id AND v_today BETWEEN pm.starts AND pm.ends
       AND (NOT EXISTS (SELECT 1 FROM promotion_areas a WHERE a.promotion_id = pm.id)
            OR EXISTS (SELECT 1 FROM promotion_areas a WHERE a.promotion_id = pm.id AND a.province_id = v_prov));
    IF promo_off IS NOT NULL THEN unit := round(base * (100 - promo_off) / 100, 2); src := 'promotion'; END IF;
    SELECT d.price_zmw INTO deal_price FROM deals d
     WHERE d.product_id = it.product_id AND d.starts <= v_today AND (d.ends IS NULL OR d.ends >= v_today);
    IF deal_price IS NOT NULL AND deal_price < unit THEN unit := deal_price; src := 'deal'; END IF;
    IF va.price_zmw IS NULL THEN      -- bulk prices are set against the product's own price
      SELECT min(t.price_zmw) INTO tier_price FROM price_tiers t WHERE t.product_id = it.product_id AND t.min_qty <= it.quantity;
      IF tier_price IS NOT NULL AND tier_price < unit THEN unit := tier_price; src := 'bulk'; END IF;
    END IF;
    IF it.commitment_id IS NOT NULL THEN
      SELECT * INTO cm FROM price_commitments WHERE id = it.commitment_id;
      IF NOT FOUND OR v_user IS NULL OR cm.buyer_id <> v_user THEN RAISE EXCEPTION 'That offer isn''t yours'; END IF;
      unit := cm.amount_zmw; src := 'commit';   -- the order_items trigger checks it's accepted and matches
    END IF;

    INSERT INTO order_items (order_id, product_id, variant_id, quantity, unit_price_zmw, commitment_id, price_source, stock_taken)
    VALUES (v_order, it.product_id, it.variant_id, it.quantity, unit, it.commitment_id, src,
            it.variant_id IS NOT NULL OR pr.stock_qty IS NOT NULL)
    RETURNING id INTO v_item;
    INSERT INTO order_item_addons (order_item_id, product_id, component_id, price_zmw)
      SELECT v_item, it.product_id, c.id, c.addon_price_zmw FROM product_components c
      WHERE c.product_id = it.product_id AND c.id = ANY (it.addons);
    IF (SELECT count(*) FROM order_item_addons WHERE order_item_id = v_item) <> cardinality(it.addons) THEN
      RAISE EXCEPTION 'An add-on isn''t offered with %', pr.title;
    END IF;
    SELECT coalesce(sum(price_zmw), 0) INTO adds FROM order_item_addons WHERE order_item_id = v_item;
    subtotal := subtotal + (unit + adds) * it.quantity;
    IF EXISTS (SELECT 1 FROM sellers WHERE id = pr.seller_id AND vat_registered) THEN
      taxable := taxable + (unit + adds) * it.quantity;
    END IF;
  END LOOP;

  -- Voucher, rounded to the kwacha as the cart shows it
  IF nullif(p ->> 'voucher_code', '') IS NOT NULL THEN
    SELECT * INTO vc FROM vouchers WHERE code = upper(btrim(p ->> 'voucher_code')) AND active
      AND (starts IS NULL OR starts <= v_today) AND (ends IS NULL OR ends >= v_today);
    IF NOT FOUND THEN RAISE EXCEPTION 'That voucher code isn''t valid'; END IF;
    IF subtotal >= vc.min_spend_zmw THEN discount := round(subtotal * vc.percent / 100); END IF;
  END IF;
  total := subtotal - discount;
  taxable_total := CASE WHEN subtotal > 0 THEN total * taxable / subtotal ELSE 0 END;
  IF s.vat_registered AND s.vat_included THEN vat := round(taxable_total * s.vat_rate / (100 + s.vat_rate), 2);
  ELSIF s.vat_registered THEN vat := round(taxable_total * s.vat_rate / 100, 2); total := total + vat; END IF;

  -- Pay on delivery only up to a limit, and only for buyers who have received an order before
  IF p ->> 'payment_method' = 'cod' THEN
    IF total > s.cod_max_zmw THEN RAISE EXCEPTION 'Pay on delivery is available up to K%', s.cod_max_zmw; END IF;
    IF s.cod_min_delivered > 0 AND (v_user IS NULL OR (SELECT count(*) FROM orders WHERE user_id = v_user AND status = 'delivered') < s.cod_min_delivered) THEN
      RAISE EXCEPTION 'Pay on delivery opens after your first delivered order';
    END IF;
  END IF;
  IF v_plan = 'layby' THEN
    IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to use lay-by'; END IF;
    deposit := ceil(total * s.layby_deposit_pct / 100);
  END IF;
  -- The delivery fee is confirmed with the buyer afterwards, so it stays empty here
  UPDATE orders SET subtotal_zmw = subtotal, discount_zmw = discount,
    voucher_code = CASE WHEN discount > 0 THEN vc.code END,
    vat_rate = CASE WHEN s.vat_registered THEN s.vat_rate END, vat_included = s.vat_included, vat_zmw = vat, total_zmw = total,
    payment_plan = v_plan, deposit_zmw = deposit,
    layby_due = CASE WHEN v_plan = 'layby' THEN v_today + 7 * s.layby_weeks END
  WHERE id = v_order;
  RETURN jsonb_build_object('order_id', v_order, 'ref', v_ref, 'subtotal', subtotal, 'discount', discount,
    'vat', vat, 'total', total, 'deposit', deposit, 'replayed', false);
END $$;
REVOKE EXECUTE ON FUNCTION app.place_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.place_order(jsonb) TO service_role;

-- ---------- Payments and buyer protection ----------
-- One row per payment the provider reports. (provider, provider_ref) is unique, so a webhook
-- delivered twice records the payment once.
CREATE TABLE payments (
  id           bigserial PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders (id),
  provider     text NOT NULL CHECK (provider ~ '^[a-z0-9_-]{2,30}$'),
  provider_ref text NOT NULL CHECK (char_length(provider_ref) BETWEEN 1 AND 120),
  method       text CHECK (char_length(method) <= 40),
  amount_zmw   numeric(12,2) NOT NULL CHECK (amount_zmw > 0),
  status       text NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  raw          jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);
CREATE INDEX payments_order_idx ON payments (order_id);

-- What each seller is owed for an order. Held until the buyer confirms delivery (or staff mark
-- it delivered), then due payout_hold_days later unless a complaint is open.
CREATE TABLE seller_payouts (
  id            bigserial PRIMARY KEY,
  seller_id     text NOT NULL REFERENCES sellers (id),
  order_id      bigint NOT NULL REFERENCES orders (id),
  amount_zmw    numeric(12,2) NOT NULL CHECK (amount_zmw >= 0),
  commission_zmw numeric(12,2) NOT NULL DEFAULT 0 CHECK (commission_zmw >= 0),
  status        text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'due', 'paid', 'cancelled')),
  release_after timestamptz,
  paid_at       timestamptz,
  reference     text CHECK (char_length(reference) <= 120),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, seller_id),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX seller_payouts_seller_idx ON seller_payouts (seller_id, status);
CREATE INDEX seller_payouts_release_idx ON seller_payouts (release_after) WHERE status = 'held';

-- Records a payment from the provider's webhook (server functions only). Returns the order's
-- payment status. When an order is fully paid, each seller's share is held for them.
CREATE FUNCTION app.record_payment(p_provider text, p_ref text, p_order_ref text, p_amount numeric, p_status text,
  p_method text DEFAULT NULL, p_raw jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders; paid numeric; s shop_settings; due numeric;
BEGIN
  SELECT * INTO o FROM orders WHERE ref = p_order_ref FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No order %', p_order_ref; END IF;
  INSERT INTO payments (order_id, provider, provider_ref, method, amount_zmw, status, raw)
  VALUES (o.id, p_provider, p_ref, p_method, p_amount, p_status, p_raw)
  ON CONFLICT (provider, provider_ref) DO UPDATE
    SET status = CASE WHEN payments.status IN ('paid', 'refunded') AND EXCLUDED.status IN ('pending', 'failed')
                      THEN payments.status ELSE EXCLUDED.status END,   -- a late "pending" never undoes "paid"
        raw = coalesce(EXCLUDED.raw, payments.raw), updated_at = now()
  WHERE payments.order_id = o.id;
  SELECT coalesce(sum(amount_zmw) FILTER (WHERE status = 'paid'), 0) INTO paid FROM payments WHERE order_id = o.id;
  due := coalesce(o.total_zmw, 0) + coalesce(o.delivery_zmw, 0);
  UPDATE orders SET paid_zmw = paid,
    payment_status = CASE WHEN paid = 0 THEN CASE WHEN EXISTS (SELECT 1 FROM payments WHERE order_id = o.id AND status = 'refunded') THEN 'refunded' ELSE 'unpaid' END
                          WHEN paid < due THEN 'part' ELSE 'paid' END,
    status = CASE WHEN status = 'placed' AND paid >= due THEN 'confirmed' ELSE status END
  WHERE id = o.id RETURNING * INTO o;
  IF o.payment_status = 'paid' THEN
    SELECT * INTO s FROM shop_settings;
    INSERT INTO seller_payouts (seller_id, order_id, amount_zmw, commission_zmw)
    SELECT pr.seller_id, o.id,
           round(sum(line) * (100 - s.commission_pct) / 100, 2), round(sum(line) * s.commission_pct / 100, 2)
    FROM (SELECT oi.product_id, (oi.unit_price_zmw + coalesce((SELECT sum(a.price_zmw) FROM order_item_addons a WHERE a.order_item_id = oi.id), 0)) * oi.quantity AS line
          FROM order_items oi WHERE oi.order_id = o.id) l
    JOIN products pr ON pr.id = l.product_id
    GROUP BY pr.seller_id
    ON CONFLICT (order_id, seller_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('order_id', o.id, 'paid', o.paid_zmw, 'payment_status', o.payment_status, 'status', o.status);
END $$;

-- Delivered: by the buyer ("I've received it"), or by staff. Starts the payout hold.
CREATE FUNCTION app.mark_delivered(p_order bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE hold smallint;
BEGIN
  UPDATE orders SET status = 'delivered', delivered_at = coalesce(delivered_at, now())
   WHERE id = p_order AND status IN ('confirmed', 'dispatched');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a confirmed or dispatched order can be marked delivered'; END IF;
  SELECT payout_hold_days INTO hold FROM shop_settings;
  UPDATE seller_payouts SET release_after = now() + make_interval(days => hold) WHERE order_id = p_order AND status = 'held';
END $$;
CREATE FUNCTION public.confirm_delivery(order_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order bigint;
BEGIN
  SELECT id INTO v_order FROM orders WHERE ref = order_ref AND user_id = app.user_id();
  IF v_order IS NULL THEN RAISE EXCEPTION 'That isn''t one of your orders'; END IF;
  PERFORM app.mark_delivered(v_order);
END $$;

-- Payouts whose hold has passed with no open complaint become due (run daily, e.g. pg_cron)
CREATE FUNCTION app.release_due_payouts() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH r AS (
    UPDATE seller_payouts sp SET status = 'due'
     WHERE sp.status = 'held' AND sp.release_after <= now()
       AND NOT EXISTS (SELECT 1 FROM complaints c WHERE c.order_id = sp.order_id AND c.status NOT IN ('resolved', 'closed'))
    RETURNING 1)
  SELECT count(*)::int FROM r
$$;
-- Lay-bys not fully paid by their date are cancelled, which returns the stock (run daily)
CREATE FUNCTION app.expire_laybys() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH r AS (
    UPDATE orders SET status = 'cancelled'
     WHERE payment_plan = 'layby' AND status IN ('placed', 'confirmed') AND payment_status <> 'paid'
       AND layby_due < (now() AT TIME ZONE 'Africa/Lusaka')::date
    RETURNING 1)
  SELECT count(*)::int FROM r
$$;
-- A cancelled order's payouts are cancelled too
CREATE FUNCTION app.cancel_payouts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE seller_payouts SET status = 'cancelled' WHERE order_id = NEW.id AND status IN ('held', 'due');
  RETURN NEW;
END $$;
CREATE TRIGGER orders_cancel_payouts AFTER UPDATE OF status ON orders FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') EXECUTE FUNCTION app.cancel_payouts();

-- ---------- Notifications outbox ----------
-- Messages waiting for the send-notifications server function (WhatsApp templates, SMS backup).
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint REFERENCES users (id) ON DELETE CASCADE,
  order_id   bigint REFERENCES orders (id) ON DELETE CASCADE,
  channel    text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms', 'email')),
  to_address text NOT NULL CHECK (char_length(to_address) BETWEEN 3 AND 200),
  template   text NOT NULL CHECK (template ~ '^[a-z_]{3,40}$'),
  payload    jsonb NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  attempts   smallint NOT NULL DEFAULT 0,
  last_error text CHECK (char_length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);
CREATE INDEX notifications_queue_idx ON notifications (created_at) WHERE status = 'queued';
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_order_idx ON notifications (order_id) WHERE order_id IS NOT NULL;

CREATE FUNCTION app.queue_notification(p_user bigint, p_order bigint, p_template text, p_payload jsonb, p_phone text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ph text := coalesce(p_phone, (SELECT phone FROM users WHERE id = p_user));
BEGIN
  IF ph IS NULL THEN RETURN; END IF;     -- no number to send to (email-only accounts get email later)
  INSERT INTO notifications (user_id, order_id, to_address, template, payload) VALUES (p_user, p_order, ph, p_template, p_payload);
END $$;
-- Order updates: placed, confirmed, dispatched, delivered, cancelled
CREATE FUNCTION app.notify_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM app.queue_notification(NEW.user_id, NEW.id, 'order_' || NEW.status,
      jsonb_build_object('ref', NEW.ref, 'total', NEW.total_zmw, 'name', coalesce(NEW.contact_name, (SELECT name FROM users WHERE id = NEW.user_id))),
      coalesce(NEW.recipient_phone, (SELECT phone FROM users WHERE id = NEW.user_id)));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_notify AFTER INSERT OR UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION app.notify_order();
CREATE FUNCTION app.notify_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders;
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT * INTO o FROM orders WHERE id = NEW.order_id;
    PERFORM app.queue_notification(o.user_id, o.id, 'payment_received', jsonb_build_object('ref', o.ref, 'amount', NEW.amount_zmw),
      coalesce(o.recipient_phone, (SELECT phone FROM users WHERE id = o.user_id)));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_notify AFTER INSERT OR UPDATE OF status ON payments FOR EACH ROW EXECUTE FUNCTION app.notify_payment();

-- ---------- Stock and price alerts, saved searches ----------
CREATE TABLE product_alerts (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id   text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('back_in_stock', 'price_drop')),
  target_zmw   numeric(12,2) CHECK (target_zmw > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  notified_at  timestamptz,
  UNIQUE (user_id, product_id, kind)
);
CREATE INDEX product_alerts_product_idx ON product_alerts (product_id, kind) WHERE notified_at IS NULL;
CREATE TABLE saved_searches (
  id            bigserial PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  query         text NOT NULL CHECK (char_length(btrim(query)) BETWEEN 2 AND 100),
  department_id text REFERENCES departments (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_checked  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, query, department_id)
);
CREATE FUNCTION app.alert_limits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF TG_TABLE_NAME = 'product_alerts' AND (SELECT count(*) FROM product_alerts WHERE user_id = NEW.user_id AND notified_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'You can have up to 50 alerts';
  ELSIF TG_TABLE_NAME = 'saved_searches' AND (SELECT count(*) FROM saved_searches WHERE user_id = NEW.user_id) >= 20 THEN
    RAISE EXCEPTION 'You can save up to 20 searches';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_alerts_limit BEFORE INSERT ON product_alerts FOR EACH ROW EXECUTE FUNCTION app.alert_limits();
CREATE TRIGGER saved_searches_limit BEFORE INSERT ON saved_searches FOR EACH ROW EXECUTE FUNCTION app.alert_limits();
-- Back in stock (a count going from 0 to more) and price drops queue one message per alert
CREATE FUNCTION app.fire_product_alerts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid text; a product_alerts; title text; restocked boolean; price numeric;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    pid := NEW.id;
    restocked := coalesce(OLD.stock_qty, 1) = 0 AND coalesce(NEW.stock_qty, 1) > 0;
    price := CASE WHEN NEW.price_zmw < OLD.price_zmw THEN NEW.price_zmw END;
  ELSE
    pid := NEW.product_id;
    restocked := OLD.stock_qty = 0 AND NEW.stock_qty > 0;
    price := NULL;
  END IF;
  IF NOT restocked AND price IS NULL THEN RETURN NEW; END IF;
  SELECT p.title INTO title FROM products p WHERE p.id = pid AND p.status = 'active';
  IF title IS NULL THEN RETURN NEW; END IF;
  FOR a IN SELECT * FROM product_alerts WHERE product_id = pid AND notified_at IS NULL
             AND ((restocked AND kind = 'back_in_stock') OR (price IS NOT NULL AND kind = 'price_drop' AND (target_zmw IS NULL OR price <= target_zmw)))
           FOR UPDATE SKIP LOCKED LOOP
    PERFORM app.queue_notification(a.user_id, NULL, a.kind, jsonb_build_object('product_id', pid, 'title', title, 'price', price));
    UPDATE product_alerts SET notified_at = now() WHERE id = a.id;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER products_alerts AFTER UPDATE OF stock_qty, price_zmw ON products FOR EACH ROW EXECUTE FUNCTION app.fire_product_alerts();
CREATE TRIGGER product_variants_alerts AFTER UPDATE OF stock_qty ON product_variants FOR EACH ROW EXECUTE FUNCTION app.fire_product_alerts();

-- ---------- Review photos, questions and answers ----------
CREATE TABLE review_photos (
  id         bigserial PRIMARY KEY,
  review_id  bigint NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  src        text NOT NULL CHECK (char_length(src) BETWEEN 1 AND 500),
  position   smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, position)
);
CREATE TABLE product_questions (
  id          bigserial PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  user_id     bigint REFERENCES users (id) ON DELETE SET NULL,
  question    text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 10 AND 300),
  answer      text CHECK (char_length(btrim(answer)) BETWEEN 2 AND 1000),
  answered_at timestamptz,
  status      text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_questions_product_idx ON product_questions (product_id, created_at DESC);
CREATE INDEX product_questions_user_idx ON product_questions (user_id);
CREATE FUNCTION app.question_answered() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.answer IS DISTINCT FROM OLD.answer THEN NEW.answered_at := CASE WHEN NEW.answer IS NULL THEN NULL ELSE now() END; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_questions_answered BEFORE UPDATE ON product_questions FOR EACH ROW EXECUTE FUNCTION app.question_answered();
CREATE TRIGGER product_questions_throttle BEFORE INSERT ON product_questions FOR EACH ROW EXECUTE FUNCTION app.throttle('user_id', 'created_at', '10', '1 day');
CREATE TRIGGER review_photos_throttle BEFORE INSERT ON review_photos FOR EACH ROW EXECUTE FUNCTION app.throttle('review_id', 'created_at', '4', '1 day');

-- ---------- Public figures: seller trust, bought together ----------
-- Aggregates only, so they're safe for anyone; the rows behind them stay private.
CREATE FUNCTION public.seller_trust(sid text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'verified', s.verified,
    'member_since', s.created_at::date,
    'orders_delivered', (SELECT count(DISTINCT o.id) FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
                          WHERE p.seller_id = s.id AND o.status = 'delivered'),
    'rating', (SELECT round(sum(p.average_rating * p.total_reviews_count) / nullif(sum(p.total_reviews_count), 0), 1) FROM products p WHERE p.seller_id = s.id AND p.status = 'active'),
    'reviews', (SELECT coalesce(sum(p.total_reviews_count), 0) FROM products p WHERE p.seller_id = s.id AND p.status = 'active'),
    'reply_hours', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM c.responded_at - c.created_at) / 3600)::numeric, 1)
                     FROM price_commitments c JOIN products p ON p.id = c.product_id
                     WHERE p.seller_id = s.id AND c.responded_at IS NOT NULL AND c.created_at > now() - interval '90 days'),
    'upheld_complaints_90d', (SELECT count(*) FROM complaints c WHERE c.seller_id = s.id AND c.upheld AND c.created_at > now() - interval '90 days'))
  FROM sellers s WHERE s.id = sid
$$;
CREATE FUNCTION public.bought_together(pid text, lim int DEFAULT 4) RETURNS TABLE (product_id text, orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.product_id, count(DISTINCT b.order_id) AS orders
  FROM order_items a JOIN order_items b ON b.order_id = a.order_id AND b.product_id <> a.product_id
  JOIN orders o ON o.id = a.order_id AND o.status <> 'cancelled'
  JOIN products p ON p.id = b.product_id AND p.status = 'active'
  WHERE a.product_id = pid
  GROUP BY b.product_id HAVING count(DISTINCT b.order_id) >= 2
  ORDER BY 2 DESC, 1 LIMIT least(greatest(lim, 1), 12)
$$;

-- ---------- For sellers: performance and sales ----------
-- Like a marketplace's account health: cancellations, late dispatch, upheld complaints and
-- reply times over 90 days, with a level. Only the store's members and staff can see it.
CREATE FUNCTION public.seller_performance(sid text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int; v_cancelled int; v_late int; v_upheld int; v_reply numeric; v_score int;
BEGIN
  IF NOT (app.is_seller(sid) OR app.is_staff()) THEN RAISE EXCEPTION 'Only the store''s members can see this'; END IF;
  SELECT count(DISTINCT o.id), count(DISTINCT o.id) FILTER (WHERE o.status = 'cancelled'),
         count(DISTINCT o.id) FILTER (WHERE coalesce(o.dispatched_at, now()) - o.created_at > interval '48 hours' AND o.status IN ('confirmed', 'dispatched', 'delivered'))
    INTO v_n, v_cancelled, v_late
    FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
   WHERE p.seller_id = sid AND o.created_at > now() - interval '90 days';
  SELECT count(*) INTO v_upheld FROM complaints WHERE seller_id = sid AND upheld AND created_at > now() - interval '90 days';
  SELECT round(avg(extract(epoch FROM c.responded_at - c.created_at) / 3600)::numeric, 1) INTO v_reply
    FROM price_commitments c JOIN products p ON p.id = c.product_id WHERE p.seller_id = sid AND c.responded_at IS NOT NULL AND c.created_at > now() - interval '90 days';
  v_score := greatest(0, 100 - CASE WHEN v_n > 0 THEN round(100.0 * v_cancelled / v_n) * 2 + round(100.0 * v_late / v_n) ELSE 0 END
                          - v_upheld * 10 - CASE WHEN v_reply > 24 THEN 10 ELSE 0 END);
  RETURN jsonb_build_object('orders_90d', v_n, 'cancelled', v_cancelled, 'late_dispatch', v_late, 'upheld_complaints', v_upheld,
    'reply_hours', v_reply, 'score', v_score, 'level', CASE WHEN v_score >= 85 THEN 'good' WHEN v_score >= 60 THEN 'fair' ELSE 'at_risk' END);
END $$;
CREATE FUNCTION public.seller_sales(sid text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb;
BEGIN
  IF NOT (app.is_seller(sid) OR app.is_staff()) THEN RAISE EXCEPTION 'Only the store''s members can see this'; END IF;
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

-- ---------- Staff back office ----------
-- Every staff decision goes through these functions and is written to staff_actions.
CREATE TABLE staff_actions (
  id         bigserial PRIMARY KEY,
  staff_id   bigint REFERENCES users (id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_actions_time_idx ON staff_actions (created_at DESC);
CREATE FUNCTION app.staff_only(p_action text, p_target text, p_detail jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app.is_staff() THEN RAISE EXCEPTION 'Staff only' USING ERRCODE = '42501'; END IF;
  INSERT INTO staff_actions (staff_id, action, target, detail) VALUES (app.user_id(), p_action, p_target, p_detail);
END $$;
CREATE FUNCTION public.staff_moderate_listing(pid text, new_status text, note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('moderate_listing', pid, jsonb_build_object('status', new_status, 'note', note));
  IF new_status NOT IN ('active', 'paused', 'removed', 'pending') THEN RAISE EXCEPTION 'Unknown status %', new_status; END IF;
  UPDATE products SET status = new_status WHERE id = pid;
  IF NOT FOUND THEN RAISE EXCEPTION 'No listing %', pid; END IF;
END $$;
CREATE FUNCTION public.staff_verify_seller(sid text, is_verified boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('verify_seller', sid, jsonb_build_object('verified', is_verified));
  UPDATE sellers SET verified = is_verified WHERE id = sid;
  IF NOT FOUND THEN RAISE EXCEPTION 'No seller %', sid; END IF;
END $$;
CREATE FUNCTION public.staff_decide_complaint(cid bigint, new_status complaint_status, finding text DEFAULT NULL, was_upheld boolean DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('decide_complaint', cid::text, jsonb_build_object('status', new_status, 'upheld', was_upheld));
  UPDATE complaints SET status = new_status, outcome = coalesce(finding, outcome), upheld = coalesce(was_upheld, upheld),
    acknowledged_at = coalesce(acknowledged_at, now()),
    resolved_at = CASE WHEN new_status IN ('resolved', 'closed') THEN coalesce(resolved_at, now()) END
  WHERE id = cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'No complaint %', cid; END IF;
END $$;
CREATE FUNCTION public.staff_decide_cancellation(cancel_id bigint, approve boolean, refund numeric DEFAULT NULL, staff_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('decide_cancellation', cancel_id::text, jsonb_build_object('approve', approve, 'refund', refund));
  UPDATE order_cancellations SET status = CASE WHEN approve THEN 'approved'::cancel_status ELSE 'declined'::cancel_status END,
    decided_at = now(), refund_zmw = refund, note = staff_note
  WHERE id = cancel_id AND status = 'requested';
  IF NOT FOUND THEN RAISE EXCEPTION 'No open cancellation request %', cancel_id; END IF;
END $$;
CREATE FUNCTION public.staff_decide_return(return_id bigint, new_status return_status, refund numeric DEFAULT NULL, method refund_method DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('decide_return', return_id::text, jsonb_build_object('status', new_status, 'refund', refund));
  UPDATE return_requests SET status = new_status, refund_zmw = coalesce(refund, refund_zmw), refund_method = coalesce(method, refund_method),
    received_at = CASE WHEN new_status IN ('received', 'refunded', 'replaced', 'repaired') THEN coalesce(received_at, now()) ELSE received_at END,
    refunded_at = CASE WHEN new_status = 'refunded' THEN coalesce(refunded_at, now()) ELSE refunded_at END
  WHERE id = return_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No return %', return_id; END IF;
END $$;
CREATE FUNCTION public.staff_order_step(order_id bigint, step text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('order_step', order_id::text, jsonb_build_object('step', step));
  IF step = 'confirmed' THEN UPDATE orders SET status = 'confirmed' WHERE id = order_id AND status = 'placed';
  ELSIF step = 'dispatched' THEN UPDATE orders SET status = 'dispatched', dispatched_at = now() WHERE id = order_id AND status IN ('placed', 'confirmed');
  ELSIF step = 'delivered' THEN PERFORM app.mark_delivered(order_id); RETURN;
  ELSE RAISE EXCEPTION 'Unknown step %', step; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % can''t move to %', order_id, step; END IF;
END $$;
CREATE FUNCTION public.staff_hide_content(kind text, item_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('hide_' || kind, item_id::text, '{}');
  IF kind = 'review' THEN UPDATE reviews SET status = 'hidden' WHERE id = item_id;
  ELSIF kind = 'question' THEN UPDATE product_questions SET status = 'hidden' WHERE id = item_id;
  ELSE RAISE EXCEPTION 'Unknown kind %', kind; END IF;
END $$;

-- ---------- Row-level security and rights ----------
ALTER TABLE pickup_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read" ON pickup_points FOR SELECT TO anon, authenticated USING (active OR app.is_staff());
GRANT SELECT ON pickup_points TO anon, authenticated;
CREATE POLICY "Visible with its listing" ON price_tiers FOR SELECT TO anon, authenticated USING (app.product_visible(product_id));
CREATE POLICY "Seller manages" ON price_tiers FOR ALL TO authenticated
  USING (app.is_seller(app.product_seller(product_id))) WITH CHECK (app.is_seller(app.product_seller(product_id)));
GRANT SELECT ON price_tiers TO anon; GRANT SELECT, INSERT, UPDATE, DELETE ON price_tiers TO authenticated;
CREATE POLICY "Payments on your orders" ON payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = (SELECT app.user_id())) OR app.is_staff());
GRANT SELECT ON payments TO authenticated;
CREATE POLICY "Your store's payouts" ON seller_payouts FOR SELECT TO authenticated USING (app.is_seller(seller_id) OR app.is_staff());
GRANT SELECT ON seller_payouts TO authenticated;
CREATE POLICY "Your messages" ON notifications FOR SELECT TO authenticated USING (user_id = (SELECT app.user_id()));
GRANT SELECT ON notifications TO authenticated;
CREATE POLICY "Your alerts" ON product_alerts FOR ALL TO authenticated
  USING (user_id = (SELECT app.user_id())) WITH CHECK (user_id = (SELECT app.user_id()));
GRANT SELECT, DELETE ON product_alerts TO authenticated; GRANT INSERT (user_id, product_id, kind, target_zmw) ON product_alerts TO authenticated;
CREATE POLICY "Your saved searches" ON saved_searches FOR ALL TO authenticated
  USING (user_id = (SELECT app.user_id())) WITH CHECK (user_id = (SELECT app.user_id()));
GRANT SELECT, DELETE ON saved_searches TO authenticated; GRANT INSERT (user_id, query, department_id) ON saved_searches TO authenticated;
CREATE POLICY "Photos on visible reviews" ON review_photos FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM reviews r WHERE r.id = review_id));
CREATE POLICY "Add photos to your review" ON review_photos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM reviews r WHERE r.id = review_id AND r.user_id = (SELECT app.user_id())));
CREATE POLICY "Remove photos from your review" ON review_photos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM reviews r WHERE r.id = review_id AND r.user_id = (SELECT app.user_id())));
GRANT SELECT ON review_photos TO anon, authenticated; GRANT INSERT (review_id, src, position), DELETE ON review_photos TO authenticated;
CREATE POLICY "Published questions, or your own" ON product_questions FOR SELECT TO anon, authenticated
  USING ((status = 'published' AND app.product_visible(product_id)) OR user_id = (SELECT app.user_id()) OR app.is_staff()
         OR app.is_seller(app.product_seller(product_id)));
CREATE POLICY "Ask about a product" ON product_questions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT app.user_id()) AND app.product_visible(product_id));
CREATE POLICY "Sellers answer questions on their products" ON product_questions FOR UPDATE TO authenticated
  USING (app.is_seller(app.product_seller(product_id))) WITH CHECK (app.is_seller(app.product_seller(product_id)));
GRANT SELECT ON product_questions TO anon, authenticated;
GRANT INSERT (product_id, user_id, question), UPDATE (answer) ON product_questions TO authenticated;
CREATE POLICY "Staff read the log" ON staff_actions FOR SELECT TO authenticated USING (app.is_staff());
GRANT SELECT ON staff_actions TO authenticated;
GRANT ALL ON pickup_points, price_tiers, payments, seller_payouts, notifications, product_alerts, saved_searches,
  review_photos, product_questions, staff_actions TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
DO $$ BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON pickup_points, price_tiers, payments, seller_payouts, notifications, product_alerts, saved_searches, review_photos, product_questions, staff_actions FROM anon, authenticated';
  END IF;
END $$;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON pickup_points, price_tiers, payments, seller_payouts, notifications, product_alerts,
  saved_searches, review_photos, product_questions, staff_actions FROM anon, authenticated;

-- Functions: the public ones are for the website; the app ones for server functions only
REVOKE EXECUTE ON FUNCTION app.record_payment(text, text, text, numeric, text, text, jsonb), app.mark_delivered(bigint),
  app.release_due_payouts(), app.expire_laybys(), app.queue_notification(bigint, bigint, text, jsonb, text),
  app.staff_only(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.record_payment(text, text, text, numeric, text, text, jsonb), app.mark_delivered(bigint),
  app.release_due_payouts(), app.expire_laybys(), app.queue_notification(bigint, bigint, text, jsonb, text) TO service_role;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'app'::regnamespace AND p.prorettype = 'trigger'::regtype LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.seller_trust(text), public.bought_together(text, int), public.confirm_delivery(text),
  public.seller_performance(text), public.seller_sales(text), public.staff_moderate_listing(text, text, text),
  public.staff_verify_seller(text, boolean), public.staff_decide_complaint(bigint, complaint_status, text, boolean),
  public.staff_decide_cancellation(bigint, boolean, numeric, text), public.staff_decide_return(bigint, return_status, numeric, refund_method),
  public.staff_order_step(bigint, text), public.staff_hide_content(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_trust(text), public.bought_together(text, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_delivery(text), public.seller_performance(text), public.seller_sales(text),
  public.staff_moderate_listing(text, text, text), public.staff_verify_seller(text, boolean),
  public.staff_decide_complaint(bigint, complaint_status, text, boolean), public.staff_decide_cancellation(bigint, boolean, numeric, text),
  public.staff_decide_return(bigint, return_status, numeric, refund_method), public.staff_order_step(bigint, text),
  public.staff_hide_content(text, bigint) TO authenticated, service_role;

-- ---------- Storage: review photos ----------
-- Public, up to 1 MB each; a buyer uploads only into their own folder, <auth user id>/...
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('review-photos', 'review-photos', true, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Review photos are public" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'review-photos');
CREATE POLICY "Buyers upload review photos to their own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

COMMIT;
