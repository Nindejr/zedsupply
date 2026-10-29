-- Supabase: accounts and roles, listing moderation, promotions, deals and vouchers, row-level
-- security on every table, and photo storage (PostgreSQL 15+). Apply after 001–009.
--
-- On Supabase every table in public is reachable through the API, so these rules are what
-- protect the data:
--   anon (signed out)    reads the public catalogue: active listings, published reviews, places
--   authenticated        also reads and writes its own rows (orders, addresses, offers, reviews,
--                        complaints); seller members manage their own store
--   service_role         server functions only (never in the website): creates orders, staff work
-- Tested locally against db/tests/supabase_stub.sql, which stands in for Supabase's auth and storage.

BEGIN;

-- ---------- Integrity triggers run with the owner's rights ----------
-- The checks from 001–009 read and update other tables (a review checks the buyer's order, the
-- rating cache updates products). Under row-level security a buyer may not see or change those
-- rows, so the checks run as the owner, with a fixed search_path.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = public, pg_temp', f.sig);
  END LOOP;
END $$;

-- ---------- Accounts ----------
-- One users row per signed-in person (auth.users), by phone, email or both.
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users
  ADD COLUMN auth_id  uuid UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN email    text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+$'),
  ADD COLUMN is_staff boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;

-- A listing's place in moderation (rules further down); listings already in the catalogue stay live
ALTER TABLE products ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('draft', 'pending', 'active', 'paused', 'removed'));
ALTER TABLE products ALTER COLUMN status SET DEFAULT 'pending';

-- The people who run each seller's store
CREATE TABLE seller_members (
  seller_id text NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  user_id   bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  PRIMARY KEY (seller_id, user_id)
);
CREATE INDEX seller_members_user_idx ON seller_members (user_id);

-- Helpers for the rules below, in a schema the API doesn't expose. SECURITY DEFINER so they can
-- read users and seller_members whatever the caller may see.
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;
CREATE FUNCTION app.user_id() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM users WHERE auth_id = auth.uid()
$$;
CREATE FUNCTION app.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT is_staff FROM users WHERE auth_id = auth.uid()), false)
$$;
CREATE FUNCTION app.seller_ids() RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.seller_id FROM seller_members m JOIN users u ON u.id = m.user_id WHERE u.auth_id = auth.uid()
$$;
CREATE FUNCTION app.is_seller(sid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT sid IS NOT NULL AND sid IN (SELECT app.seller_ids())
$$;
CREATE FUNCTION app.product_seller(pid text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT seller_id FROM products WHERE id = pid
$$;
CREATE FUNCTION app.product_visible(pid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM products p WHERE p.id = pid AND (p.status = 'active' OR app.is_seller(p.seller_id) OR app.is_staff()))
$$;
CREATE FUNCTION app.order_has_seller(oid bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = oid AND p.seller_id IN (SELECT app.seller_ids()))
$$;

-- Supabase keeps phone numbers without the '+'; ours are E.164 ('+260...')
CREATE FUNCTION app.e164(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN nullif(btrim(p), '') IS NULL THEN NULL WHEN btrim(p) LIKE '+%' THEN btrim(p) ELSE '+' || btrim(p) END
$$;

-- A new sign-in gets its users row; a row added earlier by staff with the same phone or email
-- is linked instead of duplicated
CREATE FUNCTION app.handle_new_auth_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE existing bigint; ph text := app.e164(NEW.phone); em text := nullif(btrim(NEW.email), '');
BEGIN
  SELECT id INTO existing FROM users
   WHERE auth_id IS NULL AND ((ph IS NOT NULL AND phone = ph) OR (em IS NOT NULL AND lower(email) = lower(em)))
   LIMIT 1;
  IF existing IS NOT NULL THEN
    UPDATE users SET auth_id = NEW.id, phone = coalesce(ph, phone), email = coalesce(em, email) WHERE id = existing;
  ELSE
    INSERT INTO users (name, phone, email, auth_id)
    VALUES (coalesce(left(btrim(NEW.raw_user_meta_data ->> 'name'), 80), ''), ph, em, NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION app.handle_new_auth_user();
CREATE FUNCTION app.handle_auth_user_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET phone = app.e164(NEW.phone), email = nullif(btrim(NEW.email), '') WHERE auth_id = NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_changed AFTER UPDATE OF phone, email ON auth.users FOR EACH ROW EXECUTE FUNCTION app.handle_auth_user_change();

-- ---------- Listing moderation ----------
-- Sellers' new listings wait for staff review (which enforces what can't be sold). Sellers can
-- pause or relist, but only staff publish; changing an active listing's wording, category or
-- photo sends it back for review. Price and stock changes stay live.
CREATE INDEX products_active_idx ON products (department_id, subcategory_id) WHERE status = 'active';
CREATE FUNCTION app.guard_product() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR app.is_staff() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'pending') THEN NEW.status := 'pending'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.seller_id IS DISTINCT FROM OLD.seller_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'A listing can''t move to another seller';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'active' AND NEW.status = 'paused') OR
       (OLD.status IN ('paused', 'draft') AND NEW.status = 'pending') OR
       (OLD.status = 'pending' AND NEW.status = 'draft')) THEN
    RAISE EXCEPTION 'Only Zed Supply staff can publish or remove a listing';
  END IF;
  IF OLD.status = 'active' AND ROW(NEW.title, NEW.description, NEW.department_id, NEW.subcategory_id, NEW.image, NEW.specs, NEW.key_features)
       IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.department_id, OLD.subcategory_id, OLD.image, OLD.specs, OLD.key_features) THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_guard BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION app.guard_product();

