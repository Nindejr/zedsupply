-- Run after migrations 001–009 on an isolated test database. Leaves no fixtures.
-- Covers 009: towns, seller locations and collection, delivery areas, estimates, order fulfilment.
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

INSERT INTO provinces VALUES ('lusaka', 'Lusaka'), ('copperbelt', 'Copperbelt');
SELECT pg_temp.expect_rejection($q$INSERT INTO provinces VALUES ('North-Western', 'Bad id')$q$);
INSERT INTO towns VALUES ('Lusaka', 'lusaka', -15.417, 28.283), ('Kitwe', 'copperbelt', -12.802, 28.213);
SELECT pg_temp.expect_rejection($q$INSERT INTO towns VALUES ('Nowhere', 'atlantis', 0, 0)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO towns VALUES ('Off the map', 'lusaka', -95, 28)$q$);

INSERT INTO sellers (id, name) VALUES ('ls1', 'Kitwe seller'), ('ls2', 'Lusaka seller');
-- Collection needs an address
SELECT pg_temp.expect_rejection($q$INSERT INTO seller_locations (seller_id, town, province_id, collection_enabled) VALUES ('ls1', 'Kitwe', 'copperbelt', true)$q$);
INSERT INTO seller_locations (seller_id, town, province_id, collection_enabled, collection_address, collection_hours, delivers_everywhere)
  VALUES ('ls1', 'Kitwe', 'copperbelt', false, NULL, NULL, false),
         ('ls2', 'Lusaka', 'lusaka', true, 'Shop 4, Cairo Road', 'Mon–Sat 08:00–17:00', true);
INSERT INTO seller_delivery_areas VALUES ('ls1', 'copperbelt'), ('ls1', 'lusaka');
SELECT pg_temp.expect_rejection($q$INSERT INTO seller_delivery_areas VALUES ('ls1', 'copperbelt')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO seller_delivery_areas VALUES ('ls1', 'mars')$q$);
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM seller_delivery_areas WHERE seller_id = 'ls1'), 'delivery areas saved');

-- Estimates: a known zone, and the most days at least the fewest
INSERT INTO delivery_estimates VALUES ('town', 1, 2), ('province', 2, 4), ('country', 3, 7);
SELECT pg_temp.expect_rejection($q$INSERT INTO delivery_estimates VALUES ('moon', 1, 2)$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO delivery_estimates VALUES ('world', 9, 5)$q$);

-- Orders: delivered or collected; only collected orders have a collection point
INSERT INTO users (id, name, phone) VALUES (6001, 'Buyer', '+260000006001');
INSERT INTO orders (user_id, ref, fulfilment, buyer_town, buyer_province_id, collection_point)
  VALUES (6001, 'ZS-LOC001', 'collection', 'Lusaka', 'lusaka', 'Lusaka seller: Shop 4, Cairo Road');
INSERT INTO orders (user_id, ref, fulfilment, buyer_town, buyer_province_id) VALUES (6001, 'ZS-LOC002', 'delivery', 'Kitwe', 'copperbelt');
SELECT pg_temp.expect_rejection($q$INSERT INTO orders (user_id, ref, fulfilment, collection_point) VALUES (6001, 'ZS-LOC003', 'delivery', 'Somewhere')$q$);
SELECT pg_temp.expect_rejection($q$INSERT INTO orders (user_id, ref, fulfilment) VALUES (6001, 'ZS-LOC004', 'teleport')$q$);
SELECT pg_temp.expect_rejection($q$UPDATE users SET preferred_fulfilment = 'drone' WHERE id = 6001$q$);
UPDATE users SET preferred_fulfilment = 'collection' WHERE id = 6001;

-- Removing a seller removes its location and delivery areas
DELETE FROM sellers WHERE id = 'ls1';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM seller_delivery_areas WHERE seller_id = 'ls1'), 'cascade to delivery areas');

ROLLBACK;
