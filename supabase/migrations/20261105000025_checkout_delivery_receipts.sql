-- Checkout delivery fees, receipts and courier tracking.
--
-- Delivery is priced per seller parcel from a rate card (zone × speed, plus a charge per kg over
-- what the rate includes), the same rule as js/delivery.js, so the fee in the cart is the fee
-- charged. Free standard delivery applies above shop_settings.free_delivery_min_zmw in the listed
-- zones. Heavy items use the 'truck' rate. A parcel with no rate (or an unknown zone) is left to
-- staff to quote, as before: orders.delivery_zmw stays NULL and payment waits for it.
-- A courier's live price (the courier-quote server function) is stored in delivery_quotes and
-- used at checkout only while it is fresh and for exactly the same cart and destination.
-- Receipts: the buyer (or staff) reads one with public.order_receipt() and can have it sent to a
-- WhatsApp number or an email address through the notifications outbox.
-- Tracking: couriers report parcel events to the courier-webhook server function, which records
-- them with app.record_courier_event(). Courier events are shown to the buyer; a "delivered"
-- event does not by itself complete the order: the handover code or photo evidence still does.
-- The rate card starts empty: nothing is priced until the owner adds real rates.
BEGIN;

-- ---------- Settings ----------
ALTER TABLE shop_settings
  ADD COLUMN free_delivery_min_zmw numeric(12,2) CHECK (free_delivery_min_zmw >= 0),
  ADD COLUMN free_delivery_zones text[] NOT NULL DEFAULT '{town,province}' CHECK (free_delivery_zones <@ '{town,province,country}'),
  ADD COLUMN default_parcel_kg numeric(9,3) NOT NULL DEFAULT 1 CHECK (default_parcel_kg > 0),
  ADD COLUMN delivery_origin_town text CHECK (char_length(btrim(delivery_origin_town)) BETWEEN 1 AND 60),
  ADD COLUMN delivery_origin_province text REFERENCES provinces (id),
  ADD COLUMN same_day_cutoff smallint NOT NULL DEFAULT 11 CHECK (same_day_cutoff BETWEEN 0 AND 23),
  ADD COLUMN same_day_towns text[] NOT NULL DEFAULT '{}',
  ADD COLUMN closed_days smallint[] NOT NULL DEFAULT '{0}' CHECK (closed_days <@ '{0,1,2,3,4,5,6}'),
  ADD COLUMN site_url text NOT NULL DEFAULT 'https://nindejr.github.io/zedsupply/' CHECK (site_url ~ '^https://[^\s]+/$');
ALTER TABLE seller_locations ADD COLUMN same_day boolean NOT NULL DEFAULT false;

-- ---------- Rate card ----------
CREATE TABLE delivery_rates (
  id          bigserial PRIMARY KEY,
  courier_id  text CHECK (courier_id ~ '^[a-z0-9-]{2,60}$'),   -- NULL: Zed Supply's own rate
  zone        text NOT NULL CHECK (zone IN ('town', 'province', 'country')),
  speed       text NOT NULL CHECK (speed IN ('standard', 'express', 'same_day', 'truck')),
  fee_zmw     numeric(10,2) NOT NULL CHECK (fee_zmw >= 0),
  included_kg numeric(9,3) NOT NULL DEFAULT 5 CHECK (included_kg >= 0),
  per_kg_zmw  numeric(10,2) NOT NULL DEFAULT 0 CHECK (per_kg_zmw >= 0),
  min_days    smallint CHECK (min_days BETWEEN 0 AND 60),
  max_days    smallint CHECK (max_days BETWEEN 0 AND 60),
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (min_days IS NULL OR max_days IS NULL OR min_days <= max_days),
  UNIQUE NULLS NOT DISTINCT (courier_id, zone, speed)
);
ALTER TABLE delivery_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads active rates" ON delivery_rates FOR SELECT TO anon, authenticated USING (active OR app.is_staff());
CREATE POLICY "Staff manage rates" ON delivery_rates FOR ALL TO authenticated USING (app.is_staff()) WITH CHECK (app.is_staff());
GRANT SELECT ON delivery_rates TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON delivery_rates TO authenticated;
GRANT USAGE ON SEQUENCE delivery_rates_id_seq TO authenticated;
GRANT ALL ON delivery_rates TO service_role;

