-- Checkout integrity (PostgreSQL 15+). Apply after 001–013.
-- Orders are placed by app.place_order() from a server function: prices, promotions, deals,
-- offers, add-ons, vouchers and VAT are worked out here from the database, never taken from
-- the browser; stock is locked and taken in the same transaction, so the last item can't be
-- sold twice; and the order reference doubles as an idempotency key, so a double click or a
-- retried request after a dropped connection returns the first order instead of a second one.
-- Also: guest orders, stock counts for products without variations, carts kept per account,
-- limits on how fast one account can post, typo-tolerant search, and missing indexes.
BEGIN;

-- ---------- Stock and guest orders ----------
-- Products without variations can count their stock; NULL means not counted (sourced on request)
ALTER TABLE products ADD COLUMN stock_qty integer CHECK (stock_qty >= 0);
GRANT INSERT (stock_qty), UPDATE (stock_qty) ON products TO authenticated;

-- A guest order has no account but must have a phone number to reach the buyer
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN contact_name text CHECK (char_length(btrim(contact_name)) BETWEEN 1 AND 60),
  ADD CONSTRAINT orders_guest_contact CHECK (user_id IS NOT NULL OR (recipient_phone IS NOT NULL AND contact_name IS NOT NULL));
-- Whether placing the order took stock, so a cancellation gives back exactly that
ALTER TABLE order_items ADD COLUMN stock_taken boolean NOT NULL DEFAULT false;

-- VAT settings the server applies (js/catalogue.js settings.vat); one row
CREATE TABLE shop_settings (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  vat_rate     numeric(5,2) NOT NULL DEFAULT 16 CHECK (vat_rate >= 0 AND vat_rate < 100),
  vat_included boolean NOT NULL DEFAULT true,
  vat_registered boolean NOT NULL DEFAULT true
);
INSERT INTO shop_settings DEFAULT VALUES;
ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read" ON shop_settings FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON shop_settings TO anon, authenticated;
GRANT ALL ON shop_settings TO service_role;

