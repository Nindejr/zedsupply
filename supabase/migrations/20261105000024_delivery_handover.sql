-- Delivery handover codes. Every order gets a private 6-digit code that only the buyer can read.
-- At the door (or the collection counter) the buyer reads it out once the parcel is in their
-- hands; the rider or seller enters it to record the handover. Because the buyer took part, the
-- handover needs no photo evidence and counts as the buyer confirming receipt, which starts the
-- payout hold. Photo evidence (record_shipment) stays available when the buyer can't be there.
-- Staff can't read the codes: only the buyer can, so nobody else can confirm a delivery for them.
BEGIN;

CREATE TABLE order_handover_codes (
  order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE order_handover_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Buyers read their own handover code" ON order_handover_codes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id()));
REVOKE ALL ON order_handover_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT (order_id, code, used_at) ON order_handover_codes TO authenticated;
GRANT ALL ON order_handover_codes TO service_role;

-- Six digits from a random UUID (gen_random_uuid is cryptographically random)
CREATE FUNCTION app.new_handover_code() RETURNS text LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
  SELECT lpad(((('x' || lpad(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), 16, '0'))::bit(64)::bigint) % 1000000)::text, 6, '0')
$$;
REVOKE ALL ON FUNCTION app.new_handover_code() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app.issue_handover_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO order_handover_codes (order_id, code) VALUES (NEW.id, app.new_handover_code()) ON CONFLICT (order_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.issue_handover_code() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_issue_handover_code AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION app.issue_handover_code();

-- Orders still on their way get a code too
INSERT INTO order_handover_codes (order_id, code)
  SELECT id, app.new_handover_code() FROM orders WHERE status NOT IN ('delivered', 'cancelled')
  ON CONFLICT (order_id) DO NOTHING;

-- Shipment events say whether the buyer's code confirmed them
ALTER TABLE shipment_events ADD COLUMN handover boolean NOT NULL DEFAULT false;
ALTER TABLE shipment_events ADD CONSTRAINT shipment_events_handover_status CHECK (NOT handover OR status IN ('delivered', 'collected'));

-- The rider or seller enters the buyer's code. A wrong code is counted and reported rather than
-- raised, so the count is kept; after five wrong codes the order needs photo evidence instead.
CREATE FUNCTION public.record_handover(order_ref text, store_id text, handover_code text, message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders; h order_handover_codes; last_status text; new_status text;
BEGIN
  IF app.user_id() IS NULL OR NOT (app.is_staff() OR app.is_seller(store_id)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF char_length(message) > 500 THEN RAISE EXCEPTION 'Keep the note under 500 characters'; END IF;
  SELECT * INTO o FROM orders WHERE ref = order_ref FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id AND p.seller_id = store_id) THEN
    RAISE EXCEPTION 'No order for this store';
  END IF;
  IF o.status NOT IN ('confirmed', 'dispatched') THEN RAISE EXCEPTION 'Only confirmed orders can be handed over'; END IF;
  SELECT status INTO last_status FROM shipment_events WHERE order_id = o.id AND seller_id = store_id ORDER BY id DESC LIMIT 1;
  new_status := CASE WHEN last_status = 'dispatched' THEN 'delivered'
                     WHEN last_status = 'packed' AND o.fulfilment IN ('collection', 'pickup') THEN 'collected' END;
  IF new_status IS NULL THEN RAISE EXCEPTION 'Record the parcel as dispatched first (or packed, for a collection)'; END IF;
  SELECT * INTO h FROM order_handover_codes WHERE order_id = o.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This order has no handover code. Record the delivery with photo evidence'; END IF;
  IF h.failed_attempts >= 5 THEN RAISE EXCEPTION 'Too many wrong codes. Record the delivery with photo evidence instead'; END IF;
  IF coalesce(regexp_replace(handover_code, '\s', '', 'g'), '') <> h.code THEN
    UPDATE order_handover_codes SET failed_attempts = failed_attempts + 1 WHERE order_id = o.id;
    RETURN jsonb_build_object('ok', false, 'attempts_left', 4 - h.failed_attempts);
  END IF;
  UPDATE order_handover_codes SET used_at = coalesce(used_at, now()) WHERE order_id = o.id;
  INSERT INTO shipment_events (order_id, seller_id, status, note, handover, created_by)
    VALUES (o.id, store_id, new_status, nullif(btrim(message), ''), true, app.user_id());
  IF NOT EXISTS (SELECT 1 FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id AND NOT EXISTS (
    SELECT 1 FROM shipment_events e WHERE e.order_id = o.id AND e.seller_id = p.seller_id AND e.status IN ('delivered', 'collected'))) THEN
    PERFORM app.mark_delivered(o.id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', new_status);
END $$;
REVOKE ALL ON FUNCTION public.record_handover(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_handover(text, text, text, text) TO authenticated;

COMMIT;
