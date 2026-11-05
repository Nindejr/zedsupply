-- Guest orders have no user_id. A NULL ownership comparison must deny access.
BEGIN;

CREATE OR REPLACE FUNCTION public.order_receipt(order_ref text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders;
BEGIN
  SELECT * INTO o FROM orders WHERE ref = upper(btrim(order_ref));
  IF NOT FOUND OR app.user_id() IS NULL OR NOT coalesce(o.user_id = app.user_id() OR app.is_staff(), false) THEN RAISE EXCEPTION 'No order with that reference on your account'; END IF;
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

CREATE OR REPLACE FUNCTION public.send_receipt(order_ref text, channel text, destination text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders; v_to text := btrim(coalesce(destination, ''));
BEGIN
  SELECT * INTO o FROM orders WHERE ref = upper(btrim(order_ref));
  IF NOT FOUND OR app.user_id() IS NULL OR NOT coalesce(o.user_id = app.user_id() OR app.is_staff(), false) THEN RAISE EXCEPTION 'No order with that reference on your account'; END IF;
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
  VALUES (o.user_id, o.id, channel, v_to, 'order_receipt', jsonb_build_object('ref', o.ref, 'hide_prices', o.hide_prices, 'name', coalesce(o.contact_name, (SELECT name FROM users WHERE id = o.user_id), ''),
    'total', o.total_zmw + coalesce(o.delivery_zmw, 0), 'delivery_pending', o.fulfilment = 'delivery' AND o.delivery_zmw IS NULL));
  RETURN jsonb_build_object('queued', true, 'channel', channel);
END $$;

COMMIT;
