-- Vouchers staff can run, and a sales report for the admin dashboard.
--
-- 1. Vouchers gain a fixed kwacha amount as well as a percentage, a cap on a percentage
--    discount, a limit on uses in total and per buyer, and a label the buyer sees. Cancelled
--    orders give their use back. The voucher row is locked while an order takes it, so two
--    orders can't both take the last use.
-- 2. voucher_check() lets a signed-in buyer's cart show what a code does before ordering. Codes
--    still can't be listed: only one exact code is checked at a time.
-- 3. Staff with the catalogue role create and change vouchers (logged, like every staff change);
--    catalogue and finance see how each one is used.
-- 4. staff_sales_report() gives finance and operations sales by day, the best-selling products and
--    departments, and payment methods, for the last 7, 30 or 90 days on Zambian dates.
BEGIN;

-- ---------- 1. Vouchers ----------
ALTER TABLE vouchers
  ALTER COLUMN percent DROP NOT NULL,
  ADD COLUMN amount_zmw     numeric(12,0) CHECK (amount_zmw BETWEEN 1 AND 100000),
  ADD COLUMN max_off_zmw    numeric(12,0) CHECK (max_off_zmw BETWEEN 1 AND 100000),
  ADD COLUMN max_uses       integer CHECK (max_uses BETWEEN 1 AND 1000000),
  ADD COLUMN uses_per_buyer smallint CHECK (uses_per_buyer BETWEEN 1 AND 100),
  ADD COLUMN label          text CHECK (char_length(label) <= 80),
  ADD COLUMN created_at     timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at     timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT vouchers_one_kind CHECK ((percent IS NULL) <> (amount_zmw IS NULL)),
  ADD CONSTRAINT vouchers_cap_for_percent CHECK (max_off_zmw IS NULL OR percent IS NOT NULL);
CREATE INDEX orders_voucher_idx ON orders (voucher_code) WHERE voucher_code IS NOT NULL;

-- What a voucher takes off, rounded to the kwacha as the cart shows it
CREATE FUNCTION app.voucher_off(vc vouchers, p_subtotal numeric) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN vc.amount_zmw IS NOT NULL THEN least(vc.amount_zmw, p_subtotal)
    ELSE least(round(p_subtotal * vc.percent / 100), coalesce(vc.max_off_zmw, p_subtotal)) END
$$;

