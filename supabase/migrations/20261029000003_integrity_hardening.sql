-- Step 1 review corrections. Apply after 001 and 002; do not rewrite applied migrations.
-- PostgreSQL 15+. Invalid existing data aborts this transaction for manual correction.
BEGIN;

ALTER FUNCTION unit_to_base(numeric, measure_unit) STRICT;
ALTER FUNCTION unit_dimension(measure_unit) STRICT;
CREATE FUNCTION valid_age_ranges(values_ age_range[]) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(values_) = (SELECT count(DISTINCT v) FROM unnest(values_) v)
    AND (cardinality(values_) = 0 OR (array_ndims(values_) = 1 AND array_lower(values_, 1) = 1))
$$;
ALTER TABLE products ADD CONSTRAINT products_valid_age_ranges CHECK (valid_age_ranges(age_ranges));

-- CHECK accepts NULL in SQL, so conditionally required fields need explicit IS NOT NULL.
ALTER TABLE products DROP CONSTRAINT products_commit_range;
ALTER TABLE products ADD CONSTRAINT products_commit_range CHECK (
  (pricing_mode = 'fixed' AND commit_min_zmw IS NULL AND commit_max_zmw IS NULL) OR
  (pricing_mode = 'commit' AND commit_min_zmw IS NOT NULL AND commit_max_zmw IS NOT NULL
   AND commit_min_zmw > 0 AND commit_min_zmw < commit_max_zmw
   AND commit_max_zmw <= price_zmw AND commit_max_zmw < 'Infinity'::numeric));
ALTER TABLE products ADD CONSTRAINT products_finite_values CHECK (
  price_zmw < 'Infinity'::numeric AND (was_zmw IS NULL OR was_zmw < 'Infinity'::numeric)
  AND (size_value IS NULL OR size_value < 'Infinity'::numeric));
ALTER TABLE order_items ADD CONSTRAINT order_items_finite_price CHECK (unit_price_zmw < 'Infinity'::numeric);
ALTER TABLE product_components ADD CONSTRAINT components_addon_price_required CHECK (
  (kind = 'included' AND addon_price_zmw IS NULL) OR
  (kind = 'addon' AND addon_price_zmw IS NOT NULL AND addon_price_zmw >= 0
   AND addon_price_zmw < 'Infinity'::numeric));
ALTER TABLE product_variants ADD CONSTRAINT variants_finite_price CHECK (
  price_zmw IS NULL OR price_zmw < 'Infinity'::numeric);
ALTER TABLE product_option_values ADD CONSTRAINT option_values_finite_size CHECK (
  size_value IS NULL OR size_value < 'Infinity'::numeric);

-- Carry product identity through every foreign key in the variant graph.
ALTER TABLE product_options ADD CONSTRAINT options_id_product_key UNIQUE (id, product_id);
ALTER TABLE product_option_values ADD COLUMN product_id text;
UPDATE product_option_values v SET product_id = o.product_id FROM product_options o WHERE o.id = v.option_id;
ALTER TABLE product_option_values ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE product_option_values ADD CONSTRAINT option_values_product_fk
  FOREIGN KEY (option_id, product_id) REFERENCES product_options (id, product_id) ON DELETE CASCADE;
ALTER TABLE product_option_values ADD CONSTRAINT option_values_identity_key UNIQUE (id, option_id, product_id);
ALTER TABLE variant_option_values ADD COLUMN product_id text;
UPDATE variant_option_values x SET product_id = v.product_id FROM product_variants v WHERE v.id = x.variant_id;
ALTER TABLE variant_option_values ALTER COLUMN product_id SET NOT NULL;
ALTER TABLE variant_option_values ADD CONSTRAINT variant_values_product_fk
  FOREIGN KEY (variant_id, product_id) REFERENCES product_variants (id, product_id) ON DELETE CASCADE;
ALTER TABLE variant_option_values ADD CONSTRAINT variant_values_option_product_fk
  FOREIGN KEY (value_id, option_id, product_id)
  REFERENCES product_option_values (id, option_id, product_id);
CREATE INDEX variant_values_value_idx ON variant_option_values (value_id, option_id, product_id);