-- ---------- Orders and their parcels ----------
ALTER TABLE orders
  ADD COLUMN delivery_speed text CHECK (delivery_speed IN ('standard', 'express', 'same_day')),
  ADD COLUMN delivery_source text CHECK (delivery_source IN ('rate_card', 'courier_api', 'staff')),
  ADD COLUMN receipt_email text CHECK (receipt_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' AND char_length(receipt_email) <= 200);

CREATE TABLE order_parcels (
  order_id     bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  seller_id    text NOT NULL REFERENCES sellers (id),
  zone         text CHECK (zone IN ('town', 'province', 'country')),
  speed        text NOT NULL CHECK (speed IN ('standard', 'express', 'same_day', 'truck')),
  courier_id   text CHECK (courier_id ~ '^[a-z0-9-]{2,60}$'),
  weight_kg    numeric(10,3) NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  fee_zmw      numeric(10,2) CHECK (fee_zmw >= 0),                 -- NULL: still to be quoted
  free         boolean NOT NULL DEFAULT false,
  source       text NOT NULL DEFAULT 'rate_card' CHECK (source IN ('rate_card', 'courier_api', 'staff')),
  min_days     smallint, max_days smallint,
  tracking_ref text CHECK (char_length(tracking_ref) <= 120),
  courier_status text CHECK (courier_status IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned')),
  courier_updated_at timestamptz,
  PRIMARY KEY (order_id, seller_id)
);
CREATE INDEX order_parcels_tracking_idx ON order_parcels (tracking_ref) WHERE tracking_ref IS NOT NULL;
ALTER TABLE order_parcels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parcel parties read" ON order_parcels FOR SELECT TO authenticated USING (
  app.is_staff() OR app.is_seller(seller_id) OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id()));
GRANT SELECT ON order_parcels TO authenticated;
GRANT ALL ON order_parcels TO service_role;

CREATE TABLE courier_tracking_events (
  id                bigserial PRIMARY KEY,
  order_id          bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  seller_id         text NOT NULL REFERENCES sellers (id),
  courier_id        text NOT NULL CHECK (courier_id ~ '^[a-z0-9-]{2,60}$'),
  provider_event_id text NOT NULL CHECK (char_length(provider_event_id) BETWEEN 1 AND 120),
  status            text NOT NULL CHECK (status IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned')),
  description       text CHECK (char_length(description) <= 300),
  location          text CHECK (char_length(location) <= 120),
  occurred_at       timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (courier_id, provider_event_id)
);
CREATE INDEX courier_tracking_order_idx ON courier_tracking_events (order_id, occurred_at);
ALTER TABLE courier_tracking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tracking parties read" ON courier_tracking_events FOR SELECT TO authenticated USING (
  app.is_staff() OR app.is_seller(seller_id) OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id()));
GRANT SELECT ON courier_tracking_events TO authenticated;
GRANT ALL ON courier_tracking_events TO service_role;

-- A courier's live price, saved by the courier-quote function for checkout to use
CREATE TABLE delivery_quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL,
  quote       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
ALTER TABLE delivery_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON delivery_quotes FROM PUBLIC, anon, authenticated;
GRANT ALL ON delivery_quotes TO service_role;

