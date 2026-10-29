-- Run after db/tests/supabase_stub.sql and migrations 001–010 on an isolated test database.
-- Leaves no fixtures. Covers 010: sign-up linking, listing moderation, and what signed-out
-- visitors, buyers, sellers and staff can read and change through the API.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejection(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR unique_violation OR raise_exception
    OR insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %', statement; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END $$;
-- Rows a statement changed: row-level security skips rows silently instead of failing
CREATE FUNCTION pg_temp.changed(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
-- Act as the API does: signed out, or signed in as an auth user
CREATE FUNCTION pg_temp.signed_out() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true); PERFORM set_config('role', 'anon', true); END $$;
CREATE FUNCTION pg_temp.signed_in(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'none', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', pg_my_temp_schema()::regnamespace); END $$;

-- ---------- Fixtures ----------
INSERT INTO departments (id, name) VALUES ('rt', 'RLS test');
INSERT INTO sellers (id, name) VALUES ('rs1', 'Store one'), ('rs2', 'Store two');
-- A buyer added by staff before they signed in, by phone
INSERT INTO users (id, name, phone) VALUES (7009, 'Walk-in buyer', '+260971000009');
INSERT INTO auth.users (id, phone, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '260971000001', NULL, '{"name":"Buyer one"}'),
  ('00000000-0000-0000-0000-0000000000b2', NULL, 'buyer2@example.com', '{}'),
  ('00000000-0000-0000-0000-0000000000b9', '260971000009', NULL, '{}'),
  ('00000000-0000-0000-0000-0000000000a1', NULL, 'seller1@example.com', '{"name":"Seller one"}'),
  ('00000000-0000-0000-0000-0000000000a2', NULL, 'seller2@example.com', '{}'),
  ('00000000-0000-0000-0000-0000000000f1', NULL, 'staff@example.com', '{}');
UPDATE auth.users SET email_confirmed_at = CASE WHEN email IS NOT NULL THEN now() END,
  phone_confirmed_at = CASE WHEN phone IS NOT NULL THEN now() END;
SELECT pg_temp.assert_true((SELECT phone = '+260971000001' AND name = 'Buyer one' FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000b1'), 'sign-up creates a users row with an E.164 phone');
SELECT pg_temp.assert_true((SELECT id = 7009 FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000b9'), 'sign-up links an existing buyer by phone');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM users WHERE phone = '+260971000009'), 'no duplicate buyer');
UPDATE auth.users SET email = 'new@example.com' WHERE id = '00000000-0000-0000-0000-0000000000b2';
SELECT pg_temp.assert_true((SELECT email = 'new@example.com' FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000b2'), 'email change follows');
UPDATE users SET phone = '+260971000002' WHERE auth_id = '00000000-0000-0000-0000-0000000000b2';
UPDATE auth.users SET email = 'newer@example.com' WHERE id = '00000000-0000-0000-0000-0000000000b2';
SELECT pg_temp.assert_true((SELECT phone = '+260971000002' AND email = 'newer@example.com' FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000b2'), 'an email change keeps the phone on file');
UPDATE users SET is_staff = true WHERE auth_id = '00000000-0000-0000-0000-0000000000f1';
INSERT INTO seller_members (seller_id, user_id)
  SELECT 'rs1', id FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000a1' UNION ALL
  SELECT 'rs2', id FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000a2';
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status) VALUES
  ('RA', 'Active one', 'rt', 'rs1', 100, 'active'), ('RP', 'Pending one', 'rt', 'rs1', 50, 'pending'),
  ('RB', 'Active two', 'rt', 'rs2', 200, 'active');
UPDATE products SET pricing_mode = 'commit', commit_min_zmw = 90, commit_max_zmw = 100 WHERE id = 'RA';
INSERT INTO orders (id, user_id, status, ref) VALUES
  (7101, (SELECT id FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000b1'), 'delivered', 'ZS-RLS001'),
  (7102, (SELECT id FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000b2'), 'delivered', 'ZS-RLS002'),
  (7103, (SELECT id FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000b1'), 'placed', 'ZS-RLS003');
INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_zmw) VALUES (7201, 7101, 'RA', 1, 100), (7202, 7102, 'RB', 1, 200);
INSERT INTO vouchers (code, percent) VALUES ('SECRET10', 10);

-- ---------- Signed out ----------
SELECT pg_temp.signed_out();
SELECT pg_temp.assert_true((SELECT array_agg(id ORDER BY id) = ARRAY['RA', 'RB'] FROM products WHERE id LIKE 'R_'), 'visitors see active listings only');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM sellers WHERE id LIKE 'rs_'), 'visitors see stores');
SELECT pg_temp.expect_rejection($q$SELECT * FROM users$q$);
SELECT pg_temp.expect_rejection($q$SELECT * FROM orders$q$);
SELECT pg_temp.expect_rejection($q$SELECT * FROM vouchers$q$);
SELECT pg_temp.expect_rejection($q$SELECT * FROM seller_complaint_counts$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO departments (id, name) VALUES ('hack', 'Hack')$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET price_zmw = 1 WHERE id = 'RA'$q$);
SELECT pg_temp.admin();

-- ---------- Buyer ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000b1');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM users), 'a buyer sees only their own account');
SELECT pg_temp.assert_true(pg_temp.changed($q$UPDATE users SET name = 'Buyer One' WHERE auth_id = auth.uid()$q$) = 1, 'a buyer can rename themselves');
SELECT pg_temp.expect_rejection($q$UPDATE users SET is_staff = true WHERE auth_id = auth.uid()$q$);
SELECT pg_temp.expect_rejection($q$UPDATE users SET phone = '+260000000000' WHERE auth_id = auth.uid()$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO seller_members (seller_id, user_id) VALUES ('rs1', app.user_id())$q$);
SELECT pg_temp.assert_true((SELECT array_agg(id ORDER BY id) = ARRAY[7101, 7103]::bigint[] FROM orders), 'a buyer sees only their own orders');
SELECT pg_temp.assert_true((SELECT array_agg(id) = ARRAY[7201::bigint] FROM order_items), 'and only their own order items');
SELECT pg_temp.expect_rejection($q$INSERT INTO orders (user_id, status, ref) VALUES (app.user_id(), 'delivered', 'ZS-FAKE01')$q$);
SELECT pg_temp.expect_rejection($q$UPDATE orders SET total_zmw = 0 WHERE id = 7101$q$);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM products WHERE id = 'RP'), 'a buyer can''t see pending listings');
SELECT pg_temp.expect_rejection($q$SELECT * FROM vouchers$q$);
-- Reviews: own delivered purchase only; the rating cache still updates through the trigger
INSERT INTO reviews (product_id, user_id, order_item_id, rating, review_title, review_body) VALUES ('RA', app.user_id(), 7201, 4, 'Good', 'Works well.');
SELECT pg_temp.expect_rejection($q$INSERT INTO reviews (product_id, user_id, order_item_id, rating) VALUES ('RB', (SELECT id FROM users WHERE id <> app.user_id() LIMIT 1), 7202, 1)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO reviews (product_id, user_id, order_item_id, rating) VALUES ('RB', app.user_id(), 7202, 1)$q$);
SELECT pg_temp.expect_rejection($q$UPDATE reviews SET status = 'hidden' WHERE product_id = 'RA'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET average_rating = 5 WHERE id = 'RA'$q$);
SELECT pg_temp.assert_true((SELECT total_reviews_count = 1 AND average_rating = 4 FROM products WHERE id = 'RA'), 'rating cache updated');
-- Addresses: only your own
INSERT INTO user_addresses (user_id, label, town) VALUES (app.user_id(), 'Home', 'Lusaka');
SELECT pg_temp.expect_rejection($q$INSERT INTO user_addresses (user_id, label, town) VALUES (7009, 'Home', 'Lusaka')$q$);
-- Offers: make your own; you can't accept it yourself
INSERT INTO price_commitments (product_id, buyer_id, amount_zmw) VALUES ('RA', app.user_id(), 95);
SELECT pg_temp.expect_rejection($q$INSERT INTO price_commitments (product_id, buyer_id, amount_zmw) VALUES ('RA', 7009, 95)$q$);
SELECT pg_temp.expect_rejection($q$UPDATE price_commitments SET status = 'accepted' WHERE product_id = 'RA'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE price_commitments SET amount_zmw = 90 WHERE product_id = 'RA'$q$);
-- Complaints: about your own orders
INSERT INTO complaints (ref, user_id, contact_name, order_id, seller_id, type, wanted, details)
  VALUES ('ZC-RLS001', app.user_id(), 'Buyer', 7101, 'rs1', 'damaged', 'refund', 'Arrived with a cracked case.');
INSERT INTO complaints (ref, user_id, contact_name, seller_id, type, wanted, details, share_with_seller)
  VALUES ('ZC-RLS002', app.user_id(), 'Buyer', 'rs1', 'damaged', 'refund', 'Private note for staff only.', false);
SELECT pg_temp.expect_rejection($q$INSERT INTO complaints (ref, user_id, contact_name, order_id, type, wanted, details) VALUES ('ZC-RLS003', app.user_id(), 'Buyer', 7102, 'damaged', 'refund', 'Someone else''s order.')$q$);
SELECT pg_temp.expect_rejection($q$UPDATE complaints SET status = 'resolved', resolved_at = now(), upheld = true WHERE ref = 'ZC-RLS001'$q$);
-- Cancellations and returns: own orders only
INSERT INTO order_cancellations (order_id, reason) VALUES (7103, 'Changed my mind');
SELECT pg_temp.expect_rejection($q$INSERT INTO order_cancellations (order_id, reason) VALUES (7102, 'Not mine')$q$);
SELECT pg_temp.expect_rejection($q$UPDATE order_cancellations SET status = 'approved' WHERE order_id = 7103$q$);
INSERT INTO return_requests (order_item_id, quantity, kind, details) VALUES (7201, 1, 'change_of_mind', 'No longer needed.');
SELECT pg_temp.assert_true((SELECT buyer_pays_return FROM return_requests WHERE order_item_id = 7201), 'change of mind: buyer pays return delivery');
SELECT pg_temp.expect_rejection($q$INSERT INTO return_requests (order_item_id, quantity, kind, details) VALUES (7202, 1, 'faulty', 'Not mine.')$q$);
-- Storage: complaint files in your own folder only; no product photos
INSERT INTO storage.objects (bucket_id, name) VALUES ('complaint-files', '00000000-0000-0000-0000-0000000000b1/crack.webp');
SELECT pg_temp.expect_rejection($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('complaint-files', '00000000-0000-0000-0000-0000000000b2/x.webp')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', 'rs1/fake.webp')$q$);
SELECT pg_temp.admin();

-- Another buyer can't see the first buyer's rows
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000b2');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM user_addresses), 'addresses are private');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM complaints), 'complaints are private');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM price_commitments), 'offers are private');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'complaint-files'), 'complaint files are private');
SELECT pg_temp.assert_true(pg_temp.changed($q$DELETE FROM reviews WHERE product_id = 'RA'$q$) = 0, 'can''t delete another buyer''s review');
SELECT pg_temp.admin();

-- ---------- Seller ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000a1');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM products WHERE id = 'RP'), 'a seller sees their own pending listing');
-- New listings wait for review, whatever status the seller sends
INSERT INTO products (id, title, department_id, seller_id, price_zmw, status) VALUES ('RN', 'New one', 'rt', 'rs1', 30, 'active');
SELECT pg_temp.assert_true((SELECT status = 'pending' FROM products WHERE id = 'RN'), 'new listing waits for review');
SELECT pg_temp.expect_rejection($q$INSERT INTO products (id, title, department_id, seller_id, price_zmw) VALUES ('RX', 'Not mine', 'rt', 'rs2', 30)$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET status = 'active' WHERE id = 'RP'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET seller_id = 'rs2' WHERE id = 'RP'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET total_reviews_count = 99 WHERE id = 'RA'$q$);
SELECT pg_temp.assert_true(pg_temp.changed($q$UPDATE products SET price_zmw = 1 WHERE id = 'RB'$q$) = 0, 'can''t change another store''s listing');
-- Price changes stay live; wording changes go back for review
UPDATE products SET price_zmw = 110 WHERE id = 'RA';
SELECT pg_temp.assert_true((SELECT status = 'active' FROM products WHERE id = 'RA'), 'price change stays live');
UPDATE products SET title = 'Active one, renamed' WHERE id = 'RA';
SELECT pg_temp.assert_true((SELECT status = 'pending' FROM products WHERE id = 'RA'), 'wording change goes back for review');
UPDATE products SET status = 'draft' WHERE id = 'RN';
SELECT pg_temp.assert_true(pg_temp.changed($q$DELETE FROM products WHERE id = 'RN'$q$) = 1, 'a seller can delete an unpublished listing');
-- Orders that include the store's products, and only its items
SELECT pg_temp.assert_true((SELECT array_agg(id) = ARRAY[7101::bigint] FROM orders), 'a seller sees orders with their products');
SELECT pg_temp.assert_true((SELECT array_agg(id) = ARRAY[7201::bigint] FROM order_items), 'and only their own items');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM users WHERE id <> app.user_id()), 'a seller can''t list buyers');
-- Offers: accept or decline, nothing else
SELECT pg_temp.expect_rejection($q$UPDATE price_commitments SET status = 'withdrawn' WHERE product_id = 'RA'$q$);
UPDATE price_commitments SET status = 'accepted' WHERE product_id = 'RA';
-- Complaints shared with the store, not private ones
SELECT pg_temp.assert_true((SELECT array_agg(ref) = ARRAY['ZC-RLS001'] FROM complaints), 'a seller sees only shared complaints');
INSERT INTO complaint_messages (complaint_id, author, body) SELECT id, 'seller', 'Sorry, sending a replacement.' FROM complaints WHERE ref = 'ZC-RLS001';
SELECT pg_temp.expect_rejection($q$INSERT INTO complaint_messages (complaint_id, author, body) SELECT id, 'staff', 'Pretending to be staff.' FROM complaints WHERE ref = 'ZC-RLS001'$q$);
-- Store details: description yes, verification and VAT no
SELECT pg_temp.assert_true(pg_temp.changed($q$UPDATE sellers SET about = 'Phones and accessories' WHERE id = 'rs1'$q$) = 1, 'a seller edits their store');
SELECT pg_temp.expect_rejection($q$UPDATE sellers SET verified = true WHERE id = 'rs1'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE sellers SET vat_registered = true WHERE id = 'rs1'$q$);
SELECT pg_temp.assert_true(pg_temp.changed($q$UPDATE sellers SET about = 'Taken over' WHERE id = 'rs2'$q$) = 0, 'can''t edit another store');
-- Promotions and deals: own products only, deal below the normal price
INSERT INTO promotions (id, seller_id, title, discount, starts, ends) VALUES (7401, 'rs1', 'Weekend sale', 10, current_date, current_date + 2);
INSERT INTO promotion_products VALUES (7401, 'RA');
SELECT pg_temp.expect_rejection($q$INSERT INTO promotion_products VALUES (7401, 'RB')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO promotions (seller_id, title, discount, starts, ends) VALUES ('rs2', 'Not mine', 10, current_date, current_date)$q$);
INSERT INTO deals (product_id, price_zmw, reason) VALUES ('RP', 45, 'reduced');
SELECT pg_temp.expect_rejection($q$INSERT INTO deals (product_id, price_zmw, reason) VALUES ('RA', 150, 'reduced')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO deals (product_id, price_zmw, reason) VALUES ('RB', 150, 'reduced')$q$);
-- Photos: own folder only
INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', 'rs1/RA-1.webp');
SELECT pg_temp.expect_rejection($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', 'rs2/RB-1.webp')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', 'RA-1.webp')$q$);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'complaint-files'), 'a seller can''t open buyers'' complaint files');
SELECT pg_temp.admin();

-- The other store sees none of this
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000a2');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM products WHERE id IN ('RA', 'RP')), 'another store can''t see pending listings');
SELECT pg_temp.assert_true((SELECT array_agg(id) = ARRAY[7102::bigint] FROM orders), 'another store sees only its own orders');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM complaints), 'another store sees no complaints about store one');
SELECT pg_temp.admin();

-- ---------- Staff ----------
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000f1');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM orders WHERE id IN (7101, 7102)), 'staff see all orders');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM complaints WHERE ref LIKE 'ZC-RLS%'), 'staff see all complaints');
UPDATE products SET status = 'active' WHERE id IN ('RA', 'RP');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM products WHERE id IN ('RA', 'RP') AND status = 'active'), 'staff publish listings');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'complaint-files'), 'staff open complaint files');
SELECT pg_temp.admin();
SELECT pg_temp.signed_out();
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM products WHERE id LIKE 'R_'), 'published listings appear to visitors');
SELECT pg_temp.admin();