-- A combination contains exactly one value from each axis and its key is canonical.
-- Deferred checks allow axes, variants and junction rows to be saved in one transaction.
CREATE FUNCTION validate_product_variant_matrix(pid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE axis_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = pid) THEN RETURN; END IF;
  -- Serialize matrix mutations per product; transaction-isolation retries belong to the API.
  PERFORM 1 FROM products WHERE id = pid FOR UPDATE;
  SELECT count(*) INTO axis_count FROM product_options WHERE product_id = pid;
  IF EXISTS (
    SELECT 1 FROM product_variants v LEFT JOIN variant_option_values x ON x.variant_id = v.id
    WHERE v.product_id = pid GROUP BY v.id, v.combo_key
    HAVING count(x.value_id) <> axis_count OR v.combo_key <>
      coalesce(string_agg(x.value_id::text, '-' ORDER BY x.value_id), '')
  ) THEN RAISE EXCEPTION 'Variant matrix is incomplete or has a noncanonical key for product %', pid; END IF;
END $$;
CREATE FUNCTION check_variant_matrix() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM validate_product_variant_matrix(OLD.product_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM validate_product_variant_matrix(NEW.product_id); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER variants_matrix_check AFTER INSERT OR UPDATE OR DELETE ON product_variants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_variant_matrix();
CREATE CONSTRAINT TRIGGER variant_values_matrix_check AFTER INSERT OR UPDATE OR DELETE ON variant_option_values
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_variant_matrix();
CREATE CONSTRAINT TRIGGER options_matrix_check AFTER INSERT OR UPDATE OR DELETE ON product_options
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_variant_matrix();
ALTER TABLE product_variants DROP CONSTRAINT product_variants_product_id_combo_key_key;
ALTER TABLE product_variants ADD CONSTRAINT variants_canonical_combo_key UNIQUE (product_id, combo_key)
  DEFERRABLE INITIALLY DEFERRED;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT id FROM products LOOP PERFORM validate_product_variant_matrix(p.id); END LOOP;
END $$;

-- Freeze the seller's range on each offer, so later catalogue edits cannot rewrite its terms.
ALTER TABLE price_commitments ADD COLUMN min_price_snapshot numeric(12,2),
  ADD COLUMN max_price_snapshot numeric(12,2);
UPDATE price_commitments c SET min_price_snapshot = p.commit_min_zmw, max_price_snapshot = p.commit_max_zmw
  FROM products p WHERE p.id = c.product_id;
ALTER TABLE price_commitments ALTER COLUMN min_price_snapshot SET NOT NULL,
  ALTER COLUMN max_price_snapshot SET NOT NULL;
ALTER TABLE price_commitments ADD CONSTRAINT commitment_valid_terms CHECK (
  min_price_snapshot > 0 AND min_price_snapshot < max_price_snapshot
  AND amount_zmw BETWEEN min_price_snapshot AND max_price_snapshot
  AND max_price_snapshot < 'Infinity'::numeric AND expires_at > created_at);
CREATE OR REPLACE FUNCTION check_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products;
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
  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_variants WHERE id = NEW.variant_id AND product_id = NEW.product_id AND active
  ) THEN RAISE EXCEPTION 'Offer variant is unavailable'; END IF;
  IF NEW.variant_id IS NULL AND EXISTS (SELECT 1 FROM product_options WHERE product_id = NEW.product_id) THEN
    RAISE EXCEPTION 'Choose a variant before making an offer';
  END IF;
  NEW.min_price_snapshot := p.commit_min_zmw;
  NEW.max_price_snapshot := p.commit_max_zmw;
  NEW.created_at := now(); NEW.responded_at := NULL;
  IF NEW.amount_zmw < p.commit_min_zmw OR NEW.amount_zmw > p.commit_max_zmw THEN
    RAISE EXCEPTION 'Offer is outside the seller range';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER price_commitments_check ON price_commitments;
CREATE TRIGGER price_commitments_check BEFORE INSERT OR UPDATE ON price_commitments
  FOR EACH ROW EXECUTE FUNCTION check_commitment();

-- An accepted offer may be redeemed once, by its buyer, for its exact item and quantity.
CREATE UNIQUE INDEX order_items_commitment_once ON order_items (commitment_id) WHERE commitment_id IS NOT NULL;
CREATE FUNCTION check_order_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c price_commitments; owner_id bigint;
BEGIN
  IF NEW.commitment_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT c FROM price_commitments WHERE id = NEW.commitment_id FOR UPDATE;
  SELECT user_id INTO owner_id FROM orders WHERE id = NEW.order_id;
  IF c.status <> 'accepted' OR c.buyer_id IS DISTINCT FROM owner_id
    OR c.product_id IS DISTINCT FROM NEW.product_id OR c.variant_id IS DISTINCT FROM NEW.variant_id
    OR c.quantity <> NEW.quantity OR c.amount_zmw <> NEW.unit_price_zmw THEN
    RAISE EXCEPTION 'Order does not match the accepted offer';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_items_commitment_check BEFORE INSERT OR UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION check_order_commitment();
