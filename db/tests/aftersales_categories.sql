-- Run after migrations 001–007 on an isolated test database. Leaves no fixtures.
-- Covers 005 (units, photos, offers on variants), 006 (addresses, orders, cancellations,
-- returns, complaints) and 007 (subcategories).
BEGIN;
CREATE FUNCTION pg_temp.expect_rejection(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR unique_violation OR raise_exception OR invalid_text_representation
    THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %', statement; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END $$;

INSERT INTO departments VALUES ('tech', 'Electronics'), ('solar', 'Solar');
INSERT INTO sellers (id, name) VALUES ('s1', 'Seller one');
INSERT INTO users (id, name, phone) VALUES (8001, 'Buyer', '+260000008001'), (8002, 'Other buyer', '+260000008002');

-- ---------- 005: units ----------
SELECT pg_temp.assert_true(unit_to_base(1, 'tb') = 1000000 AND unit_to_base(256, 'gb') = 256000, 'storage in MB');
SELECT pg_temp.assert_true(unit_to_base(2, 'ah') = 2000 AND unit_dimension('mah') = 'charge', 'battery capacity');
SELECT pg_temp.assert_true(unit_to_base(1, 'kwh') = 1000 AND unit_dimension('w') = 'power' AND unit_dimension('v') = 'voltage', 'power, energy, voltage');
SELECT pg_temp.assert_true(unit_to_base(1, 'lb') = 453.59237 AND unit_to_base(1, 'ft') = 304.8 AND unit_to_base(5, 'cl') = 50, 'imperial and cl');
SELECT pg_temp.assert_true(unit_to_base(1.5, 'l') = 1500 AND unit_dimension('ml') = 'volume', 'original units unchanged');
SELECT pg_temp.expect_rejection($q$SELECT 'parsecs'::measure_unit$q$);

INSERT INTO products (id, title, department_id, seller_id, price_zmw, size_value, size_unit) VALUES ('PH', 'Phone', 'tech', 's1', 2500, 128, 'gb');
SELECT pg_temp.assert_true((SELECT size_base = 128000 FROM products WHERE id = 'PH'), 'generated size_base for new units');

-- ---------- 005: extra photos ----------
INSERT INTO product_images (product_id, position, src, alt) VALUES ('PH', 1, 'assets/products/PH-2.webp', 'Back of the phone');
SELECT pg_temp.expect_rejection($q$INSERT INTO product_images (product_id, position, src, alt) VALUES ('PH', 7, 'x.webp', 'Too many')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO product_images (product_id, position, src, alt) VALUES ('PH', 2, 'y.webp', ' ')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO product_images (product_id, position, src, alt) VALUES ('PH', 1, 'z.webp', 'Same position')$q$);

-- ---------- 005: offer range follows a variant's own price ----------
UPDATE products SET pricing_mode = 'commit', commit_min_zmw = 2300, commit_max_zmw = 2500 WHERE id = 'PH';
INSERT INTO product_options (id, product_id, kind, name) VALUES (701, 'PH', 'size', 'Storage');
INSERT INTO product_option_values (id, option_id, product_id, option_kind, label, size_value, size_unit) VALUES
  (711, 701, 'PH', 'size', '128 GB', 128, 'gb'), (712, 701, 'PH', 'size', '256 GB', 256, 'gb');
INSERT INTO product_variants (id, product_id, sku, combo_key, stock_qty, price_zmw) VALUES
  (721, 'PH', 'PH-128', '711', 4, NULL), (722, 'PH', 'PH-256', '712', 3, 2900);
INSERT INTO variant_option_values VALUES (721, 701, 711, 'PH'), (722, 701, 712, 'PH');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
-- K2,300–K2,500 on the K2,500 base becomes K2,668–K2,900 on the K2,900 variant
SELECT pg_temp.expect_rejection($q$INSERT INTO price_commitments (product_id, variant_id, buyer_id, amount_zmw) VALUES ('PH', 722, 8001, 2500)$q$);
INSERT INTO price_commitments (id, product_id, variant_id, buyer_id, amount_zmw) VALUES (731, 'PH', 722, 8001, 2700);
SELECT pg_temp.assert_true((SELECT min_price_snapshot = 2668 AND max_price_snapshot = 2900 FROM price_commitments WHERE id = 731), 'scaled offer range');
INSERT INTO price_commitments (id, product_id, variant_id, buyer_id, amount_zmw) VALUES (732, 'PH', 721, 8002, 2400);
SELECT pg_temp.assert_true((SELECT min_price_snapshot = 2300 AND max_price_snapshot = 2500 FROM price_commitments WHERE id = 732), 'base-priced variant keeps the range');
SELECT pg_temp.expect_rejection($q$INSERT INTO price_commitments (product_id, variant_id, buyer_id, amount_zmw) VALUES ('PH', 721, 8001, 2600)$q$);

-- ---------- 006: VAT and seller registration ----------
SELECT pg_temp.expect_rejection($q$UPDATE sellers SET tpin = '12345' WHERE id = 's1'$q$);
UPDATE sellers SET tpin = '1001234567', vat_registered = false WHERE id = 's1';

-- ---------- 006: saved addresses ----------
INSERT INTO user_addresses (id, user_id, label, town, is_default) VALUES (801, 8001, 'Home', 'Lusaka', true);
SELECT pg_temp.expect_rejection($q$INSERT INTO user_addresses (user_id, label, town, is_default) VALUES (8001, 'Work', 'Lusaka', true)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO user_addresses (user_id, label, town) VALUES (8001, 'No town', ' ')$q$);
INSERT INTO user_addresses (user_id, label, town) SELECT 8001, 'Extra ' || g, 'Kitwe' FROM generate_series(2, 10) g;
SELECT pg_temp.expect_rejection($q$INSERT INTO user_addresses (user_id, label, town) VALUES (8001, 'Eleventh', 'Ndola')$q$);

-- ---------- 006: what an order records ----------
INSERT INTO orders (id, user_id, status, ref, address_id, deliver_to, is_gift, gift_message, hide_prices, vat_rate, vat_zmw, total_zmw)
  VALUES (901, 8001, 'placed', 'ZS-TEST01', 801, 'Kabulonga, Lusaka', true, 'Happy birthday', true, 16, 136.55, 990);
SELECT pg_temp.expect_rejection($q$INSERT INTO orders (user_id, ref, gift_message) VALUES (8001, 'ZS-TEST02', 'Gift note on a non-gift')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO orders (user_id, ref) VALUES (8001, 'bad ref')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO orders (user_id, ref, address_id) VALUES (8002, 'ZS-TEST03', 801)$q$);
DELETE FROM user_addresses WHERE id = 801;
SELECT pg_temp.assert_true((SELECT address_id IS NULL AND deliver_to = 'Kabulonga, Lusaka' FROM orders WHERE id = 901), 'deleting an address keeps the order''s copy');

-- ---------- 006: cancellations ----------
INSERT INTO order_cancellations (id, order_id, reason) VALUES (911, 901, 'I ordered by mistake');
SELECT pg_temp.expect_rejection($q$INSERT INTO order_cancellations (order_id, reason) VALUES (901, 'A second open request')$q$);
UPDATE order_cancellations SET status = 'approved', decided_at = now() WHERE id = 911;
SELECT pg_temp.assert_true((SELECT status = 'cancelled' FROM orders WHERE id = 901), 'approving cancels the order');
INSERT INTO orders (id, user_id, status, ref) VALUES (902, 8001, 'delivered', 'ZS-TEST04');
SELECT pg_temp.expect_rejection($q$INSERT INTO order_cancellations (order_id, reason) VALUES (902, 'Too late')$q$);

-- ---------- 006: returns ----------
INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_zmw) VALUES (921, 902, 'PH', 1, 2500);
INSERT INTO return_requests (order_item_id, kind, buyer_pays_return) VALUES (921, 'change_of_mind', true);
SELECT pg_temp.expect_rejection($q$INSERT INTO return_requests (order_item_id, kind, buyer_pays_return) VALUES (921, 'faulty', true)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO return_requests (order_item_id, kind, refunded_at) VALUES (921, 'faulty', now())$q$);

