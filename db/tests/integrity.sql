-- Run after migrations 001, 002, 003 on an isolated test database. Leaves no fixtures.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejection(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR unique_violation OR raise_exception
    THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %', statement; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END $$;

INSERT INTO departments VALUES ('test', 'Test');
INSERT INTO sellers (id,name) VALUES ('test', 'Test seller');
INSERT INTO users (id,name,phone) VALUES (9001,'Buyer one','+260000009001'), (9002,'Buyer two','+260000009002');
INSERT INTO products (id,title,department_id,seller_id,price_zmw) VALUES
  ('TEST-A','Test A','test','test',100), ('TEST-B','Test B','test','test',200);
SELECT pg_temp.assert_true(unit_to_base(1.5,'l')=1500 AND unit_dimension(NULL) IS NULL, 'unit conversion');
SELECT pg_temp.expect_rejection($q$UPDATE products SET pricing_mode='commit' WHERE id='TEST-A'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET price_zmw='NaN' WHERE id='TEST-A'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET age_ranges=ARRAY['kid',NULL]::age_range[] WHERE id='TEST-A'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET age_ranges=ARRAY['kid','kid']::age_range[] WHERE id='TEST-A'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET rating_counts='{}' WHERE id='TEST-A'$q$);
SELECT pg_temp.expect_rejection($q$UPDATE products SET rating_counts=ARRAY[0,0,0,0,NULL] WHERE id='TEST-A'$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO product_components(product_id,name,kind) VALUES ('TEST-A','Missing price','addon')$q$);
INSERT INTO product_components(id,product_id,name,kind,addon_price_zmw) VALUES
  (901,'TEST-A','Cable','included',NULL),(902,'TEST-A','Case','addon',12.50);
UPDATE products SET pricing_mode='commit',commit_min_zmw=90,commit_max_zmw=100 WHERE id='TEST-A';
INSERT INTO product_options(id,product_id,kind,name) VALUES
  (910,'TEST-A','colour','Colour'),(911,'TEST-A','size','Size'),(912,'TEST-B','colour','Colour');
INSERT INTO product_option_values(id,option_id,product_id,option_kind,label,hex) VALUES
  (920,910,'TEST-A','colour','Blue','#0057AE'),(922,912,'TEST-B','colour','Red','#FF0000');
INSERT INTO product_option_values(id,option_id,product_id,option_kind,label) VALUES (921,911,'TEST-A','size','M');
INSERT INTO product_variants(id,product_id,sku,combo_key,stock_qty) VALUES (930,'TEST-A','TEST-M','920-921',10);
INSERT INTO variant_option_values VALUES (930,910,920,'TEST-A'),(930,911,921,'TEST-A');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.expect_rejection($q$INSERT INTO variant_option_values VALUES (930,912,922,'TEST-A')$q$);
SELECT pg_temp.expect_rejection($q$UPDATE product_variants SET combo_key='arbitrary' WHERE id=930; SET CONSTRAINTS ALL IMMEDIATE$q$);
SELECT pg_temp.expect_rejection($q$DELETE FROM variant_option_values WHERE variant_id=930 AND option_id=911; SET CONSTRAINTS ALL IMMEDIATE$q$);

INSERT INTO orders(id,user_id,status) VALUES
  (940,9001,'delivered'),(941,9001,'delivered'),(942,9001,'placed'),(943,9002,'delivered'),(944,9001,'placed');
INSERT INTO order_items(id,order_id,product_id,quantity,unit_price_zmw,variant_id) VALUES
  (950,940,'TEST-A',1,100,930),(951,941,'TEST-A',1,100,930),(952,942,'TEST-A',1,100,930),(953,943,'TEST-A',1,100,930);
SELECT pg_temp.expect_rejection($q$UPDATE orders SET user_id=9002 WHERE id=940$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO order_items(order_id,product_id,quantity,unit_price_zmw) VALUES (940,'TEST-A',1,'NaN')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO price_commitments(product_id,buyer_id,amount_zmw) VALUES ('TEST-B',9001,100)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO price_commitments(product_id,buyer_id,amount_zmw) VALUES ('TEST-A',9001,95)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO price_commitments(product_id,variant_id,buyer_id,amount_zmw) VALUES ('TEST-A',930,9001,80)$q$);
INSERT INTO price_commitments(id,product_id,variant_id,buyer_id,amount_zmw) VALUES (960,'TEST-A',930,9001,95);
SELECT pg_temp.expect_rejection($q$UPDATE price_commitments SET amount_zmw=1 WHERE id=960$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO order_items(order_id,product_id,quantity,unit_price_zmw,variant_id,commitment_id,price_source) VALUES (944,'TEST-A',1,95,930,960,'commit')$q$);
UPDATE products SET commit_min_zmw=96 WHERE id='TEST-A';
UPDATE price_commitments SET status='accepted' WHERE id=960;
SELECT pg_temp.assert_true((SELECT min_price_snapshot=90 FROM price_commitments WHERE id=960),'offer range snapshot');
SELECT pg_temp.expect_rejection($q$UPDATE price_commitments SET status='pending' WHERE id=960$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO order_items(order_id,product_id,quantity,unit_price_zmw,variant_id,commitment_id,price_source) VALUES (943,'TEST-A',1,95,930,960,'commit')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO order_items(order_id,product_id,quantity,unit_price_zmw,variant_id,commitment_id,price_source) VALUES (944,'TEST-A',2,95,930,960,'commit')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO order_items(order_id,product_id,quantity,unit_price_zmw,variant_id,commitment_id,price_source) VALUES (944,'TEST-A',1,94,930,960,'commit')$q$);
INSERT INTO order_items(id,order_id,product_id,quantity,unit_price_zmw,variant_id,commitment_id,price_source)
  VALUES (954,944,'TEST-A',1,95,930,960,'commit');
SELECT pg_temp.expect_rejection($q$INSERT INTO order_items(order_id,product_id,quantity,unit_price_zmw,variant_id,commitment_id,price_source) VALUES (944,'TEST-A',1,95,930,960,'commit')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO order_item_addons VALUES(954,'TEST-A',901,0)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO order_item_addons VALUES(954,'TEST-A',902,1)$q$);
INSERT INTO order_item_addons VALUES(954,'TEST-A',902,12.50);

SELECT pg_temp.expect_rejection($q$INSERT INTO reviews(product_id,user_id,order_item_id,rating,review_title,review_body) VALUES ('TEST-A',9002,950,5,'Title','Body')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO reviews(product_id,user_id,order_item_id,rating,review_title,review_body) VALUES ('TEST-A',9001,952,5,'Title','Body')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO reviews(product_id,user_id,order_item_id,rating,review_title,review_body) VALUES ('TEST-A',9001,950,6,'Title','Body')$q$);
INSERT INTO reviews(id,product_id,user_id,order_item_id,rating,review_title,review_body) VALUES
  (970,'TEST-A',9001,950,5,'Buyer one','Good'),(971,'TEST-A',9002,953,3,'Buyer two','Okay');
SELECT pg_temp.assert_true((SELECT average_rating=4 AND total_reviews_count=2 AND rating_counts=ARRAY[0,0,1,0,1] FROM products WHERE id='TEST-A'),'initial review cache');
SELECT pg_temp.expect_rejection($q$INSERT INTO reviews(product_id,user_id,order_item_id,rating,review_title,review_body) VALUES ('TEST-A',9001,950,4,'Duplicate','Body')$q$);
-- A second delivered purchase of the same product doesn't allow a second review
SELECT pg_temp.expect_rejection($q$INSERT INTO reviews(product_id,user_id,order_item_id,rating,review_title,review_body) VALUES ('TEST-A',9001,951,4,'Second purchase','Body')$q$);
SELECT pg_temp.expect_rejection($q$UPDATE reviews SET user_id=9002 WHERE id=970$q$);
UPDATE reviews SET rating=1 WHERE id=970;
UPDATE reviews SET status='hidden' WHERE id=971;
SELECT pg_temp.assert_true((SELECT average_rating=1 AND total_reviews_count=1 AND rating_counts=ARRAY[1,0,0,0,0] FROM products WHERE id='TEST-A'),'edit and hide review');
UPDATE reviews SET status='published' WHERE id=971;
DELETE FROM reviews WHERE id=970;
SELECT pg_temp.assert_true((SELECT average_rating=3 AND total_reviews_count=1 AND rating_counts=ARRAY[0,0,1,0,0] FROM products WHERE id='TEST-A'),'unhide and delete review');
DELETE FROM reviews WHERE id=971;
SELECT pg_temp.assert_true((SELECT average_rating=0 AND total_reviews_count=0 AND rating_counts=ARRAY[0,0,0,0,0] FROM products WHERE id='TEST-A'),'empty review cache');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