-- ---------- Pricing ----------
-- How far a parcel travels; NULL when either end is unknown
CREATE FUNCTION app.delivery_zone(from_town text, from_province text, to_town text, to_province text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN nullif(btrim(from_town), '') IS NULL OR nullif(btrim(to_town), '') IS NULL THEN NULL
    WHEN lower(btrim(from_town)) = lower(btrim(to_town)) THEN 'town'
    WHEN from_province IS NOT NULL AND from_province = to_province THEN 'province'
    ELSE 'country' END
$$;

-- The same order of fields whatever order the browser sent them in, for matching saved quotes
CREATE FUNCTION app.delivery_request_key(p jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(jsonb_build_object(
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_array(x ->> 'product_id', x ->> 'variant_id', coalesce((x ->> 'quantity')::int, 1))
               ORDER BY x ->> 'product_id', x ->> 'variant_id'), '[]') FROM jsonb_array_elements(coalesce(p -> 'items', '[]')) x),
    'town', lower(btrim(coalesce(p ->> 'buyer_town', ''))), 'province', coalesce(p ->> 'buyer_province_id', ''),
    'speed', coalesce(nullif(p ->> 'delivery_speed', ''), 'standard'), 'courier', coalesce(p ->> 'courier_id', ''),
    'fulfilment', coalesce(nullif(p ->> 'fulfilment', ''), 'delivery'))::text)
$$;

/* delivery_quote(p): p as for place_order (items, buyer_town, buyer_province_id, fulfilment,
   delivery_speed, courier_id) plus items_total_zmw for the free-delivery threshold.
   Returns { speed, parcels: [{ seller_id, zone, speed, weight_kg, fee, free, min_days, max_days,
   pending, note, courier_id, from_town, from_province, to_town, to_province }], total (NULL while
   any parcel waits for a quote), pending }. */