-- Why a buyer can't use a voucher now, or NULL. Orders that were cancelled don't count, nor does
-- the order being placed.
CREATE FUNCTION app.voucher_problem(vc vouchers, p_user bigint, p_phone text, p_order bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN vc.max_uses IS NOT NULL AND (SELECT count(*) FROM orders o WHERE o.voucher_code = vc.code AND o.status <> 'cancelled'
      AND o.id IS DISTINCT FROM p_order) >= vc.max_uses THEN 'That voucher has been used up'
    WHEN vc.uses_per_buyer IS NOT NULL AND (p_user IS NOT NULL OR p_phone IS NOT NULL) AND (SELECT count(*) FROM orders o
      WHERE o.voucher_code = vc.code AND o.status <> 'cancelled' AND o.id IS DISTINCT FROM p_order
        AND ((p_user IS NOT NULL AND o.user_id = p_user) OR (p_phone IS NOT NULL AND o.recipient_phone = p_phone))) >= vc.uses_per_buyer
      THEN CASE WHEN vc.uses_per_buyer = 1 THEN 'You''ve already used that voucher' ELSE 'You''ve used that voucher as many times as it allows' END
  END
$$;
REVOKE ALL ON FUNCTION app.voucher_off(vouchers, numeric), app.voucher_problem(vouchers, bigint, text, bigint) FROM PUBLIC, anon, authenticated;

-- Changing vouchers is the catalogue role's; the rest is as in 030
CREATE OR REPLACE FUNCTION app.action_roles(p_action text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_action IN ('order_step', 'decide_cancellation', 'set_delivery_fee', 'save_delivery_rate', 'delete_delivery_rate',
      'set_delivery_settings', 'review_rider_application', 'retry_notification') THEN ARRAY['operations']
    WHEN p_action IN ('decide_complaint', 'decide_return', 'assign support case', 'hide_review', 'hide_question') THEN ARRAY['support']
    WHEN p_action IN ('moderate_listing', 'verify_seller', 'review_seller_application', 'approve_seller_application', 'save_voucher') THEN ARRAY['catalogue']
    WHEN p_action IN ('close_payment_attempt', 'mark_payouts_paid') THEN ARRAY['finance']
    ELSE ARRAY[]::text[] END
$$;

-- Placing an order: the same as 023, with the voucher block taking the new kinds and limits
CREATE OR REPLACE FUNCTION app.place_order_v15(p jsonb) RETURNS jsonb
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
  vc vouchers; v_why text; n_items int := jsonb_array_length(coalesce(p -> 'items', '[]'));
  v_today date := (now() AT TIME ZONE 'Africa/Lusaka')::date;   -- promotions and deals run on Zambian dates
  v_heavy boolean := false;
  v_biz text := nullif(btrim(p ->> 'business_name'), '');
  v_tpin text := nullif(regexp_replace(coalesce(p ->> 'business_tpin', ''), '\s', '', 'g'), '');
  v_biz_address text := nullif(btrim(p ->> 'business_address'), '');
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
  -- Buying for a business: the name, and optionally its TPIN and billing address, go on the order
  IF (v_tpin IS NOT NULL OR v_biz_address IS NOT NULL) AND v_biz IS NULL THEN RAISE EXCEPTION 'Add the business name for these business details'; END IF;
  IF v_biz IS NOT NULL AND char_length(v_biz) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Enter a business name of 2 to 120 characters'; END IF;
  IF v_tpin IS NOT NULL AND v_tpin !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Enter the TPIN as 10 digits'; END IF;
  IF char_length(v_biz_address) > 200 THEN RAISE EXCEPTION 'Keep the billing address to 200 characters'; END IF;
  IF v_plan = 'layby' AND NOT s.layby_enabled THEN RAISE EXCEPTION 'Lay-by isn''t available yet'; END IF;
  IF nullif(p ->> 'pickup_point_id', '') IS NOT NULL THEN
    SELECT * INTO v_pickup FROM pickup_points WHERE id = p ->> 'pickup_point_id' AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'That pickup point isn''t available'; END IF;
  END IF;
  BEGIN
    INSERT INTO orders (user_id, ref, status, contact_name, recipient_phone, fulfilment, buyer_town, buyer_province_id,
      collection_point, pickup_point_id, deliver_to, address_id, delivery_scope, courier_id, preferred_date, preferred_slot, is_gift,
      gift_message, hide_prices, payment_method, notes, business_name, business_tpin, business_address)
    VALUES (v_user, v_ref, 'placed', nullif(btrim(p ->> 'contact_name'), ''), nullif(btrim(p ->> 'recipient_phone'), ''),
      CASE WHEN v_pickup.id IS NOT NULL THEN 'pickup' ELSE coalesce(p ->> 'fulfilment', 'delivery') END,
      nullif(btrim(p ->> 'buyer_town'), ''), v_prov,
      CASE WHEN v_pickup.id IS NOT NULL THEN left(v_pickup.name || ': ' || v_pickup.address, 200) ELSE nullif(btrim(p ->> 'collection_point'), '') END,
      v_pickup.id, nullif(btrim(p ->> 'deliver_to'), ''), (p ->> 'address_id')::bigint,
      p ->> 'delivery_scope', p ->> 'courier_id', (p ->> 'preferred_date')::date, p ->> 'preferred_slot',
      coalesce((p ->> 'is_gift')::boolean, false), p ->> 'gift_message', coalesce((p ->> 'hide_prices')::boolean, false),
      p ->> 'payment_method', p ->> 'notes', v_biz, v_tpin, v_biz_address)
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
    IF it.quantity NOT BETWEEN 1 AND 9999 THEN RAISE EXCEPTION 'Quantity must be 1 to 9999'; END IF;
    SELECT * INTO pr FROM products WHERE id = it.product_id FOR UPDATE;
    IF NOT FOUND OR pr.status <> 'active' THEN RAISE EXCEPTION 'Product % is no longer available', it.product_id; END IF;
    -- Up to 99 of an ordinary listing; a trade listing takes up to 9999, from its minimum and in its multiples
    IF NOT pr.trade AND it.quantity > 99 THEN RAISE EXCEPTION 'Quantity must be 1 to 99'; END IF;
    IF it.quantity < pr.min_order_qty THEN RAISE EXCEPTION 'The minimum order for % is %', pr.title, pr.min_order_qty; END IF;
    IF it.quantity % pr.order_step <> 0 THEN RAISE EXCEPTION '% is sold in multiples of %', pr.title, pr.order_step; END IF;
    v_heavy := v_heavy OR pr.heavy_delivery;
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
  -- The voucher row is locked so two orders can't both take its last use
  IF nullif(p ->> 'voucher_code', '') IS NOT NULL THEN
    SELECT * INTO vc FROM vouchers WHERE code = upper(btrim(p ->> 'voucher_code')) AND active
      AND (starts IS NULL OR starts <= v_today) AND (ends IS NULL OR ends >= v_today) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That voucher code isn''t valid'; END IF;
    v_why := app.voucher_problem(vc, v_user, nullif(btrim(p ->> 'recipient_phone'), ''), v_order);
    IF v_why IS NOT NULL THEN RAISE EXCEPTION '%', v_why; END IF;
    IF subtotal >= vc.min_spend_zmw THEN discount := app.voucher_off(vc, subtotal); END IF;
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
  -- The delivery fee is confirmed with the buyer afterwards, so it stays empty here; heavy_delivery
  -- tells the seller and staff that it needs a truck quote
  UPDATE orders SET subtotal_zmw = subtotal, discount_zmw = discount,
    voucher_code = CASE WHEN discount > 0 THEN vc.code END,
    vat_rate = CASE WHEN s.vat_registered THEN s.vat_rate END, vat_included = s.vat_included, vat_zmw = vat, total_zmw = total,
    payment_plan = v_plan, deposit_zmw = deposit, heavy_delivery = v_heavy,
    layby_due = CASE WHEN v_plan = 'layby' THEN v_today + 7 * s.layby_weeks END
  WHERE id = v_order;
  RETURN jsonb_build_object('order_id', v_order, 'ref', v_ref, 'subtotal', subtotal, 'discount', discount,
    'vat', vat, 'total', total, 'deposit', deposit, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION app.place_order_v15(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- 2. Checking a code in the cart ----------
CREATE FUNCTION public.voucher_check(p_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE vc vouchers; v_why text; v_today date := (now() AT TIME ZONE 'Africa/Lusaka')::date;
BEGIN
  IF app.user_id() IS NULL THEN RAISE EXCEPTION 'Sign in to use a voucher'; END IF;
  SELECT * INTO vc FROM vouchers WHERE code = upper(btrim(coalesce(p_code, ''))) AND active
    AND (starts IS NULL OR starts <= v_today) AND (ends IS NULL OR ends >= v_today);
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'reason', 'That voucher code isn''t valid'); END IF;
  v_why := app.voucher_problem(vc, app.user_id(), NULL, NULL);
  IF v_why IS NOT NULL THEN RETURN jsonb_build_object('valid', false, 'reason', v_why); END IF;
  RETURN jsonb_build_object('valid', true, 'code', vc.code, 'label', vc.label, 'percent', vc.percent, 'amount', vc.amount_zmw,
    'max_off', vc.max_off_zmw, 'min_spend', vc.min_spend_zmw, 'ends', vc.ends);
END $$;

-- ---------- 3. Staff: vouchers ----------
CREATE FUNCTION public.staff_vouchers() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (app.has_role('catalogue') OR app.has_role('finance')) THEN RAISE EXCEPTION 'Your staff role doesn''t show vouchers' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('code', v.code, 'label', v.label, 'percent', v.percent, 'amount', v.amount_zmw,
      'max_off', v.max_off_zmw, 'min_spend', v.min_spend_zmw, 'active', v.active, 'starts', v.starts, 'ends', v.ends,
      'max_uses', v.max_uses, 'uses_per_buyer', v.uses_per_buyer, 'uses', u.n, 'discount_given', u.off, 'sales', u.sales, 'last_used', u.last,
      'updated_at', v.updated_at) ORDER BY v.active DESC, v.updated_at DESC, v.code), '[]')
    FROM vouchers v LEFT JOIN LATERAL (SELECT count(*) AS n, coalesce(sum(o.discount_zmw), 0) AS off,
      coalesce(sum(o.total_zmw + coalesce(o.delivery_zmw, 0)), 0) AS sales, max(o.created_at) AS last
      FROM orders o WHERE o.voucher_code = v.code AND o.status <> 'cancelled') u ON true);
END $$;

-- Create a voucher or change one. Every field is sent each time; an empty field is cleared.
CREATE FUNCTION public.staff_save_voucher(v jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_code text := upper(btrim(coalesce(v ->> 'code', ''))); old vouchers; v_existed boolean; k text;
  v_percent smallint; v_amount numeric; v_cap numeric; v_min numeric; v_starts date; v_ends date; v_max integer; v_per smallint;
  v_label text := nullif(btrim(coalesce(v ->> 'label', '')), '');
  allowed text[] := ARRAY['code', 'label', 'percent', 'amount', 'max_off', 'min_spend', 'active', 'starts', 'ends', 'max_uses', 'uses_per_buyer'];
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN RAISE EXCEPTION 'Send the voucher to save'; END IF;
  FOR k IN SELECT jsonb_object_keys(v) LOOP
    IF NOT (k = ANY (allowed)) THEN RAISE EXCEPTION 'That voucher field can''t be set: %', k; END IF;
  END LOOP;
  IF v_code !~ '^[A-Z0-9]{3,20}$' THEN RAISE EXCEPTION 'Use 3 to 20 letters and numbers for the code'; END IF;
  SELECT * INTO old FROM vouchers WHERE code = v_code FOR UPDATE;
  v_existed := FOUND;
  PERFORM app.staff_only('save_voucher', v_code, jsonb_build_object('before', CASE WHEN v_existed THEN to_jsonb(old) END, 'after', v));
  v_percent := nullif(v ->> 'percent', '')::smallint; v_amount := nullif(v ->> 'amount', '')::numeric; v_cap := nullif(v ->> 'max_off', '')::numeric;
  v_min := coalesce(nullif(v ->> 'min_spend', '')::numeric, 0); v_starts := nullif(v ->> 'starts', '')::date; v_ends := nullif(v ->> 'ends', '')::date;
  v_max := nullif(v ->> 'max_uses', '')::integer; v_per := nullif(v ->> 'uses_per_buyer', '')::smallint;
  IF (v_percent IS NULL) = (v_amount IS NULL) THEN RAISE EXCEPTION 'Give either a percentage or a kwacha amount off'; END IF;
  IF v_percent IS NOT NULL AND v_percent NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Enter 1 to 90%% off'; END IF;
  IF v_amount IS NOT NULL AND (v_amount NOT BETWEEN 1 AND 100000 OR v_amount <> round(v_amount)) THEN RAISE EXCEPTION 'Enter K1 to K100,000 off, in whole kwacha'; END IF;
  IF v_cap IS NOT NULL AND v_percent IS NULL THEN RAISE EXCEPTION 'A cap applies only to a percentage off'; END IF;
  IF v_cap IS NOT NULL AND (v_cap NOT BETWEEN 1 AND 100000 OR v_cap <> round(v_cap)) THEN RAISE EXCEPTION 'Enter a cap of K1 to K100,000, in whole kwacha'; END IF;
  IF v_min < 0 OR v_min > 1000000 THEN RAISE EXCEPTION 'Enter a minimum spend from K0 to K1,000,000'; END IF;
  IF v_amount IS NOT NULL AND v_min > 0 AND v_amount > v_min THEN RAISE EXCEPTION 'The amount off can''t be more than the minimum spend'; END IF;
  IF v_ends < v_starts THEN RAISE EXCEPTION 'The end date is before the start date'; END IF;
  IF v_max IS NOT NULL AND v_max NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'Enter 1 to 1,000,000 uses, or leave it empty'; END IF;
  IF v_per IS NOT NULL AND v_per NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Enter 1 to 100 uses per buyer, or leave it empty'; END IF;
  IF char_length(v_label) > 80 THEN RAISE EXCEPTION 'Keep the description to 80 characters'; END IF;
  INSERT INTO vouchers (code, percent, amount_zmw, max_off_zmw, min_spend_zmw, active, starts, ends, max_uses, uses_per_buyer, label)
  VALUES (v_code, v_percent, v_amount, v_cap, v_min, coalesce((v ->> 'active')::boolean, true), v_starts, v_ends, v_max, v_per, v_label)
  ON CONFLICT (code) DO UPDATE SET percent = EXCLUDED.percent, amount_zmw = EXCLUDED.amount_zmw, max_off_zmw = EXCLUDED.max_off_zmw,
    min_spend_zmw = EXCLUDED.min_spend_zmw, active = EXCLUDED.active, starts = EXCLUDED.starts, ends = EXCLUDED.ends,
    max_uses = EXCLUDED.max_uses, uses_per_buyer = EXCLUDED.uses_per_buyer, label = EXCLUDED.label, updated_at = now();
  RETURN jsonb_build_object('code', v_code, 'created', NOT v_existed);
END $$;

-- ---------- 4. Sales report ----------
-- Orders count on the Zambian date they were placed; cancelled orders are left out of sales.
-- Product and department sales are item prices before vouchers and delivery.
CREATE FUNCTION public.staff_sales_report(p_days integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Lusaka')::date; v_first date; v_prev date;
BEGIN
  IF NOT (app.has_role('finance') OR app.has_role('operations')) THEN RAISE EXCEPTION 'Your staff role doesn''t show sales' USING ERRCODE = '42501'; END IF;
  IF p_days IS NULL OR p_days NOT IN (7, 30, 90) THEN RAISE EXCEPTION 'Choose 7, 30 or 90 days'; END IF;
  v_first := v_today - (p_days - 1); v_prev := v_first - p_days;
  RETURN (
    WITH o AS (
      SELECT id, (created_at AT TIME ZONE 'Africa/Lusaka')::date AS d, total_zmw + coalesce(delivery_zmw, 0) AS amt,
        discount_zmw, delivery_zmw, coalesce(nullif(payment_method, ''), 'not chosen') AS method, status
      FROM orders WHERE created_at >= (v_prev::timestamp AT TIME ZONE 'Africa/Lusaka')),
    cur AS (SELECT * FROM o WHERE d >= v_first AND status <> 'cancelled'),
    pre AS (SELECT * FROM o WHERE d < v_first AND status <> 'cancelled'),
    lines AS (
      SELECT i.product_id, i.quantity, (i.unit_price_zmw + coalesce((SELECT sum(a.price_zmw) FROM order_item_addons a WHERE a.order_item_id = i.id), 0)) * i.quantity AS amt
      FROM order_items i JOIN cur ON cur.id = i.order_id)
    SELECT jsonb_build_object('days', p_days, 'from', v_first, 'to', v_today,
      'series', (SELECT jsonb_agg(jsonb_build_object('day', g.day, 'orders', coalesce(c.n, 0), 'sales', coalesce(c.s, 0)) ORDER BY g.day)
        FROM (SELECT generate_series(v_first, v_today, interval '1 day')::date AS day) g
        LEFT JOIN (SELECT d, count(*) AS n, sum(amt) AS s FROM cur GROUP BY d) c ON c.d = g.day),
      'totals', (SELECT jsonb_build_object('orders', count(*), 'sales', coalesce(sum(amt), 0), 'discounts', coalesce(sum(discount_zmw), 0),
        'delivery', coalesce(sum(delivery_zmw), 0)) FROM cur),
      'previous', (SELECT jsonb_build_object('orders', count(*), 'sales', coalesce(sum(amt), 0)) FROM pre),
      'cancelled', (SELECT count(*) FROM o WHERE d >= v_first AND status = 'cancelled'),
      'products', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'units', t.units, 'sales', t.sales) ORDER BY t.sales DESC, t.id), '[]')
        FROM (SELECT l.product_id AS id, pr.title, sum(l.quantity) AS units, sum(l.amt) AS sales FROM lines l JOIN products pr ON pr.id = l.product_id
          GROUP BY l.product_id, pr.title ORDER BY sum(l.amt) DESC, l.product_id LIMIT 5) t),
      'departments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'sales', t.sales) ORDER BY t.sales DESC, t.id), '[]')
        FROM (SELECT dp.id, dp.name, sum(l.amt) AS sales FROM lines l JOIN products pr ON pr.id = l.product_id JOIN departments dp ON dp.id = pr.department_id
          GROUP BY dp.id, dp.name ORDER BY sum(l.amt) DESC, dp.id LIMIT 6) t),
      'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('method', t.method, 'orders', t.n, 'sales', t.s) ORDER BY t.s DESC, t.method), '[]')
        FROM (SELECT method, count(*) AS n, sum(amt) AS s FROM cur GROUP BY method) t)));
END $$;

REVOKE ALL ON FUNCTION public.voucher_check(text), public.staff_vouchers(), public.staff_save_voucher(jsonb), public.staff_sales_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voucher_check(text), public.staff_vouchers(), public.staff_save_voucher(jsonb), public.staff_sales_report(integer) TO authenticated;
COMMIT;