-- Review regressions: unverified contacts never claim users or privilege-bearing accounts.
INSERT INTO users (name, email, is_staff) VALUES ('Unlinked staff', 'protected@example.com', true);
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c1', 'protected@example.com');
SELECT pg_temp.assert_true((SELECT auth_id IS NULL FROM users WHERE email = 'protected@example.com'), 'unverified signup cannot claim staff');
SELECT pg_temp.expect_rejection($q$UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'protected@example.com'$q$);
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c2', 'new-buyer@example.com');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM users WHERE email = 'new-buyer@example.com'), 'unverified signup does not reserve a contact');
UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'new-buyer@example.com';
SELECT pg_temp.assert_true((SELECT NOT is_staff FROM users WHERE email = 'new-buyer@example.com'), 'confirmation creates an ordinary buyer');
UPDATE users SET is_staff = true WHERE email = 'new-buyer@example.com';
INSERT INTO seller_members (seller_id, user_id) SELECT 'rs1', id FROM users WHERE email = 'new-buyer@example.com';
DELETE FROM auth.users WHERE email = 'new-buyer@example.com';
SELECT pg_temp.assert_true((SELECT NOT is_staff AND auth_id IS NULL FROM users WHERE email = 'new-buyer@example.com'), 'deleting identity revokes staff');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM seller_members m JOIN users u ON u.id = m.user_id WHERE u.email = 'new-buyer@example.com'), 'deleting identity revokes store membership');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('00000000-0000-0000-0000-0000000000c3', 'new-buyer@example.com', now());
SELECT pg_temp.assert_true((SELECT NOT is_staff FROM users WHERE auth_id = '00000000-0000-0000-0000-0000000000c3'), 'recreated identity stays unprivileged');

SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000a1');
INSERT INTO product_images (product_id, src, alt, position) VALUES ('RA', 'https://example.com/new.webp', 'New photo', 1);
SELECT pg_temp.assert_true((SELECT status = 'pending' FROM products WHERE id = 'RA'), 'additional photo requires moderation');
SELECT pg_temp.assert_true(pg_temp.changed($q$UPDATE storage.objects SET name = 'rs1/replaced.webp' WHERE bucket_id = 'product-images'$q$) = 0, 'seller cannot replace a public photo');
SELECT pg_temp.assert_true(pg_temp.changed($q$DELETE FROM storage.objects WHERE bucket_id = 'product-images'$q$) = 0, 'seller cannot delete a public photo');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'orders', 'TRUNCATE'), 'orders cannot be truncated by authenticated users');
SELECT pg_temp.expect_rejection('TRUNCATE order_item_addons');
SELECT pg_temp.admin();
UPDATE products SET status = 'active' WHERE id = 'RA';
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000a1');
UPDATE product_images SET src = 'https://example.com/changed.webp' WHERE product_id = 'RA';
SELECT pg_temp.assert_true((SELECT status = 'pending' FROM products WHERE id = 'RA'), 'editing extra photo requires moderation');
SELECT pg_temp.admin();
UPDATE products SET status = 'active' WHERE id = 'RA';
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000a1');
DELETE FROM product_images WHERE product_id = 'RA';
SELECT pg_temp.assert_true((SELECT status = 'pending' FROM products WHERE id = 'RA'), 'deleting extra photo requires moderation');
SELECT pg_temp.admin();
INSERT INTO product_variants (product_id, sku, combo_key, stock_qty) VALUES ('RA', 'RA-BASE', '', 3);
UPDATE products SET status = 'active' WHERE id = 'RA';
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000a1');
UPDATE product_variants SET stock_qty = 4, price_zmw = 105 WHERE product_id = 'RA';
SELECT pg_temp.assert_true((SELECT status = 'active' FROM products WHERE id = 'RA'), 'variant stock and price changes stay live');
UPDATE product_variants SET image = 'https://example.com/variant.webp' WHERE product_id = 'RA';
SELECT pg_temp.assert_true((SELECT status = 'pending' FROM products WHERE id = 'RA'), 'variant image changes require moderation');
SELECT pg_temp.admin();