-- Offers: the buyer may only withdraw; the seller may only accept or decline
CREATE FUNCTION app.guard_commitment_status() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR app.is_staff() OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.buyer_id = app.user_id() AND NEW.status = 'withdrawn' THEN RETURN NEW; END IF;
  IF app.is_seller(app.product_seller(OLD.product_id)) AND NEW.status IN ('accepted', 'declined') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'You can''t set this offer to %', NEW.status;
END $$;
CREATE TRIGGER price_commitments_status_guard BEFORE UPDATE OF status ON price_commitments
  FOR EACH ROW EXECUTE FUNCTION app.guard_commitment_status();

-- Change-of-mind returns: the buyer pays the return delivery, as the returns policy says
CREATE FUNCTION app.return_delivery_payer() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.kind = 'change_of_mind' THEN NEW.buyer_pays_return := true; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER return_requests_payer BEFORE INSERT ON return_requests FOR EACH ROW EXECUTE FUNCTION app.return_delivery_payer();

-- ---------- Promotions, deals and vouchers ----------
CREATE TABLE promotions (
  id         bigserial PRIMARY KEY,
  seller_id  text NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 60),
  season     text NOT NULL DEFAULT 'own' CHECK (season ~ '^[a-z]+$'),
  discount   smallint NOT NULL CHECK (discount BETWEEN 5 AND 90),
  starts     date NOT NULL,
  ends       date NOT NULL,
  image      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends >= starts)
);
CREATE INDEX promotions_seller_idx ON promotions (seller_id, ends);
CREATE TABLE promotion_products (
  promotion_id bigint NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  product_id   text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);
-- Provinces a promotion is limited to; none means the whole country
CREATE TABLE promotion_areas (
  promotion_id bigint NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  province_id  text NOT NULL REFERENCES provinces (id),
  PRIMARY KEY (promotion_id, province_id)
);
CREATE FUNCTION app.check_promotion_product() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT seller_id FROM products WHERE id = NEW.product_id) IS DISTINCT FROM (SELECT seller_id FROM promotions WHERE id = NEW.promotion_id) THEN
    RAISE EXCEPTION 'A promotion can only include the seller''s own products';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER promotion_products_owner BEFORE INSERT OR UPDATE ON promotion_products FOR EACH ROW EXECUTE FUNCTION app.check_promotion_product();

CREATE TABLE deals (
  id         bigserial PRIMARY KEY,
  product_id text NOT NULL UNIQUE REFERENCES products (id) ON DELETE CASCADE,   -- one deal per product
  price_zmw  numeric(12,2) NOT NULL CHECK (price_zmw > 0),
  reason     text NOT NULL CHECK (reason IN ('reduced', 'clearance', 'limited', 'bundle', 'seasonal')),
  starts     date NOT NULL DEFAULT current_date,
  ends       date,
  CHECK (ends IS NULL OR ends >= starts)
);
CREATE FUNCTION app.check_deal_price() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.price_zmw >= (SELECT price_zmw FROM products WHERE id = NEW.product_id) THEN
    RAISE EXCEPTION 'A deal price must be lower than the normal price';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deals_price BEFORE INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION app.check_deal_price();

