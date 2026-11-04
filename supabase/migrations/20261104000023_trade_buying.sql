-- Trade buying (phase 1): selling units, minimum orders and multiples, larger quantities for
-- trade listings, heavy items that need a truck quote, and business details on accounts and orders.
-- js/products.js (orderRules, validate) applies the same rules in the browser.
BEGIN;

-- ---------- Listings ----------
-- trade: up to 9999 per order line instead of 99, with an optional minimum and multiples.
-- sell_unit: what the price is for (bag, tonne, sheet…); NULL is by the item.
-- heavy_delivery: goes by truck or is collected; the fee is quoted per order.
ALTER TABLE products
  ADD COLUMN trade boolean NOT NULL DEFAULT false,
  ADD COLUMN sell_unit text CHECK (sell_unit IN ('piece', 'pair', 'set', 'pack', 'box', 'carton', 'crate', 'tray', 'bag', 'sack', 'bale', 'bundle', 'roll', 'sheet', 'length', 'drum', 'kg', 'tonne', 'litre', 'metre', 'm2', 'm3', 'pallet', 'load')),
  ADD COLUMN min_order_qty integer NOT NULL DEFAULT 1 CHECK (min_order_qty BETWEEN 1 AND 9999),
  ADD COLUMN order_step integer NOT NULL DEFAULT 1 CHECK (order_step BETWEEN 1 AND 9999),
  ADD COLUMN heavy_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN unit_weight_kg numeric(9,3) CHECK (unit_weight_kg > 0 AND unit_weight_kg <= 100000),
  ADD CONSTRAINT products_trade_quantities CHECK ((trade OR (min_order_qty = 1 AND order_step = 1)) AND min_order_qty % order_step = 0);
GRANT INSERT (trade, sell_unit, min_order_qty, order_step, heavy_delivery, unit_weight_kg),
  UPDATE (trade, sell_unit, min_order_qty, order_step, heavy_delivery, unit_weight_kg) ON products TO authenticated;

-- Bulk prices reach trade quantities, and start above a listing's minimum order
ALTER TABLE price_tiers DROP CONSTRAINT IF EXISTS price_tiers_min_qty_check;
ALTER TABLE price_tiers ALTER COLUMN min_qty TYPE integer;
ALTER TABLE price_tiers ADD CONSTRAINT price_tiers_min_qty_check CHECK (min_qty BETWEEN 2 AND 9999);
CREATE OR REPLACE FUNCTION app.check_price_tier() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pr products;
BEGIN
  SELECT * INTO pr FROM products WHERE id = NEW.product_id;
  IF NEW.price_zmw >= pr.price_zmw THEN
    RAISE EXCEPTION 'A bulk price must be lower than the normal price';
  END IF;
  IF NOT pr.trade AND NEW.min_qty > 99 THEN
    RAISE EXCEPTION 'Bulk prices above 99 need trade quantities turned on';
  END IF;
  IF NEW.min_qty <= pr.min_order_qty THEN
    RAISE EXCEPTION 'A bulk price must start above the minimum order of %', pr.min_order_qty;
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

-- Carts kept with the account hold trade quantities too
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_quantity_check;
ALTER TABLE cart_items ALTER COLUMN quantity TYPE integer;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_check CHECK (quantity BETWEEN 1 AND 9999);

-- ---------- Business buyers ----------
-- Saved with the account and copied onto each order placed for the business. A TPIN is 10 digits.
ALTER TABLE users
  ADD COLUMN business_name text CHECK (char_length(business_name) BETWEEN 2 AND 120 AND business_name = btrim(business_name)),
  ADD COLUMN business_tpin text CHECK (business_tpin ~ '^[0-9]{10}$'),
  ADD COLUMN business_address text CHECK (char_length(business_address) BETWEEN 1 AND 200),
  ADD CONSTRAINT users_business_named CHECK (business_name IS NOT NULL OR (business_tpin IS NULL AND business_address IS NULL));
ALTER TABLE orders
  ADD COLUMN business_name text CHECK (char_length(business_name) BETWEEN 2 AND 120),
  ADD COLUMN business_tpin text CHECK (business_tpin ~ '^[0-9]{10}$'),
  ADD COLUMN business_address text CHECK (char_length(business_address) BETWEEN 1 AND 200),
  ADD COLUMN heavy_delivery boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT orders_business_named CHECK (business_name IS NOT NULL OR (business_tpin IS NULL AND business_address IS NULL));

-- The signed-in buyer saves or clears their business details. NULL business clears them all.
CREATE FUNCTION public.set_business_details(business text, tpin text DEFAULT NULL, address text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid bigint := app.user_id(); v_name text := nullif(btrim(business), '');
  v_tpin text := nullif(regexp_replace(coalesce(tpin, ''), '\s', '', 'g'), ''); v_address text := nullif(btrim(address), '');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in with a verified account first'; END IF;
  IF v_name IS NULL AND (v_tpin IS NOT NULL OR v_address IS NOT NULL) THEN RAISE EXCEPTION 'Add the business name for these business details'; END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Enter a business name of 2 to 120 characters'; END IF;
  IF v_tpin !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Enter the TPIN as 10 digits'; END IF;
  IF char_length(v_address) > 200 THEN RAISE EXCEPTION 'Keep the billing address to 200 characters'; END IF;
  UPDATE users SET business_name = v_name, business_tpin = v_tpin, business_address = v_address WHERE id = uid;
END $$;
REVOKE ALL ON FUNCTION public.set_business_details(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_business_details(text, text, text) TO authenticated;

-- ---------- Placing an order ----------
-- As 015, plus trade quantities, the business details and the heavy-delivery flag.
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
  vc vouchers; n_items int := jsonb_array_length(coalesce(p -> 'items', '[]'));
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
COMMIT;