CREATE FUNCTION app.delivery_quote(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s shop_settings; g record; r delivery_rates;
  v_speed text := coalesce(nullif(p ->> 'delivery_speed', ''), 'standard');
  v_courier text := nullif(p ->> 'courier_id', '');
  v_town text := nullif(btrim(p ->> 'buyer_town'), '');
  v_prov text := coalesce(nullif(p ->> 'buyer_province_id', ''), (SELECT province_id FROM towns WHERE lower(name) = lower(v_town) LIMIT 1));
  v_items numeric := coalesce((p ->> 'items_total_zmw')::numeric, 0);
  v_local timestamp := now() AT TIME ZONE 'Africa/Lusaka';
  parcels jsonb := '[]'; v_sp text; v_zone text; v_fee numeric; v_free boolean; v_note text; total numeric := 0; pending boolean := false;
BEGIN
  IF v_speed NOT IN ('standard', 'express', 'same_day') THEN RAISE EXCEPTION 'Choose standard, express or same-day delivery'; END IF;
  IF jsonb_array_length(coalesce(p -> 'items', '[]')) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'An order has 1 to 50 lines'; END IF;
  IF coalesce(nullif(p ->> 'fulfilment', ''), 'delivery') <> 'delivery' OR nullif(p ->> 'pickup_point_id', '') IS NOT NULL THEN
    RETURN jsonb_build_object('speed', NULL, 'parcels', '[]'::jsonb, 'total', 0, 'pending', false);
  END IF;
  SELECT * INTO s FROM shop_settings;
  FOR g IN
    SELECT pr.seller_id, bool_or(pr.heavy_delivery) AS heavy,
           sum(coalesce(pr.unit_weight_kg, s.default_parcel_kg) * greatest(coalesce((x ->> 'quantity')::int, 1), 1)) AS kg,
           min(coalesce(l.town, s.delivery_origin_town)) AS from_town,
           min(CASE WHEN l.seller_id IS NOT NULL THEN l.province_id ELSE s.delivery_origin_province END) AS from_prov,
           bool_and(coalesce(l.same_day, false)) AS same_day
    FROM jsonb_array_elements(p -> 'items') x
    JOIN products pr ON pr.id = x ->> 'product_id'
    LEFT JOIN seller_locations l ON l.seller_id = pr.seller_id
    GROUP BY pr.seller_id ORDER BY pr.seller_id
  LOOP
    v_zone := app.delivery_zone(g.from_town, g.from_prov, v_town, v_prov);
    v_sp := CASE WHEN g.heavy THEN 'truck' ELSE v_speed END;
    v_fee := NULL; v_free := false; v_note := NULL; r := NULL;
    IF v_zone IS NULL THEN v_note := 'location';
    ELSE
      -- Same day: the seller offers it, same town, a same-day town, a working day before the cut-off
      IF v_sp = 'same_day' AND NOT (g.same_day AND v_zone = 'town'
          AND EXISTS (SELECT 1 FROM unnest(s.same_day_towns) t WHERE lower(btrim(t)) = lower(v_town))
          AND extract(hour FROM v_local) < s.same_day_cutoff AND NOT (extract(dow FROM v_local)::smallint = ANY (s.closed_days))) THEN
        v_sp := 'express'; v_note := 'fallback';
      END IF;
      LOOP
        SELECT * INTO r FROM delivery_rates d WHERE d.active AND d.zone = v_zone AND d.speed = v_sp
          AND (d.courier_id = v_courier OR d.courier_id IS NULL) ORDER BY d.courier_id IS NULL LIMIT 1;
        EXIT WHEN FOUND OR v_sp NOT IN ('same_day', 'express');
        v_sp := CASE v_sp WHEN 'same_day' THEN 'express' ELSE 'standard' END; v_note := 'fallback';
      END LOOP;
      IF r.id IS NULL THEN v_note := CASE WHEN g.heavy THEN 'truck' ELSE 'no-rate' END;
      ELSIF v_sp = 'standard' AND s.free_delivery_min_zmw IS NOT NULL AND v_items >= s.free_delivery_min_zmw AND v_zone = ANY (s.free_delivery_zones) THEN
        v_fee := 0; v_free := true;
      ELSE v_fee := r.fee_zmw + greatest(0, ceil(round(g.kg - r.included_kg, 2))) * r.per_kg_zmw;
      END IF;
    END IF;
    IF v_fee IS NULL THEN pending := true; ELSE total := total + v_fee; END IF;
    parcels := parcels || jsonb_build_object('seller_id', g.seller_id, 'zone', v_zone, 'speed', v_sp, 'weight_kg', round(g.kg, 3), 'fee', v_fee, 'free', v_free,
      'min_days', CASE WHEN v_sp = 'same_day' THEN 0 ELSE r.min_days END, 'max_days', CASE WHEN v_sp = 'same_day' THEN 0 ELSE r.max_days END,
      'pending', v_fee IS NULL, 'note', v_note, 'courier_id', coalesce(r.courier_id, v_courier),
      'from_town', g.from_town, 'from_province', g.from_prov, 'to_town', v_town, 'to_province', v_prov);
  END LOOP;
  RETURN jsonb_build_object('speed', v_speed, 'parcels', parcels, 'total', CASE WHEN pending THEN NULL ELSE total END, 'pending', pending);
END $$;
REVOKE ALL ON FUNCTION app.delivery_quote(jsonb) FROM PUBLIC, anon, authenticated;

-- For the storefront: an estimate from the rate card. Checkout prices it again for real.
CREATE FUNCTION public.delivery_quote(p jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.delivery_quote(p - 'pickup_point_id')
$$;
REVOKE ALL ON FUNCTION public.delivery_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_quote(jsonb) TO anon, authenticated, service_role;

-- The courier-quote function saves a quote that includes a courier's live prices
CREATE FUNCTION app.save_delivery_quote(p jsonb, q jsonb) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM delivery_quotes WHERE expires_at < now() - interval '1 day';
  INSERT INTO delivery_quotes (request_key, quote) VALUES (app.delivery_request_key(p), q) RETURNING id
$$;
REVOKE ALL ON FUNCTION app.save_delivery_quote(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.save_delivery_quote(jsonb, jsonb) TO service_role;

-- ---------- Checkout: items as before, then delivery ----------
CREATE OR REPLACE FUNCTION app.place_order(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE result jsonb; o orders; q jsonb; saved jsonb; live jsonb; parcel jsonb; v_source text := 'rate_card'; v_email text := nullif(btrim(p ->> 'receipt_email'), '');
BEGIN
  IF p ? 'expected_total_zmw' AND EXISTS (SELECT 1 FROM shop_settings WHERE vat_registered AND NOT vat_registration_verified) THEN
    RAISE EXCEPTION 'VAT registration settings must be verified before accepting online orders';
  END IF;
  IF coalesce(nullif(p ->> 'delivery_speed', ''), 'standard') NOT IN ('standard', 'express', 'same_day') THEN RAISE EXCEPTION 'Choose standard, express or same-day delivery'; END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' OR char_length(v_email) > 200) THEN RAISE EXCEPTION 'Enter a valid email address for your receipt'; END IF;
  result := app.place_order_v15(p);
  IF p ? 'expected_total_zmw' AND (p ->> 'expected_total_zmw')::numeric IS DISTINCT FROM (result ->> 'total')::numeric THEN
    RAISE EXCEPTION 'The price changed. Review the latest total before placing your order.';
  END IF;
  SELECT * INTO o FROM orders WHERE id = (result ->> 'order_id')::bigint;
  IF (result ->> 'replayed')::boolean THEN
    RETURN result || jsonb_build_object('delivery', o.delivery_zmw, 'delivery_pending', o.fulfilment = 'delivery' AND o.delivery_zmw IS NULL,
      'grand_total', o.total_zmw + coalesce(o.delivery_zmw, 0));
  END IF;

  q := app.delivery_quote(p || jsonb_build_object('items_total_zmw', (result ->> 'total')::numeric, 'fulfilment', o.fulfilment));
  -- A courier's live price, if the buyer was shown one for exactly this cart and it's still fresh
  IF nullif(p ->> 'delivery_quote_id', '') IS NOT NULL THEN
    SELECT quote INTO saved FROM delivery_quotes WHERE id = (p ->> 'delivery_quote_id')::uuid AND expires_at > now() AND request_key = app.delivery_request_key(p);
    IF saved IS NULL THEN RAISE EXCEPTION 'Your delivery quote has expired. Review the delivery fee again.'; END IF;
    SELECT jsonb_agg(CASE WHEN (x ->> 'free')::boolean OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(saved -> 'parcels') y
             WHERE y ->> 'seller_id' = x ->> 'seller_id' AND y ->> 'source' = 'courier_api' AND (y ->> 'fee') IS NOT NULL) THEN x
           ELSE x || (SELECT jsonb_build_object('fee', (y ->> 'fee')::numeric, 'pending', false, 'source', 'courier_api',
             'min_days', y -> 'min_days', 'max_days', y -> 'max_days') FROM jsonb_array_elements(saved -> 'parcels') y
             WHERE y ->> 'seller_id' = x ->> 'seller_id' AND y ->> 'source' = 'courier_api' LIMIT 1) END)
      INTO live FROM jsonb_array_elements(q -> 'parcels') x;
    q := jsonb_set(q, '{parcels}', coalesce(live, '[]'));
    q := q || jsonb_build_object('pending', EXISTS (SELECT 1 FROM jsonb_array_elements(q -> 'parcels') x WHERE (x ->> 'fee') IS NULL));
    q := q || jsonb_build_object('total', CASE WHEN (q ->> 'pending')::boolean THEN NULL
      ELSE (SELECT sum((x ->> 'fee')::numeric) FROM jsonb_array_elements(q -> 'parcels') x) END);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(q -> 'parcels') x WHERE x ->> 'source' = 'courier_api') THEN v_source := 'courier_api'; END IF;
  END IF;
  IF p ? 'expected_delivery_zmw' AND (p ->> 'expected_delivery_zmw')::numeric IS DISTINCT FROM (q ->> 'total')::numeric THEN
    RAISE EXCEPTION 'The delivery fee changed. Review the latest total before placing your order.';
  END IF;
  FOR parcel IN SELECT * FROM jsonb_array_elements(q -> 'parcels') LOOP
    INSERT INTO order_parcels (order_id, seller_id, zone, speed, courier_id, weight_kg, fee_zmw, free, source, min_days, max_days)
    VALUES (o.id, parcel ->> 'seller_id', parcel ->> 'zone', parcel ->> 'speed', parcel ->> 'courier_id', (parcel ->> 'weight_kg')::numeric,
      (parcel ->> 'fee')::numeric, (parcel ->> 'free')::boolean, coalesce(parcel ->> 'source', 'rate_card'),
      (parcel ->> 'min_days')::smallint, (parcel ->> 'max_days')::smallint);
  END LOOP;
  UPDATE orders SET delivery_zmw = CASE WHEN o.fulfilment = 'delivery' THEN (q ->> 'total')::numeric ELSE delivery_zmw END,
    delivery_speed = CASE WHEN o.fulfilment = 'delivery' THEN coalesce(nullif(p ->> 'delivery_speed', ''), 'standard') END,
    delivery_source = CASE WHEN o.fulfilment = 'delivery' AND (q ->> 'total') IS NOT NULL THEN v_source END,
    receipt_email = v_email
  WHERE id = o.id RETURNING * INTO o;
  -- A receipt by email when the buyer asked for one; WhatsApp gets the order_placed message already
  IF v_email IS NOT NULL THEN
    INSERT INTO notifications (user_id, order_id, channel, to_address, template, payload)
    VALUES (o.user_id, o.id, 'email', v_email, 'order_receipt', jsonb_build_object('ref', o.ref, 'name', coalesce(o.contact_name, ''),
      'total', o.total_zmw + coalesce(o.delivery_zmw, 0), 'delivery_pending', o.fulfilment = 'delivery' AND o.delivery_zmw IS NULL));
  END IF;
  RETURN result || jsonb_build_object('delivery', o.delivery_zmw, 'delivery_pending', o.fulfilment = 'delivery' AND o.delivery_zmw IS NULL,
    'delivery_speed', o.delivery_speed, 'parcels', q -> 'parcels', 'grand_total', o.total_zmw + coalesce(o.delivery_zmw, 0));
END $$;

-- The quote now carries the delivery fee and whether it's still pending
CREATE OR REPLACE FUNCTION public.checkout_quote(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE uid bigint := app.user_id(); result jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in with a verified account first'; END IF;
  IF EXISTS (SELECT 1 FROM shop_settings WHERE vat_registered AND NOT vat_registration_verified) THEN
    RAISE EXCEPTION 'VAT registration settings must be verified before quoting online orders';
  END IF;
  -- The subtransaction rolls back stock, orders, parcels, notifications and other effects.
  BEGIN
    result := app.place_order((p - 'user_id' - 'expected_total_zmw' - 'expected_delivery_zmw' - 'receipt_email') || jsonb_build_object('user_id', uid,
      'ref', 'ZS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))));
    RAISE EXCEPTION USING ERRCODE = 'ZQ001', MESSAGE = 'quote rollback';
  EXCEPTION WHEN SQLSTATE 'ZQ001' THEN
    RETURN (result - 'order_id' - 'ref' - 'replayed') || jsonb_build_object('currency', 'ZMW');
  END;
END $$;

-- Couriers' tracking numbers, from the seller's dispatch record, reach the parcel
CREATE FUNCTION app.parcel_tracking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.tracking_ref IS NOT NULL THEN
    UPDATE order_parcels SET tracking_ref = NEW.tracking_ref WHERE order_id = NEW.order_id AND seller_id = NEW.seller_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.parcel_tracking() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER shipment_events_parcel_tracking AFTER INSERT ON shipment_events FOR EACH ROW EXECUTE FUNCTION app.parcel_tracking();

-- ---------- Courier tracking events (courier-webhook) ----------
CREATE FUNCTION app.record_courier_event(p_courier text, p_event_id text, p_tracking text, p_status text,
  p_description text, p_location text, p_occurred timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pc order_parcels; o orders; new_id bigint;
BEGIN
  IF p_status NOT IN ('booked', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned') THEN RAISE EXCEPTION 'Unknown courier status'; END IF;
  SELECT * INTO pc FROM order_parcels WHERE tracking_ref = p_tracking AND (courier_id = p_courier OR courier_id IS NULL)
    ORDER BY courier_id IS NULL LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown tracking number'; END IF;
  INSERT INTO courier_tracking_events (order_id, seller_id, courier_id, provider_event_id, status, description, location, occurred_at)
  VALUES (pc.order_id, pc.seller_id, p_courier, p_event_id, p_status, left(p_description, 300), left(p_location, 120), coalesce(p_occurred, now()))
  ON CONFLICT (courier_id, provider_event_id) DO NOTHING RETURNING id INTO new_id;
  IF new_id IS NULL THEN RETURN jsonb_build_object('recorded', false, 'replayed', true); END IF;
  -- The latest event by time decides the parcel's status, whatever order the courier sends them in
  UPDATE order_parcels SET courier_id = coalesce(courier_id, p_courier),
    courier_status = (SELECT status FROM courier_tracking_events e WHERE e.order_id = pc.order_id AND e.seller_id = pc.seller_id ORDER BY occurred_at DESC, id DESC LIMIT 1),
    courier_updated_at = now()
  WHERE order_id = pc.order_id AND seller_id = pc.seller_id;
  IF p_status IN ('out_for_delivery', 'delivered', 'failed') THEN
    SELECT * INTO o FROM orders WHERE id = pc.order_id;
    PERFORM app.queue_notification(o.user_id, o.id, 'parcel_update', jsonb_build_object('ref', o.ref, 'status', p_status), o.recipient_phone);
  END IF;
  RETURN jsonb_build_object('recorded', true, 'order_id', pc.order_id, 'seller_id', pc.seller_id);
END $$;
REVOKE ALL ON FUNCTION app.record_courier_event(text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.record_courier_event(text, text, text, text, text, text, timestamptz) TO service_role;

-- ---------- Receipts ----------
CREATE FUNCTION public.order_receipt(order_ref text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders;
BEGIN
  SELECT * INTO o FROM orders WHERE ref = upper(btrim(order_ref));
  IF NOT FOUND OR app.user_id() IS NULL OR NOT (o.user_id = app.user_id() OR app.is_staff()) THEN RAISE EXCEPTION 'No order with that reference on your account'; END IF;
  RETURN jsonb_build_object(
    'ref', o.ref, 'created_at', o.created_at, 'status', o.status, 'payment_status', o.payment_status, 'payment_method', o.payment_method,
    'name', coalesce(o.contact_name, (SELECT name FROM users WHERE id = o.user_id)), 'fulfilment', o.fulfilment, 'deliver_to', o.deliver_to,
    'buyer_town', o.buyer_town, 'business_name', o.business_name, 'business_tpin', o.business_tpin, 'business_address', o.business_address,
    'hide_prices', o.hide_prices, 'subtotal', o.subtotal_zmw, 'discount', o.discount_zmw, 'voucher_code', o.voucher_code,
    'vat', o.vat_zmw, 'vat_rate', o.vat_rate, 'vat_included', o.vat_included, 'total', o.total_zmw, 'delivery', o.delivery_zmw,
    'delivery_speed', o.delivery_speed, 'paid', o.paid_zmw, 'grand_total', o.total_zmw + coalesce(o.delivery_zmw, 0),
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('title', pr.title, 'seller', s.name, 'quantity', i.quantity,
        'unit_price', i.unit_price_zmw + coalesce((SELECT sum(a.price_zmw) FROM order_item_addons a WHERE a.order_item_id = i.id), 0)) ORDER BY i.id), '[]')
      FROM order_items i JOIN products pr ON pr.id = i.product_id JOIN sellers s ON s.id = pr.seller_id WHERE i.order_id = o.id),
    'parcels', (SELECT coalesce(jsonb_agg(jsonb_build_object('seller', s.name, 'seller_id', pc.seller_id, 'speed', pc.speed, 'fee', pc.fee_zmw, 'free', pc.free,
        'courier_id', pc.courier_id, 'tracking', pc.tracking_ref, 'courier_status', pc.courier_status, 'min_days', pc.min_days, 'max_days', pc.max_days) ORDER BY pc.seller_id), '[]')
      FROM order_parcels pc JOIN sellers s ON s.id = pc.seller_id WHERE pc.order_id = o.id),
    'shop', (SELECT jsonb_build_object('site_url', site_url, 'vat_registered', vat_registered) FROM shop_settings));
END $$;
REVOKE ALL ON FUNCTION public.order_receipt(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_receipt(text) TO authenticated;

-- Send the receipt to a WhatsApp number or an email address: five a day per order
CREATE FUNCTION public.send_receipt(order_ref text, channel text, destination text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders; v_to text := btrim(coalesce(destination, ''));
BEGIN
  SELECT * INTO o FROM orders WHERE ref = upper(btrim(order_ref));
  IF NOT FOUND OR app.user_id() IS NULL OR NOT (o.user_id = app.user_id() OR app.is_staff()) THEN RAISE EXCEPTION 'No order with that reference on your account'; END IF;
  IF channel = 'whatsapp' THEN
    v_to := regexp_replace(v_to, '[\s()-]', '', 'g');
    IF v_to ~ '^0[0-9]{9}$' THEN v_to := '+260' || substr(v_to, 2); END IF;
    IF v_to !~ '^\+?260[0-9]{9}$' THEN RAISE EXCEPTION 'Enter a Zambian WhatsApp number, like +260 97 123 4567'; END IF;
    IF left(v_to, 1) <> '+' THEN v_to := '+' || v_to; END IF;
  ELSIF channel = 'email' THEN
    IF v_to !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' OR char_length(v_to) > 200 THEN RAISE EXCEPTION 'Enter a valid email address'; END IF;
  ELSE RAISE EXCEPTION 'Send it by WhatsApp or email';
  END IF;
  IF (SELECT count(*) FROM notifications n WHERE n.order_id = o.id AND n.template = 'order_receipt' AND n.created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'This receipt has been sent five times today. Try again tomorrow, or download it.';
  END IF;
  INSERT INTO notifications (user_id, order_id, channel, to_address, template, payload)
  VALUES (o.user_id, o.id, channel, v_to, 'order_receipt', jsonb_build_object('ref', o.ref, 'name', coalesce(o.contact_name, (SELECT name FROM users WHERE id = o.user_id), ''),
    'total', o.total_zmw + coalesce(o.delivery_zmw, 0), 'delivery_pending', o.fulfilment = 'delivery' AND o.delivery_zmw IS NULL));
  RETURN jsonb_build_object('queued', true, 'channel', channel);
END $$;
REVOKE ALL ON FUNCTION public.send_receipt(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_receipt(text, text, text) TO authenticated;

-- The sender claims one channel at a time (WhatsApp and email have separate providers)
CREATE FUNCTION app.claim_notifications(p_channel text)
RETURNS SETOF public.notifications LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE notifications SET status = 'failed', claimed_at = NULL, claim_token = NULL,
    last_error = 'Delivery lease expired after final attempt'
    WHERE channel = p_channel AND status = 'processing' AND claimed_at < now() - interval '10 minutes' AND attempts >= 5;
  RETURN QUERY
    WITH candidates AS (
      SELECT id FROM notifications
      WHERE channel = p_channel AND attempts < 5
        AND (status = 'queued' OR (status = 'processing' AND claimed_at < now() - interval '10 minutes'))
      ORDER BY created_at, id LIMIT 20 FOR UPDATE SKIP LOCKED
    )
    UPDATE notifications n SET status = 'processing', attempts = n.attempts + 1,
      claimed_at = now(), claim_token = gen_random_uuid()
    FROM candidates c WHERE n.id = c.id RETURNING n.*;
END $$;
REVOKE ALL ON FUNCTION app.claim_notifications(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.claim_notifications(text) TO service_role;

COMMIT;