-- Voucher codes are checked by the server when an order is placed; they're never readable from
-- the website, so codes can't be listed
CREATE TABLE vouchers (
  code          text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{3,20}$'),
  percent       smallint NOT NULL CHECK (percent BETWEEN 1 AND 90),
  min_spend_zmw numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_spend_zmw >= 0),
  active        boolean NOT NULL DEFAULT true,
  starts        date,
  ends          date,
  CHECK (ends IS NULL OR starts IS NULL OR ends >= starts)
);

-- ---------- Row-level security on every table ----------
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
ALTER VIEW seller_complaint_counts SET (security_invoker = true);

-- Signed-out visitors may only read, and only the public tables listed below
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON departments, department_groups, subcategories, provinces, towns, brands, sellers, seller_locations,
  seller_delivery_areas, attribute_templates, delivery_estimates, products, product_options, product_option_values,
  product_variants, variant_option_values, product_components, product_images, reviews, promotions,
  promotion_products, promotion_areas, deals TO anon;
REVOKE ALL ON seller_complaint_counts, vouchers FROM anon, authenticated;

-- Public catalogue and reference data
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['departments', 'department_groups', 'subcategories', 'provinces', 'towns', 'brands', 'sellers',
    'seller_locations', 'seller_delivery_areas', 'attribute_templates', 'delivery_estimates', 'promotions',
    'promotion_products', 'promotion_areas', 'deals'] LOOP
    EXECUTE format('CREATE POLICY "Anyone can read" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
  END LOOP;
END $$;

-- Products and their parts: active listings for everyone; the seller and staff see the rest
CREATE POLICY "Active listings, or your own" ON products FOR SELECT TO anon, authenticated
  USING (status = 'active' OR app.is_seller(seller_id) OR app.is_staff());
CREATE POLICY "Sellers add their own listings" ON products FOR INSERT TO authenticated WITH CHECK (app.is_seller(seller_id));
CREATE POLICY "Sellers edit their own listings" ON products FOR UPDATE TO authenticated
  USING (app.is_seller(seller_id)) WITH CHECK (app.is_seller(seller_id));
CREATE POLICY "Sellers delete unpublished listings" ON products FOR DELETE TO authenticated
  USING (app.is_seller(seller_id) AND status IN ('draft', 'pending'));
-- Staff moderate listings from the website; their other decisions (refunds, complaint findings,
-- store verification) go through the Supabase dashboard or server functions
CREATE POLICY "Staff moderate listings" ON products FOR UPDATE TO authenticated USING (app.is_staff()) WITH CHECK (app.is_staff());
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['product_options', 'product_option_values', 'product_variants', 'variant_option_values', 'product_components', 'product_images'] LOOP
    EXECUTE format('CREATE POLICY "Visible with its listing" ON public.%I FOR SELECT TO anon, authenticated USING (app.product_visible(product_id))', t);
    EXECUTE format('CREATE POLICY "Seller manages" ON public.%I FOR ALL TO authenticated USING (app.is_seller(app.product_seller(product_id))) WITH CHECK (app.is_seller(app.product_seller(product_id)))', t);
  END LOOP;
END $$;
-- The rating cache is kept by the reviews trigger; nobody writes it directly
DO $$ DECLARE cols text; BEGIN
  SELECT string_agg(quote_ident(column_name), ', ') INTO cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'products' AND column_name NOT IN ('average_rating', 'total_reviews_count', 'rating_counts', 'size_base');
  REVOKE INSERT, UPDATE ON products FROM authenticated;
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON products TO authenticated', cols, cols);
END $$;

-- Sellers: a store edits its own description; staff set verification and VAT details
CREATE POLICY "Store members edit their store" ON sellers FOR UPDATE TO authenticated USING (app.is_seller(id)) WITH CHECK (app.is_seller(id));
REVOKE INSERT, UPDATE, DELETE ON sellers FROM authenticated;
GRANT UPDATE (name, city, about) ON sellers TO authenticated;
CREATE POLICY "Store members manage location" ON seller_locations FOR ALL TO authenticated USING (app.is_seller(seller_id)) WITH CHECK (app.is_seller(seller_id));
CREATE POLICY "Store members manage delivery areas" ON seller_delivery_areas FOR ALL TO authenticated USING (app.is_seller(seller_id)) WITH CHECK (app.is_seller(seller_id));
CREATE POLICY "Store members manage promotions" ON promotions FOR ALL TO authenticated USING (app.is_seller(seller_id)) WITH CHECK (app.is_seller(seller_id));
CREATE POLICY "Store members manage promotion products" ON promotion_products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id AND app.is_seller(p.seller_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id AND app.is_seller(p.seller_id)));
CREATE POLICY "Store members manage promotion areas" ON promotion_areas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id AND app.is_seller(p.seller_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id AND app.is_seller(p.seller_id)));
CREATE POLICY "Store members manage deals" ON deals FOR ALL TO authenticated
  USING (app.is_seller(app.product_seller(product_id))) WITH CHECK (app.is_seller(app.product_seller(product_id)));