-- ---------- Placing an order ----------
-- p: { ref, user_id, contact_name, recipient_phone, fulfilment, buyer_town, buyer_province_id,
--      collection_point, deliver_to, address_id, delivery_scope, courier_id, preferred_date,
--      preferred_slot, is_gift, gift_message, hide_prices, payment_method, voucher_code, notes,
--      items: [{ product_id, variant_id, quantity, addons: [component ids], commitment_id }] }
-- user_id comes from the verified sign-in in the server function, never from the browser.
-- Returns { order_id, ref, subtotal, discount, vat, total, replayed }.
CREATE FUNCTION app.place_order(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ref text := p ->> 'ref';
  v_user bigint := (p ->> 'user_id')::bigint;
  v_prov text := nullif(p ->> 'buyer_province_id', '');
  o orders; it record; pr products; va product_variants; cm price_commitments; s shop_settings;
  v_order bigint; v_item bigint; base numeric; unit numeric; promo_off smallint; deal_price numeric;
  src text; adds numeric; subtotal numeric := 0; discount numeric := 0; total numeric; vat numeric := 0;
  taxable numeric := 0; taxable_total numeric;
  vc vouchers; n_items int := jsonb_array_length(coalesce(p -> 'items', '[]'));
  v_today date := (now() AT TIME ZONE 'Africa/Lusaka')::date;   -- promotions and deals run on Zambian dates
BEGIN
  IF v_ref IS NULL OR v_ref !~ '^ZS-[A-Z0-9]{4,12}$' THEN RAISE EXCEPTION 'A valid order reference is needed'; END IF;
  IF n_items NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'An order has 1 to 50 lines'; END IF;

  -- Same reference again (double click, retry): return the first order, never a second one
  SELECT * INTO o FROM orders WHERE ref = v_ref;
  IF FOUND THEN
    IF o.user_id IS DISTINCT FROM v_user OR (v_user IS NULL AND
       o.recipient_phone IS DISTINCT FROM nullif(btrim(p ->> 'recipient_phone'), '')) THEN RAISE EXCEPTION 'This order reference is already used'; END IF;
    RETURN jsonb_build_object('order_id', o.id, 'ref', o.ref, 'subtotal', o.subtotal_zmw, 'discount', o.discount_zmw,
      'vat', o.vat_zmw, 'total', o.total_zmw, 'replayed', true);
  END IF;
  BEGIN
    INSERT INTO orders (user_id, ref, status, contact_name, recipient_phone, fulfilment, buyer_town, buyer_province_id,
      collection_point, deliver_to, address_id, delivery_scope, courier_id, preferred_date, preferred_slot, is_gift,
      gift_message, hide_prices, payment_method, notes)
    VALUES (v_user, v_ref, 'placed', nullif(btrim(p ->> 'contact_name'), ''), nullif(btrim(p ->> 'recipient_phone'), ''),
      coalesce(p ->> 'fulfilment', 'delivery'), nullif(btrim(p ->> 'buyer_town'), ''), v_prov,
      nullif(btrim(p ->> 'collection_point'), ''), nullif(btrim(p ->> 'deliver_to'), ''), (p ->> 'address_id')::bigint,
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
      'vat', o.vat_zmw, 'total', o.total_zmw, 'replayed', true);
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
    base := pr.price_zmw;
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
    -- lower live deal; an accepted offer replaces both
    unit := base; src := 'fixed';
    SELECT max(pm.discount) INTO promo_off FROM promotions pm JOIN promotion_products pp ON pp.promotion_id = pm.id
     WHERE pp.product_id = it.product_id AND v_today BETWEEN pm.starts AND pm.ends
       AND (NOT EXISTS (SELECT 1 FROM promotion_areas a WHERE a.promotion_id = pm.id)
            OR EXISTS (SELECT 1 FROM promotion_areas a WHERE a.promotion_id = pm.id AND a.province_id = v_prov));
    IF promo_off IS NOT NULL THEN unit := round(base * (100 - promo_off) / 100, 2); src := 'promotion'; END IF;
    SELECT d.price_zmw INTO deal_price FROM deals d
     WHERE d.product_id = it.product_id AND d.starts <= v_today AND (d.ends IS NULL OR d.ends >= v_today);
    IF deal_price IS NOT NULL AND deal_price < unit THEN unit := deal_price; src := 'deal'; END IF;
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
  SELECT * INTO s FROM shop_settings;
  IF s.vat_registered AND s.vat_included THEN vat := round(taxable_total * s.vat_rate / (100 + s.vat_rate), 2);
  ELSIF s.vat_registered THEN vat := round(taxable_total * s.vat_rate / 100, 2); total := total + vat; END IF;
  -- The delivery fee is confirmed with the buyer afterwards, so it stays empty here
  UPDATE orders SET subtotal_zmw = subtotal, discount_zmw = discount,
    voucher_code = CASE WHEN discount > 0 THEN vc.code END,
    vat_rate = CASE WHEN s.vat_registered THEN s.vat_rate END, vat_included = s.vat_included, vat_zmw = vat, total_zmw = total
  WHERE id = v_order;
  RETURN jsonb_build_object('order_id', v_order, 'ref', v_ref, 'subtotal', subtotal, 'discount', discount,
    'vat', vat, 'total', total, 'replayed', false);
END $$;
REVOKE EXECUTE ON FUNCTION app.place_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.place_order(jsonb) TO service_role;

-- A cancelled order gives back the stock it took
CREATE FUNCTION app.return_cancelled_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it order_items;
BEGIN
  FOR it IN SELECT * FROM order_items WHERE order_id = NEW.id AND stock_taken ORDER BY product_id, variant_id NULLS FIRST LOOP
    IF it.variant_id IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty + it.quantity WHERE id = it.variant_id;
    ELSE
      UPDATE products SET stock_qty = stock_qty + it.quantity WHERE id = it.product_id AND stock_qty IS NOT NULL;
    END IF;
  END LOOP;
  UPDATE order_items SET stock_taken = false WHERE order_id = NEW.id AND stock_taken;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_return_stock AFTER UPDATE OF status ON orders FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') EXECUTE FUNCTION app.return_cancelled_stock();
REVOKE EXECUTE ON FUNCTION app.return_cancelled_stock() FROM PUBLIC, anon, authenticated;

-- ---------- Carts kept with the account ----------
-- Signed-in buyers see the same cart on every device. line_key is the browser's cart line key.
CREATE TABLE cart_items (
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  line_key   text NOT NULL CHECK (char_length(line_key) BETWEEN 1 AND 200),
  product_id text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  quantity   smallint NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  options    jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(options) = 'object' AND pg_column_size(options) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, line_key)
);
CREATE INDEX cart_items_product_idx ON cart_items (product_id);
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Your own cart" ON cart_items FOR ALL TO authenticated
  USING (user_id = (SELECT app.user_id())) WITH CHECK (user_id = (SELECT app.user_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items TO authenticated;
GRANT ALL ON cart_items TO service_role;

-- ---------- How fast one account can post ----------
-- Stops a script filling the database through the API. Applies to signed-in users only; staff
-- and server functions aren't limited. TG_ARGV: key column, time column, most rows, window.
CREATE FUNCTION app.throttle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k text; n bigint;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'authenticated' OR app.is_staff() THEN RETURN NEW; END IF;
  EXECUTE format('SELECT ($1).%I::text', TG_ARGV[0]) INTO k USING NEW;
  IF k IS NULL THEN RETURN NEW; END IF;
  -- One at a time per account and table, so two requests at once can't both slip under the limit
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || k));
  EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = $1 AND %I > now() - $2::interval', TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[1])
    INTO n USING k, TG_ARGV[3];
  IF n >= TG_ARGV[2]::int THEN
    RAISE EXCEPTION 'Too many in a short time. Please wait and try again.' USING ERRCODE = 'P0001', HINT = 'rate_limited';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.throttle() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER complaints_throttle BEFORE INSERT ON complaints FOR EACH ROW EXECUTE FUNCTION app.throttle('user_id', 'created_at', '5', '1 day');
