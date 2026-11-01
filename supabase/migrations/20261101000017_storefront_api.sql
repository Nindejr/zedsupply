-- Public catalogue reads remain subject to RLS; identities and checkout stay server-owned.
BEGIN;
ALTER TABLE shop_settings ADD COLUMN vat_registration_verified boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.catalogue_page(search text DEFAULT '', department text DEFAULT NULL,
  after_id text DEFAULT '', page_size integer DEFAULT 24, product_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions, pg_temp AS $$
  SELECT coalesce(jsonb_agg(payload ORDER BY id), '[]'::jsonb) FROM (
    SELECT p.id, to_jsonb(p) || jsonb_build_object(
      'seller', (SELECT to_jsonb(s) FROM sellers s WHERE s.id = p.seller_id),
      'options', coalesce((SELECT jsonb_agg(to_jsonb(o) || jsonb_build_object('values',
        (SELECT jsonb_agg(v ORDER BY v.position, v.id) FROM product_option_values v WHERE v.option_id = o.id))
        ORDER BY o.position, o.id) FROM product_options o WHERE o.product_id = p.id), '[]'::jsonb),
      'variants', coalesce((SELECT jsonb_agg(to_jsonb(v) || jsonb_build_object('values',
        (SELECT jsonb_agg(jsonb_build_object('option_id', x.option_id, 'value_id', x.value_id)) FROM variant_option_values x WHERE x.variant_id = v.id))
        ORDER BY v.id) FROM product_variants v WHERE v.product_id = p.id AND v.active), '[]'::jsonb),
      'components', coalesce((SELECT jsonb_agg(c ORDER BY c.position, c.id) FROM product_components c WHERE c.product_id = p.id), '[]'::jsonb),
      'images', coalesce((SELECT jsonb_agg(i ORDER BY i.position) FROM product_images i WHERE i.product_id = p.id), '[]'::jsonb),
      'tiers', coalesce((SELECT jsonb_agg(t ORDER BY t.min_qty) FROM price_tiers t WHERE t.product_id = p.id), '[]'::jsonb)
    ) AS payload
    FROM products p WHERE p.status = 'active'
      AND (product_id IS NULL OR p.id = product_id)
      AND (department IS NULL OR p.department_id = department)
      AND p.id > coalesce(after_id, '') AND char_length(coalesce(search, '')) <= 100
      AND (nullif(btrim(search), '') IS NULL OR
        to_tsvector('simple', p.title || ' ' || coalesce(p.tags, '') || ' ' || coalesce(p.manufacturer, '')) @@ websearch_to_tsquery('simple', search)
        OR (char_length(btrim(search)) >= 2 AND lower(search) <% lower(p.title || ' ' || coalesce(p.tags, ''))))
    ORDER BY p.id LIMIT least(greatest(coalesce(page_size, 24), 1), 60)
  ) rows
$$;
CREATE INDEX products_search_words ON products USING gin
  (to_tsvector('simple', title || ' ' || coalesce(tags, '') || ' ' || coalesce(manufacturer, ''))) WHERE status = 'active';
REVOKE ALL ON FUNCTION public.catalogue_page(text,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalogue_page(text,text,text,integer,text) TO anon, authenticated, service_role;

-- Wrap existing checkout instead of maintaining another implementation of pricing/stock.
ALTER FUNCTION app.place_order(jsonb) RENAME TO place_order_v15;
REVOKE ALL ON FUNCTION app.place_order_v15(jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION app.place_order(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p ? 'expected_total_zmw' AND EXISTS (SELECT 1 FROM shop_settings WHERE vat_registered AND NOT vat_registration_verified) THEN
    RAISE EXCEPTION 'VAT registration settings must be verified before accepting online orders';
  END IF;
  result := app.place_order_v15(p);
  IF p ? 'expected_total_zmw' AND (p ->> 'expected_total_zmw')::numeric IS DISTINCT FROM (result ->> 'total')::numeric THEN
    RAISE EXCEPTION 'The price changed. Review the latest total before placing your order.';
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.place_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.place_order(jsonb) TO service_role;

CREATE FUNCTION public.checkout_quote(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE uid bigint := app.user_id(); result jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in with a verified account first'; END IF;
  IF EXISTS (SELECT 1 FROM shop_settings WHERE vat_registered AND NOT vat_registration_verified) THEN
    RAISE EXCEPTION 'VAT registration settings must be verified before quoting online orders';
  END IF;
  -- The subtransaction rolls back stock, orders, notifications and other effects.
  BEGIN
    result := app.place_order((p - 'user_id' - 'expected_total_zmw') || jsonb_build_object('user_id', uid,
      'ref', 'ZS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))));
    RAISE EXCEPTION USING ERRCODE = 'ZQ001', MESSAGE = 'quote rollback';
  EXCEPTION WHEN SQLSTATE 'ZQ001' THEN
    RETURN (result - 'order_id' - 'ref' - 'replayed') || jsonb_build_object('currency', 'ZMW', 'delivery_pending', coalesce(p ->> 'fulfilment', 'delivery') <> 'collection');
  END;
END $$;
REVOKE ALL ON FUNCTION public.checkout_quote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_quote(jsonb) TO authenticated;
COMMIT;
