-- Run after migrations 001 through 004 in an isolated test database.
BEGIN;
CREATE FUNCTION pg_temp.details_reject(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected rejection: %',statement; END IF;
END $$;
INSERT INTO departments VALUES('DETAILS','Details test');
INSERT INTO sellers(id,name) VALUES('DETAILS','Details test');
INSERT INTO products(id,title,department_id,seller_id,price_zmw) VALUES('DETAILS','Test','DETAILS','DETAILS',100);
SELECT pg_temp.details_reject($q$UPDATE products SET condition='used' WHERE id='DETAILS'$q$);
SELECT pg_temp.details_reject($q$UPDATE products SET condition_notes='No classification' WHERE id='DETAILS'$q$);
SELECT pg_temp.details_reject($q$UPDATE products SET condition='unknown' WHERE id='DETAILS'$q$);
SELECT pg_temp.details_reject($q$UPDATE products SET key_features=ARRAY[' '] WHERE id='DETAILS'$q$);
SELECT pg_temp.details_reject($q$UPDATE products SET key_features=ARRAY[NULL]::text[] WHERE id='DETAILS'$q$);
SELECT pg_temp.details_reject($q$UPDATE products SET key_features=ARRAY['1','2','3','4','5','6','7','8','9'] WHERE id='DETAILS'$q$);
SELECT pg_temp.details_reject($q$UPDATE products SET key_features=ARRAY[['Nested']] WHERE id='DETAILS'$q$);
UPDATE products SET condition='new',key_features=ARRAY['USB-C charging','128 GB option'] WHERE id='DETAILS';
UPDATE products SET condition='used',condition_notes='Minor cosmetic marks.' WHERE id='DETAILS';
INSERT INTO attribute_templates(department_id,attribute) VALUES('DETAILS','condition'),('DETAILS','features');
INSERT INTO product_options(id,product_id,kind,name) VALUES(8000,'DETAILS','custom','Storage'),(8001,'DETAILS','custom','Pack size');
INSERT INTO product_option_values(id,option_id,product_id,option_kind,label) VALUES
  (8100,8000,'DETAILS','custom','128 GB'),(8101,8000,'DETAILS','custom','256 GB'),
  (8200,8001,'DETAILS','custom','Phone only'),(8201,8001,'DETAILS','custom','Starter kit');
INSERT INTO product_variants(id,product_id,sku,combo_key,stock_qty) VALUES
  (8300,'DETAILS','D-1','8100-8200',2),(8301,'DETAILS','D-2','8100-8201',2),
  (8302,'DETAILS','D-3','8101-8200',2),(8303,'DETAILS','D-4','8101-8201',2);
INSERT INTO variant_option_values VALUES
  (8300,8000,8100,'DETAILS'),(8300,8001,8200,'DETAILS'),(8301,8000,8100,'DETAILS'),(8301,8001,8201,'DETAILS'),
  (8302,8000,8101,'DETAILS'),(8302,8001,8200,'DETAILS'),(8303,8000,8101,'DETAILS'),(8303,8001,8201,'DETAILS');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