CREATE FUNCTION keep_order_buyer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'An order cannot change buyer'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_buyer_immutable BEFORE UPDATE OF user_id ON orders
  FOR EACH ROW EXECUTE FUNCTION keep_order_buyer();
CREATE FUNCTION check_order_addon() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c product_components;
BEGIN
  SELECT * INTO STRICT c FROM product_components WHERE id = NEW.component_id AND product_id = NEW.product_id FOR SHARE;
  IF c.kind <> 'addon' OR NEW.price_zmw <> c.addon_price_zmw THEN
    RAISE EXCEPTION 'Select an optional add-on at its listed price';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_item_addons_check BEFORE INSERT OR UPDATE ON order_item_addons
  FOR EACH ROW EXECUTE FUNCTION check_order_addon();

-- One review per buyer per product (kept from 002, so repeat buyers can't skew the rating):
-- after buying again they edit their existing review rather than adding another. Each review still needs
-- a delivered purchase by the same buyer, and the purchase it's linked to can't change.
CREATE OR REPLACE FUNCTION check_review_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.product_id, NEW.user_id, NEW.order_item_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.product_id, OLD.user_id, OLD.order_item_id, OLD.created_at) THEN
      RAISE EXCEPTION 'Review purchase identity cannot change';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.id = NEW.order_item_id AND oi.product_id = NEW.product_id
      AND o.user_id = NEW.user_id AND o.status = 'delivered'
  ) THEN RAISE EXCEPTION 'A review requires the same buyer and a delivered purchase of this product'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER reviews_purchase_check ON reviews;
CREATE TRIGGER reviews_purchase_check BEFORE INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION check_review_purchase();

-- Concurrent writers increment the locked product row, rather than recounting stale snapshots.
DROP TRIGGER reviews_rating_cache ON reviews;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT id FROM products LOOP PERFORM refresh_product_rating(p.id); END LOOP;
END $$;
DROP FUNCTION reviews_refresh_rating();
DROP FUNCTION refresh_product_rating(text);
CREATE FUNCTION reviews_refresh_rating() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid text; delta integer[] := ARRAY[0,0,0,0,0]; dn integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    pid := OLD.product_id;
    IF OLD.status = 'published' THEN delta[OLD.rating] := delta[OLD.rating] - 1; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    pid := NEW.product_id;
    IF NEW.status = 'published' THEN delta[NEW.rating] := delta[NEW.rating] + 1; END IF;
  END IF;
  dn := delta[1] + delta[2] + delta[3] + delta[4] + delta[5];
  UPDATE products p SET
    total_reviews_count = p.total_reviews_count + dn,
    average_rating = coalesce(round((
      (p.rating_counts[1]+delta[1]) + 2*(p.rating_counts[2]+delta[2]) + 3*(p.rating_counts[3]+delta[3])
      + 4*(p.rating_counts[4]+delta[4]) + 5*(p.rating_counts[5]+delta[5])
    )::numeric / nullif(p.total_reviews_count + dn, 0), 2), 0),
    rating_counts = ARRAY[p.rating_counts[1]+delta[1], p.rating_counts[2]+delta[2], p.rating_counts[3]+delta[3],
                         p.rating_counts[4]+delta[4], p.rating_counts[5]+delta[5]]
  WHERE p.id = pid;
  RETURN NULL;
END $$;
CREATE TRIGGER reviews_rating_cache AFTER INSERT OR UPDATE OF rating, status OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION reviews_refresh_rating();
ALTER TABLE products ADD CONSTRAINT products_rating_cache_valid CHECK (
  average_rating BETWEEN 0 AND 5 AND total_reviews_count >= 0
  AND cardinality(rating_counts) = 5
  AND array_ndims(rating_counts) = 1 AND array_lower(rating_counts, 1) = 1
  AND array_length(rating_counts, 1) = 5 AND array_position(rating_counts, NULL) IS NULL
  AND 0 <= ALL(rating_counts)
  AND total_reviews_count = rating_counts[1]+rating_counts[2]+rating_counts[3]+rating_counts[4]+rating_counts[5]
  AND average_rating = coalesce(round((rating_counts[1]+2*rating_counts[2]+3*rating_counts[3]
    +4*rating_counts[4]+5*rating_counts[5])::numeric/nullif(total_reviews_count,0),2),0));

CREATE INDEX reviews_user_idx ON reviews (user_id);
CREATE INDEX commitments_buyer_idx ON price_commitments (buyer_id, created_at DESC);
CREATE INDEX order_item_addons_component_idx ON order_item_addons (component_id, product_id);
COMMIT;