-- ---------- 006: complaints ----------
INSERT INTO complaints (id, ref, contact_name, contact_phone, seller_id, type, wanted, details)
  VALUES (931, 'ZC-TEST01', 'Visitor', '+260000009999', 's1', 'misleading', 'inform', 'The listing photo shows a different model.');
SELECT pg_temp.expect_rejection($q$INSERT INTO complaints (ref, contact_name, type, wanted, details) VALUES ('ZC-TEST02', 'No way to reply', 'other', 'inform', 'Nobody can answer this one.')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO complaints (ref, user_id, contact_name, type, wanted, details) VALUES ('ZC-TEST03', 8001, 'Buyer', 'other', 'inform', 'Too short')$q$);
SELECT pg_temp.expect_rejection($q$UPDATE complaints SET status = 'resolved' WHERE id = 931$q$);
INSERT INTO complaint_messages (complaint_id, author, body) VALUES (931, 'seller', 'We have corrected the photo.');
UPDATE complaints SET status = 'resolved', resolved_at = now(), upheld = true WHERE id = 931;
SELECT pg_temp.assert_true((SELECT upheld_90d = 1 AND total_90d = 1 FROM seller_complaint_counts WHERE seller_id = 's1'), 'upheld complaints counted per seller');

-- ---------- 007: subcategories ----------
INSERT INTO department_groups VALUES ('tech-group', 'Electronics & technology', 0);
UPDATE departments SET group_id = 'tech-group', short_name = 'Electronics', featured = true WHERE id = 'tech';
INSERT INTO subcategories (department_id, id, name) VALUES ('tech', 'phones', 'Mobile Phones & Accessories'), ('solar', 'panels', 'Solar Panels');
UPDATE products SET subcategory_id = 'phones' WHERE id = 'PH';
SELECT pg_temp.expect_rejection($q$UPDATE products SET subcategory_id = 'panels' WHERE id = 'PH'$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO subcategories (department_id, id, name) VALUES ('tech', 'Bad Id', 'Spaces')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO subcategories (department_id, id, name) VALUES ('tech', 'phones', 'Duplicate')$q$);

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