-- Reference data is changed by staff through the dashboard or server functions
REVOKE INSERT, UPDATE, DELETE ON departments, department_groups, subcategories, provinces, towns, brands,
  attribute_templates, delivery_estimates FROM authenticated;

-- Accounts: see and rename yourself; staff and store membership are set by staff
CREATE POLICY "Your own account" ON users FOR SELECT TO authenticated USING (auth_id = auth.uid() OR app.is_staff());
CREATE POLICY "Rename yourself" ON users FOR UPDATE TO authenticated USING (auth_id = auth.uid()) WITH CHECK (auth_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON users FROM authenticated;
GRANT UPDATE (name) ON users TO authenticated;
CREATE POLICY "Your own store memberships" ON seller_members FOR SELECT TO authenticated USING (user_id = app.user_id() OR app.is_staff());
REVOKE INSERT, UPDATE, DELETE ON seller_members FROM authenticated;

CREATE POLICY "Your own addresses" ON user_addresses FOR ALL TO authenticated
  USING (user_id = app.user_id()) WITH CHECK (user_id = app.user_id());

-- Orders are created by the server (prices, VAT and stock checked there), never from the browser.
-- Buyers see their orders; sellers see orders that include their products, and only their items.
CREATE POLICY "Your orders, or orders for your store" ON orders FOR SELECT TO authenticated
  USING (user_id = app.user_id() OR app.order_has_seller(id) OR app.is_staff());
CREATE POLICY "Items you bought or sold" ON order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id())
         OR app.is_seller(app.product_seller(product_id)) OR app.is_staff());
CREATE POLICY "Add-ons on items you can see" ON order_item_addons FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM order_items oi WHERE oi.id = order_item_id));
REVOKE INSERT, UPDATE, DELETE ON orders, order_items, order_item_addons FROM authenticated;

-- Offers: buyers make and withdraw their own; sellers accept or decline offers on their products
CREATE POLICY "Offers you made or received" ON price_commitments FOR SELECT TO authenticated
  USING (buyer_id = app.user_id() OR app.is_seller(app.product_seller(product_id)) OR app.is_staff());
CREATE POLICY "Make your own offers" ON price_commitments FOR INSERT TO authenticated WITH CHECK (buyer_id = app.user_id());
CREATE POLICY "Answer or withdraw offers" ON price_commitments FOR UPDATE TO authenticated
  USING (buyer_id = app.user_id() OR app.is_seller(app.product_seller(product_id)))
  WITH CHECK (buyer_id = app.user_id() OR app.is_seller(app.product_seller(product_id)));
REVOKE INSERT, UPDATE, DELETE ON price_commitments FROM authenticated;
GRANT INSERT (product_id, variant_id, buyer_id, amount_zmw, quantity) ON price_commitments TO authenticated;
GRANT UPDATE (status) ON price_commitments TO authenticated;

