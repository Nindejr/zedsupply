BEGIN;
CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id bigint NOT NULL REFERENCES orders(id),
  attempt_key text NOT NULL CHECK (attempt_key ~ '^PAY-[a-zA-Z0-9-]{8,64}$'),
  provider_reference text NOT NULL UNIQUE,
  amount_zmw numeric(12,2) NOT NULL CHECK (amount_zmw > 0 AND amount_zmw < 'Infinity'),
  currency text NOT NULL DEFAULT 'ZMW' CHECK (currency = 'ZMW'),
  phone text NOT NULL,
  state text NOT NULL DEFAULT 'created' CHECK (state IN ('created','submitted','unknown','failed','confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id,attempt_key)
);
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Buyer reads payment attempts" ON payment_attempts FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id()) OR app.is_staff());
REVOKE ALL ON payment_attempts FROM anon,authenticated;
GRANT SELECT ON payment_attempts TO authenticated;
GRANT ALL ON payment_attempts TO service_role;
CREATE INDEX payment_attempts_pending_idx ON payment_attempts(order_id) WHERE state IN ('created','submitted','unknown');

CREATE FUNCTION app.begin_payment(order_ref text, buyer bigint, recipient text, request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE o orders; a payment_attempts; due numeric; aid uuid := gen_random_uuid();
BEGIN
  SELECT * INTO o FROM orders WHERE ref = order_ref FOR UPDATE;
  IF NOT FOUND OR buyer IS NULL OR o.user_id IS DISTINCT FROM buyer THEN RAISE EXCEPTION 'No order for this verified account'; END IF;
  SELECT * INTO a FROM payment_attempts WHERE order_id = o.id AND attempt_key = request_key;
  IF FOUND THEN RETURN jsonb_build_object('id',a.id,'reference',a.provider_reference,'amount',a.amount_zmw,'send',false,'state',a.state); END IF;
  IF o.status = 'cancelled' THEN RAISE EXCEPTION 'The order is cancelled'; END IF;
  IF o.payment_status = 'refunded' THEN RAISE EXCEPTION 'Refunded orders require support before another payment'; END IF;
  IF o.fulfilment <> 'collection' AND o.delivery_zmw IS NULL THEN RAISE EXCEPTION 'Confirm the delivery fee before requesting payment'; END IF;
  IF EXISTS (SELECT 1 FROM payment_attempts WHERE order_id = o.id AND state IN ('created','submitted','unknown')) THEN
    RAISE EXCEPTION 'A payment request is awaiting confirmation. Ask support to check it before trying again.';
  END IF;
  due := o.total_zmw + coalesce(o.delivery_zmw,0) - o.paid_zmw;
  IF due <= 0 THEN RAISE EXCEPTION 'Nothing is owed'; END IF;
  IF o.payment_plan = 'layby' AND o.paid_zmw = 0 THEN due := least(due,o.deposit_zmw); END IF;
  INSERT INTO payment_attempts(id,order_id,attempt_key,provider_reference,amount_zmw,phone)
    VALUES (aid,o.id,request_key,o.ref || '-' || replace(aid::text,'-',''),due,recipient) RETURNING * INTO a;
  RETURN jsonb_build_object('id',a.id,'reference',a.provider_reference,'amount',a.amount_zmw,'send',true,'state',a.state);
END $$;
REVOKE ALL ON FUNCTION app.begin_payment(text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.begin_payment(text,bigint,text,text) TO service_role;

-- After checking with the provider, staff can close a prompt that never settled so the buyer
-- can try again. Only the provider's webhook can mark money as received.
CREATE FUNCTION public.staff_close_payment_attempt(attempt uuid, note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
BEGIN
  PERFORM app.staff_only('close_payment_attempt',attempt::text,jsonb_build_object('note',note));
  UPDATE payment_attempts SET state = 'failed' WHERE id = attempt AND state IN ('created','submitted','unknown');
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending payment request'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.staff_close_payment_attempt(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_close_payment_attempt(uuid,text) TO authenticated;

-- Duplicate provider references may never change their original order or amount.
ALTER FUNCTION app.record_payment(text,text,text,numeric,text,text,jsonb) RENAME TO record_payment_v15;
REVOKE ALL ON FUNCTION app.record_payment_v15(text,text,text,numeric,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION app.record_payment(p_provider text,p_ref text,p_order_ref text,p_amount numeric,p_status text,p_method text DEFAULT NULL,p_raw jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE old payments; result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_ref,0));
  SELECT * INTO old FROM payments WHERE provider = p_provider AND provider_ref = p_ref;
  IF FOUND AND (old.amount_zmw IS DISTINCT FROM p_amount OR old.order_id IS DISTINCT FROM (SELECT id FROM orders WHERE ref = p_order_ref)) THEN
    RAISE EXCEPTION 'A payment reference cannot change its order or amount';
  END IF;
  IF old.status = 'refunded' AND p_status = 'paid' THEN p_status := 'refunded'; END IF;
  IF EXISTS (SELECT 1 FROM payment_attempts a WHERE a.provider_reference = p_raw ->> 'reference'
    AND (a.amount_zmw IS DISTINCT FROM p_amount OR a.order_id IS DISTINCT FROM (SELECT id FROM orders WHERE ref = p_order_ref))) THEN
    RAISE EXCEPTION 'Settlement does not match the requested payment';
  END IF;
  IF p_amount <> round(p_amount,2) OR p_amount <= 0 OR p_amount >= 'Infinity'::numeric THEN RAISE EXCEPTION 'Invalid payment amount'; END IF;
  result := app.record_payment_v15(p_provider,p_ref,p_order_ref,p_amount,p_status,p_method,p_raw);
  -- Providers that don't echo our reference settle the order's one pending request of that amount.
  UPDATE payment_attempts SET state = CASE WHEN p_status = 'paid' THEN 'confirmed' WHEN p_status = 'failed' THEN 'failed' ELSE state END
    WHERE order_id = (SELECT id FROM orders WHERE ref = p_order_ref) AND amount_zmw = p_amount
      AND (provider_reference = p_raw ->> 'reference'
        OR (p_raw ->> 'reference' IS NULL AND state IN ('created','submitted','unknown')));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.record_payment(text,text,text,numeric,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.record_payment(text,text,text,numeric,text,text,jsonb) TO service_role;

-- Refund execution requires the chosen provider. Keep a separate, immutable reconciliation ledger.
CREATE TABLE refund_events (
  id bigserial PRIMARY KEY,
  payment_id bigint NOT NULL REFERENCES payments(id),
  provider_ref text NOT NULL UNIQUE CHECK (char_length(provider_ref) BETWEEN 1 AND 120),
  amount_zmw numeric(12,2) NOT NULL CHECK (amount_zmw > 0 AND amount_zmw < 'Infinity'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE refund_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Buyer sees reconciled refunds" ON refund_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = payment_id AND o.user_id = app.user_id()) OR app.is_staff());
REVOKE ALL ON refund_events FROM anon,authenticated;
GRANT SELECT ON refund_events TO authenticated;
GRANT ALL ON refund_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE refund_events_id_seq TO service_role;
CREATE FUNCTION app.record_refund(payment bigint,refund_reference text,amount numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE p payments; old refund_events; refunded numeric;
BEGIN
  SELECT * INTO p FROM payments WHERE id = payment FOR UPDATE;
  IF NOT FOUND OR p.status NOT IN ('paid','refunded') THEN RAISE EXCEPTION 'No settled payment'; END IF;
  SELECT * INTO old FROM refund_events WHERE provider_ref = refund_reference;
  IF FOUND THEN IF old.payment_id = payment AND old.amount_zmw = amount THEN RETURN; ELSE RAISE EXCEPTION 'Refund reference already used'; END IF; END IF;
  SELECT coalesce(sum(amount_zmw),0) INTO refunded FROM refund_events WHERE payment_id = payment;
  IF amount <> round(amount,2) OR amount <= 0 OR amount > p.amount_zmw - refunded THEN RAISE EXCEPTION 'Refund exceeds the remaining settled payment'; END IF;
  INSERT INTO refund_events(payment_id,provider_ref,amount_zmw) VALUES (payment,refund_reference,amount);
  UPDATE seller_payouts SET status = 'cancelled' WHERE order_id = p.order_id AND status IN ('held','due');
  IF refunded + amount = p.amount_zmw THEN
    PERFORM app.record_payment(p.provider,p.provider_ref,(SELECT ref FROM orders WHERE id = p.order_id),p.amount_zmw,'refunded',p.method,p.raw);
  END IF;
  -- Keep the settlement ledger separate; partial refund effects require provider reconciliation.
END $$;
REVOKE ALL ON FUNCTION app.record_refund(bigint,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app.record_refund(bigint,text,numeric) TO service_role;
COMMIT;
