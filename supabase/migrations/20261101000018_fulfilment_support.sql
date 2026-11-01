BEGIN;
CREATE TABLE shipment_events (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  seller_id text NOT NULL REFERENCES sellers(id),
  status text NOT NULL CHECK (status IN ('packed','dispatched','delivered','collected','delivery_failed')),
  tracking_ref text CHECK (char_length(tracking_ref) <= 120),
  note text CHECK (char_length(note) <= 500),
  proof_path text CHECK (char_length(proof_path) <= 300),
  created_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_events_order_idx ON shipment_events(order_id,created_at);
ALTER TABLE shipment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shipment parties read" ON shipment_events FOR SELECT TO authenticated USING (
  app.is_staff() OR app.is_seller(seller_id) OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id()));
REVOKE ALL ON shipment_events FROM anon, authenticated;
GRANT SELECT ON shipment_events TO authenticated;
GRANT ALL ON shipment_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE shipment_events_id_seq TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('delivery-proofs','delivery-proofs',false,5242880,ARRAY['image/webp','image/jpeg','image/png','application/pdf']);
CREATE POLICY "Operators upload delivery evidence" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'delivery-proofs' AND (storage.foldername(name))[1] = auth.uid()::text
  AND (app.is_staff() OR EXISTS (SELECT 1 FROM seller_members WHERE user_id = app.user_id())));
CREATE POLICY "Delivery evidence is private to order parties" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'delivery-proofs' AND (app.is_staff() OR (storage.foldername(name))[1] = auth.uid()::text OR EXISTS (
    SELECT 1 FROM shipment_events e JOIN orders o ON o.id = e.order_id WHERE e.proof_path = name AND o.user_id = app.user_id())));

CREATE FUNCTION public.record_shipment(order_ref text, store_id text, new_status text,
  tracking text DEFAULT NULL, message text DEFAULT NULL, evidence text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o orders; last_status text; event_id bigint;
BEGIN
  IF app.user_id() IS NULL OR NOT (app.is_staff() OR app.is_seller(store_id)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
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
REVOKE ALL ON FUNCTION public.record_shipment(text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_shipment(text,text,text,text,text,text) TO authenticated;

ALTER TABLE complaints ADD COLUMN escalated_at timestamptz;
ALTER TABLE complaints ADD COLUMN assigned_to bigint REFERENCES users(id);
ALTER TABLE shop_settings ADD COLUMN support_reply_hours integer CHECK (support_reply_hours BETWEEN 1 AND 720);
CREATE FUNCTION public.open_support_case(order_ref text, problem complaint_type, outcome complaint_want, detail text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid bigint := app.user_id(); account users; oid bigint; result text; hours integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO account FROM users WHERE id = uid;
  IF nullif(order_ref,'') IS NOT NULL THEN
    SELECT id INTO oid FROM orders WHERE ref = order_ref AND user_id = uid;
    IF oid IS NULL THEN RAISE EXCEPTION 'No order was found for your account'; END IF;
  END IF;
  SELECT support_reply_hours INTO hours FROM shop_settings;
  result := 'ZC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  INSERT INTO complaints(ref,user_id,contact_name,contact_phone,order_id,type,wanted,details,reply_due_at)
    VALUES (result,uid,left(coalesce(nullif(account.name,''),account.email,'Verified buyer'),60),account.phone,oid,problem,outcome,detail,
      CASE WHEN hours IS NOT NULL THEN now() + make_interval(hours => hours) END);
  RETURN result;
END $$;
CREATE FUNCTION public.escalate_support_case(case_id bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE complaints SET escalated_at = coalesce(escalated_at,now()) WHERE id = case_id AND user_id = app.user_id() AND status NOT IN ('resolved','closed');
  IF NOT FOUND THEN RAISE EXCEPTION 'No open request was found for your account'; END IF;
END $$;
CREATE FUNCTION public.assign_support_case(case_id bigint, staff_user bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.staff_only('assign support case',case_id::text,jsonb_build_object('assignee',staff_user));
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = staff_user AND is_staff) THEN RAISE EXCEPTION 'Choose a staff account'; END IF;
  UPDATE complaints SET assigned_to = staff_user, acknowledged_at = coalesce(acknowledged_at,now()), status = 'review' WHERE id = case_id AND status NOT IN ('resolved','closed');
  IF NOT FOUND THEN RAISE EXCEPTION 'No open support request'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.open_support_case(text,complaint_type,complaint_want,text),public.escalate_support_case(bigint),public.assign_support_case(bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_support_case(text,complaint_type,complaint_want,text),public.escalate_support_case(bigint),public.assign_support_case(bigint,bigint) TO authenticated;
COMMIT;
