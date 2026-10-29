-- More measurement units and extra product photos (PostgreSQL 15+). Apply after 001–004.
-- Matches js/products.js: UNITS and the product `images` list.

-- New enum values can't be used in the transaction that adds them, so they are added
-- first, outside a transaction block. ADD VALUE IF NOT EXISTS makes a re-run harmless.
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'cl';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'oz';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'lb';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'ft';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'mb';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'gb';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'tb';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'mah';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'ah';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'w';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'kw';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'wh';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'kwh';
ALTER TYPE measure_unit ADD VALUE IF NOT EXISTS 'v';

BEGIN;

-- Base units: ml, g, mm, MB, mAh, W, Wh, V. Storage is decimal, as manufacturers label it.
-- The original eight units convert exactly as before, so stored size_base values stay correct.
CREATE OR REPLACE FUNCTION unit_to_base(v numeric, u measure_unit) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT v * CASE u::text
    WHEN 'ml' THEN 1 WHEN 'cl' THEN 10 WHEN 'l' THEN 1000
    WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 WHEN 'oz' THEN 28.349523125 WHEN 'lb' THEN 453.59237
    WHEN 'mm' THEN 1 WHEN 'cm' THEN 10 WHEN 'm' THEN 1000 WHEN 'in' THEN 25.4 WHEN 'ft' THEN 304.8
    WHEN 'mb' THEN 1 WHEN 'gb' THEN 1000 WHEN 'tb' THEN 1000000
    WHEN 'mah' THEN 1 WHEN 'ah' THEN 1000
    WHEN 'w' THEN 1 WHEN 'kw' THEN 1000
    WHEN 'wh' THEN 1 WHEN 'kwh' THEN 1000
    WHEN 'v' THEN 1 END
$$;

CREATE OR REPLACE FUNCTION unit_dimension(u measure_unit) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE
    WHEN u::text IN ('ml', 'cl', 'l') THEN 'volume'
    WHEN u::text IN ('g', 'kg', 'oz', 'lb') THEN 'mass'
    WHEN u::text IN ('mm', 'cm', 'm', 'in', 'ft') THEN 'length'
    WHEN u::text IN ('mb', 'gb', 'tb') THEN 'storage'
    WHEN u::text IN ('mah', 'ah') THEN 'charge'
    WHEN u::text IN ('w', 'kw') THEN 'power'
    WHEN u::text IN ('wh', 'kwh') THEN 'energy'
    WHEN u::text = 'v' THEN 'voltage' END
$$;

-- A variation with its own price gets the seller's offer range in proportion to that price
-- (K2,300–K2,500 on a K2,500 phone is K2,668–K2,900 on its K2,900 version), as js/products.js
-- commitRange() does. Otherwise as in 003: offers are pending, inside the range, and their
-- terms are frozen in the snapshot columns.
CREATE OR REPLACE FUNCTION check_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products; k numeric := 1; vprice numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.product_id, NEW.variant_id, NEW.buyer_id, NEW.amount_zmw, NEW.quantity,
           NEW.created_at, NEW.expires_at, NEW.min_price_snapshot, NEW.max_price_snapshot)
      IS DISTINCT FROM ROW(OLD.product_id, OLD.variant_id, OLD.buyer_id, OLD.amount_zmw, OLD.quantity,
           OLD.created_at, OLD.expires_at, OLD.min_price_snapshot, OLD.max_price_snapshot) THEN
      RAISE EXCEPTION 'Offer terms are immutable; withdraw and submit a new offer';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'A closed offer cannot change status'; END IF;
      IF NEW.status = 'accepted' AND NEW.expires_at <= now() THEN RAISE EXCEPTION 'Offer has expired'; END IF;
      IF NEW.status = 'expired' AND NEW.expires_at > now() THEN RAISE EXCEPTION 'Offer has not expired'; END IF;
      NEW.responded_at := now();
    ELSE NEW.responded_at := OLD.responded_at;
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT p FROM products WHERE id = NEW.product_id FOR UPDATE;
  IF p.pricing_mode <> 'commit' THEN RAISE EXCEPTION 'Product does not accept commit pricing'; END IF;
  IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'A new offer must be pending'; END IF;
  IF NEW.variant_id IS NOT NULL THEN
    SELECT price_zmw INTO vprice FROM product_variants WHERE id = NEW.variant_id AND product_id = NEW.product_id AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Offer variant is unavailable'; END IF;
    IF vprice IS NOT NULL THEN k := vprice / p.price_zmw; END IF;
  ELSIF EXISTS (SELECT 1 FROM product_options WHERE product_id = NEW.product_id) THEN
    RAISE EXCEPTION 'Choose a variant before making an offer';
  END IF;
  NEW.min_price_snapshot := round(p.commit_min_zmw * k, 2);
  NEW.max_price_snapshot := round(p.commit_max_zmw * k, 2);
  NEW.created_at := now(); NEW.responded_at := NULL;
  IF NEW.amount_zmw < NEW.min_price_snapshot OR NEW.amount_zmw > NEW.max_price_snapshot THEN
    RAISE EXCEPTION 'Offer is outside the seller range';
  END IF;
  RETURN NEW;
END $$;

-- Extra photos after products.image, shown as thumbnails. Up to 6 per product, in order,
-- each with alt text, as the seller form enforces.
CREATE TABLE product_images (
  id          bigserial PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  src         text NOT NULL CHECK (char_length(btrim(src)) > 0),
  alt         text NOT NULL CHECK (char_length(btrim(alt)) BETWEEN 1 AND 160),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, position),
  UNIQUE (product_id, src)
);

COMMIT;