-- Table rights (013): new Supabase projects grant nothing by default, so every API path needs a grant
SELECT pg_temp.assert_true(has_table_privilege('service_role', 'orders', 'INSERT') AND has_table_privilege('service_role', 'order_items', 'INSERT'), 'server functions can create orders');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'orders', 'INSERT') AND NOT has_table_privilege('anon', 'users', 'SELECT'), 'the browser can''t create orders or list users');
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000a1');
INSERT INTO seller_locations (seller_id, town, province_id) VALUES ('rs1', 'Lusaka', NULL)
  ON CONFLICT (seller_id) DO UPDATE SET town = EXCLUDED.town;
INSERT INTO product_options (product_id, kind, name) VALUES ('RP', 'colour', 'Colour');
SELECT pg_temp.expect_rejection($q$INSERT INTO seller_locations (seller_id, town) VALUES ('rs2', 'Kitwe')$q$);
SELECT pg_temp.admin();
SELECT pg_temp.signed_in('00000000-0000-0000-0000-0000000000b1');
SELECT pg_temp.assert_true(pg_temp.changed($q$UPDATE user_addresses SET label = 'Work' WHERE label = 'Home'$q$) = 1, 'a buyer edits their address');
SELECT pg_temp.assert_true(pg_temp.changed($q$DELETE FROM user_addresses WHERE label = 'Work'$q$) = 1, 'a buyer deletes their address');
SELECT pg_temp.admin();
ROLLBACK;