CREATE TRIGGER complaint_messages_throttle BEFORE INSERT ON complaint_messages FOR EACH ROW EXECUTE FUNCTION app.throttle('complaint_id', 'created_at', '30', '1 day');
CREATE TRIGGER complaint_attachments_throttle BEFORE INSERT ON complaint_attachments FOR EACH ROW EXECUTE FUNCTION app.throttle('complaint_id', 'created_at', '10', '1 day');
CREATE TRIGGER reviews_throttle BEFORE INSERT ON reviews FOR EACH ROW EXECUTE FUNCTION app.throttle('user_id', 'created_at', '20', '1 day');
CREATE TRIGGER price_commitments_throttle BEFORE INSERT ON price_commitments FOR EACH ROW EXECUTE FUNCTION app.throttle('buyer_id', 'created_at', '30', '1 hour');
CREATE TRIGGER order_cancellations_throttle BEFORE INSERT ON order_cancellations FOR EACH ROW EXECUTE FUNCTION app.throttle('order_id', 'requested_at', '3', '1 day');
CREATE TRIGGER return_requests_throttle BEFORE INSERT ON return_requests FOR EACH ROW EXECUTE FUNCTION app.throttle('order_item_id', 'requested_at', '3', '1 day');
CREATE TRIGGER products_throttle BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION app.throttle('seller_id', 'created_at', '200', '1 day');
-- A cart holds up to 100 lines
CREATE FUNCTION app.cart_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF (SELECT count(*) FROM cart_items WHERE user_id = NEW.user_id) >= 100 THEN RAISE EXCEPTION 'A cart holds up to 100 lines'; END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.cart_limit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER cart_items_limit BEFORE INSERT ON cart_items FOR EACH ROW EXECUTE FUNCTION app.cart_limit();

-- ---------- Search that forgives typos ----------
-- Matches words and close misspellings in titles and tags ("solr panel" finds "solar panel").
-- Runs with the caller's rights, so row-level security shows only active listings to buyers.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX products_search_trgm ON products USING gin ((lower(title || ' ' || coalesce(tags, ''))) extensions.gin_trgm_ops);
CREATE FUNCTION public.search_products(q text, department text DEFAULT NULL, lim int DEFAULT 24)
RETURNS SETOF products LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions, pg_temp AS $$
  SELECT pr.* FROM products pr
  WHERE pr.status = 'active' AND (department IS NULL OR pr.department_id = department)
    AND char_length(btrim(q)) BETWEEN 2 AND 100
    AND lower(btrim(q)) <% lower(pr.title || ' ' || coalesce(pr.tags, ''))
  ORDER BY word_similarity(lower(btrim(q)), lower(pr.title || ' ' || coalesce(pr.tags, ''))) DESC, pr.total_reviews_count DESC
  LIMIT least(greatest(lim, 1), 60)
$$;
GRANT EXECUTE ON FUNCTION public.search_products(text, text, int) TO anon, authenticated, service_role;

-- ---------- Indexes the rules and joins use ----------
CREATE INDEX complaint_attachments_complaint_idx ON complaint_attachments (complaint_id);
CREATE INDEX complaint_messages_complaint_idx ON complaint_messages (complaint_id, created_at);
CREATE INDEX complaints_order_idx ON complaints (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX complaints_product_idx ON complaints (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX order_items_product_idx ON order_items (product_id);
CREATE INDEX order_items_variant_idx ON order_items (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX price_commitments_variant_idx ON price_commitments (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX promotion_products_product_idx ON promotion_products (product_id);
CREATE INDEX products_brand_idx ON products (brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX products_seller_created_idx ON products (seller_id, created_at);
CREATE INDEX product_option_values_option_idx ON product_option_values (option_id);
CREATE INDEX order_cancellations_order_idx ON order_cancellations (order_id, requested_at);
CREATE INDEX return_requests_item_time_idx ON return_requests (order_item_id, requested_at);

COMMIT;
