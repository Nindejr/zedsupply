-- Cart reminders: one message when a signed-in buyer leaves items in their cart, and only if they
-- asked for it.
--
-- - Off unless the buyer switches it on in My Account and chooses WhatsApp or email. Switching it
--   off deletes the saved cart and the choice.
-- - While it's on, the site keeps a copy of the cart here (product, option and quantity only).
-- - The daily job sends one reminder when the cart has sat unchanged for a day: not after an
--   order, not if nothing in it can still be bought, not when the cart is more than a week old,
--   and never more than once a week.
-- - The WhatsApp message needs a "cart_reminder" template approved in WhatsApp Manager (Meta
--   will likely class it as marketing). Until then WhatsApp reminders stay queued, as other
--   messages do.
BEGIN;

CREATE TABLE cart_reminders (
  user_id          bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  opted_in_at      timestamptz NOT NULL DEFAULT now(),
  items            jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 50),
  cart_updated_at  timestamptz,
  reminded_at      timestamptz,     -- the reminder for the cart as it is now (cleared when it changes)
  last_reminded_at timestamptz      -- the latest reminder of any cart, for the once-a-week limit
);
CREATE INDEX cart_reminders_due_idx ON cart_reminders (cart_updated_at) WHERE reminded_at IS NULL;
ALTER TABLE cart_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cart_reminders FROM anon, authenticated;   -- only through the functions below

-- The buyer's choice, for My Account
CREATE FUNCTION public.cart_reminder_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r cart_reminders; u users;
BEGIN
  SELECT * INTO u FROM users WHERE id = app.user_id();
  IF u.id IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO r FROM cart_reminders WHERE user_id = u.id;
  RETURN jsonb_build_object('on', r.user_id IS NOT NULL, 'channel', r.channel, 'since', r.opted_in_at,
    'can_whatsapp', u.phone IS NOT NULL, 'can_email', u.email IS NOT NULL);
END $$;

CREATE FUNCTION public.set_cart_reminders(turn_on boolean, p_channel text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u users;
BEGIN
  SELECT * INTO u FROM users WHERE id = app.user_id();
  IF u.id IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT coalesce(turn_on, false) THEN
    DELETE FROM cart_reminders WHERE user_id = u.id;
    RETURN jsonb_build_object('on', false);
  END IF;
  IF p_channel = 'whatsapp' AND u.phone IS NULL THEN RAISE EXCEPTION 'Add a WhatsApp number to your account first, or choose email'; END IF;
  IF p_channel = 'email' AND u.email IS NULL THEN RAISE EXCEPTION 'Your account has no email address: choose WhatsApp'; END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('whatsapp', 'email') THEN RAISE EXCEPTION 'Choose WhatsApp or email'; END IF;
  INSERT INTO cart_reminders (user_id, channel) VALUES (u.id, p_channel)
  ON CONFLICT (user_id) DO UPDATE SET channel = EXCLUDED.channel;
  RETURN jsonb_build_object('on', true, 'channel', p_channel);
END $$;

-- The site sends the cart after each change while reminders are on; otherwise nothing is kept.
-- Products that don't exist on the server (samples, removed listings) are left out.
CREATE FUNCTION public.save_cart(items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid bigint := app.user_id(); clean jsonb; old jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) > 50 THEN RAISE EXCEPTION 'Send up to 50 cart lines'; END IF;
  SELECT r.items INTO old FROM cart_reminders r WHERE r.user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('saved', false); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', x ->> 'product_id', 'sku', nullif(left(x ->> 'sku', 60), ''),
      'quantity', least(greatest(coalesce((x ->> 'quantity')::int, 1), 1), 999)) ORDER BY ord), '[]')
    INTO clean
    FROM jsonb_array_elements(items) WITH ORDINALITY AS t(x, ord)
    WHERE jsonb_typeof(x) = 'object' AND EXISTS (SELECT 1 FROM products p WHERE p.id = x ->> 'product_id');
  IF clean IS DISTINCT FROM old THEN
    UPDATE cart_reminders SET items = clean, cart_updated_at = now(), reminded_at = NULL WHERE user_id = uid;
  END IF;
  RETURN jsonb_build_object('saved', true, 'lines', jsonb_array_length(clean));
END $$;

-- Daily: queue the reminders that are due. Returns how many were queued.
CREATE FUNCTION app.queue_cart_reminders() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; n integer := 0; v_to text; first_title text; buyable integer;
BEGIN
  FOR r IN SELECT c.*, u.name, u.phone, u.email FROM cart_reminders c JOIN users u ON u.id = c.user_id
    WHERE c.reminded_at IS NULL AND jsonb_array_length(c.items) > 0
      AND c.cart_updated_at BETWEEN now() - interval '7 days' AND now() - interval '24 hours'
      AND (c.last_reminded_at IS NULL OR c.last_reminded_at < now() - interval '7 days')
    FOR UPDATE OF c SKIP LOCKED LOOP
    -- Ordered since the cart last changed: no reminder for this cart
    IF EXISTS (SELECT 1 FROM orders o WHERE o.user_id = r.user_id AND o.created_at >= r.cart_updated_at) THEN
      UPDATE cart_reminders SET reminded_at = now() WHERE user_id = r.user_id; CONTINUE;
    END IF;
    SELECT count(*), (array_agg(p.title ORDER BY t.ord))[1] INTO buyable, first_title
      FROM jsonb_array_elements(r.items) WITH ORDINALITY AS t(x, ord) JOIN products p ON p.id = t.x ->> 'product_id'
      WHERE p.status = 'active' AND coalesce(p.stock_qty, 1) > 0;
    v_to := CASE r.channel WHEN 'whatsapp' THEN r.phone ELSE r.email END;
    IF buyable = 0 OR v_to IS NULL THEN
      UPDATE cart_reminders SET reminded_at = now() WHERE user_id = r.user_id; CONTINUE;
    END IF;
    INSERT INTO notifications (user_id, channel, to_address, template, payload)
    VALUES (r.user_id, r.channel, v_to, 'cart_reminder', jsonb_build_object('name', coalesce(nullif(btrim(r.name), ''), 'there'),
      'title', left(first_title, 80), 'more', buyable - 1));
    UPDATE cart_reminders SET reminded_at = now(), last_reminded_at = now() WHERE user_id = r.user_id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION app.queue_cart_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.queue_cart_reminders() TO service_role;
REVOKE ALL ON FUNCTION public.cart_reminder_settings(), public.set_cart_reminders(boolean, text), public.save_cart(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cart_reminder_settings(), public.set_cart_reminders(boolean, text), public.save_cart(jsonb) TO authenticated;
COMMIT;