-- Reviews: published ones are public; you write, edit and delete your own (purchase checked by trigger)
CREATE POLICY "Published reviews, or your own" ON reviews FOR SELECT TO anon, authenticated
  USING (status = 'published' OR user_id = app.user_id() OR app.is_staff());
CREATE POLICY "Write your own review" ON reviews FOR INSERT TO authenticated WITH CHECK (user_id = app.user_id());
CREATE POLICY "Edit your own review" ON reviews FOR UPDATE TO authenticated USING (user_id = app.user_id()) WITH CHECK (user_id = app.user_id());
CREATE POLICY "Delete your own review" ON reviews FOR DELETE TO authenticated USING (user_id = app.user_id());
REVOKE INSERT, UPDATE ON reviews FROM authenticated;
GRANT INSERT (product_id, user_id, order_item_id, rating, review_title, review_body) ON reviews TO authenticated;
GRANT UPDATE (rating, review_title, review_body) ON reviews TO authenticated;

-- Cancellations and returns: asked for by the buyer on their own orders; decided by staff
CREATE POLICY "Cancellations on orders you can see" ON order_cancellations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY "Ask to cancel your own order" ON order_cancellations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id()));
REVOKE INSERT, UPDATE, DELETE ON order_cancellations FROM authenticated;
GRANT INSERT (order_id, reason) ON order_cancellations TO authenticated;
CREATE POLICY "Returns on items you can see" ON return_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM order_items oi WHERE oi.id = order_item_id));
CREATE POLICY "Ask to return your own item" ON return_requests FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = order_item_id AND o.user_id = app.user_id()));
REVOKE INSERT, UPDATE, DELETE ON return_requests FROM authenticated;
GRANT INSERT (order_item_id, quantity, kind, details) ON return_requests TO authenticated;

-- Complaints: yours, and those about your store that the buyer agreed to share
CREATE POLICY "Your complaints, or shared ones about your store" ON complaints FOR SELECT TO authenticated
  USING (user_id = app.user_id() OR (share_with_seller AND app.is_seller(seller_id)) OR app.is_staff());
CREATE POLICY "Make a complaint" ON complaints FOR INSERT TO authenticated
  WITH CHECK (user_id = app.user_id() AND (order_id IS NULL OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = app.user_id())));
REVOKE INSERT, UPDATE, DELETE ON complaints FROM authenticated;
GRANT INSERT (ref, user_id, contact_name, contact_phone, order_id, seller_id, product_id, type, wanted, details, share_with_seller) ON complaints TO authenticated;
CREATE POLICY "Messages on complaints you can see" ON complaint_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id));
CREATE POLICY "Reply as the buyer or the seller" ON complaint_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id AND (
    (author = 'buyer' AND c.user_id = app.user_id()) OR (author = 'seller' AND c.share_with_seller AND app.is_seller(c.seller_id)))));
REVOKE INSERT, UPDATE, DELETE ON complaint_messages FROM authenticated;
GRANT INSERT (complaint_id, author, body) ON complaint_messages TO authenticated;
CREATE POLICY "Attachments on complaints you can see" ON complaint_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id));
CREATE POLICY "Attach to your own complaint" ON complaint_attachments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id AND c.user_id = app.user_id()));
REVOKE INSERT, UPDATE, DELETE ON complaint_attachments FROM authenticated;
GRANT INSERT (complaint_id, src, alt) ON complaint_attachments TO authenticated;

-- ---------- Photo storage ----------
-- product-images: public, up to 1 MB; a store uploads only into its own folder, <seller id>/...
-- complaint-files: private, up to 5 MB; a buyer uploads into their own folder, <auth user id>/...
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('product-images', 'product-images', true, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png']),
  ('complaint-files', 'complaint-files', false, 5242880, ARRAY['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Product photos are public" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'product-images');
CREATE POLICY "Stores upload to their own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT app.seller_ids()));
CREATE POLICY "Stores replace their own photos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT app.seller_ids()))
  WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT app.seller_ids()));
CREATE POLICY "Stores delete their own photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT app.seller_ids()));
CREATE POLICY "Buyers upload complaint files to their own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'complaint-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Complaint files: the buyer and staff" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'complaint-files' AND ((storage.foldername(name))[1] = auth.uid()::text OR app.is_staff()));

COMMIT;
