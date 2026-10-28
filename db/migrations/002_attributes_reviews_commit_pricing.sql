-- Zed Supply: product attributes, variants, in-the-box add-ons, buyer commit pricing
-- and reviews (PostgreSQL 15+). Requires 001_core.sql.
--
-- Design: a hybrid, not pure EAV.
--   Typed columns for the built-in attributes buyers filter on (size, age range),
--     so filters use ordinary indexes.
--   JSONB `specs` for free-form seller key-values (Battery, Warranty, ...).
--   Separate tables for variations, components and reviews, because they each have
--     their own stock, prices or rules.

BEGIN;

-- ---------- Types ----------
CREATE TYPE measure_unit   AS ENUM ('ml', 'l', 'g', 'kg', 'mm', 'cm', 'm', 'in');
CREATE TYPE age_range      AS ENUM ('infant', 'kid', 'teen', 'adult', 'senior');
CREATE TYPE component_kind AS ENUM ('included', 'addon');
CREATE TYPE pricing_mode   AS ENUM ('fixed', 'commit');
CREATE TYPE option_kind    AS ENUM ('colour', 'size', 'custom');
CREATE TYPE offer_status   AS ENUM ('pending', 'accepted', 'declined', 'expired', 'withdrawn');

-- Converts a size to its base unit (ml, g or mm) so "1.5 l" and "500 ml" compare and filter together.
CREATE FUNCTION unit_to_base(v numeric, u measure_unit) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT v * CASE u WHEN 'ml' THEN 1 WHEN 'l' THEN 1000
                    WHEN 'g'  THEN 1 WHEN 'kg' THEN 1000
                    WHEN 'mm' THEN 1 WHEN 'cm' THEN 10 WHEN 'm' THEN 1000 WHEN 'in' THEN 25.4 END
$$;

CREATE FUNCTION unit_dimension(u measure_unit) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN u IN ('ml', 'l') THEN 'volume' WHEN u IN ('g', 'kg') THEN 'mass' ELSE 'length' END
$$;

-- ---------- A. Attributes on the product ----------
ALTER TABLE products
  ADD COLUMN manufacturer   text,                                  -- when it differs from the brand store
  ADD COLUMN size_value     numeric(10,3) CHECK (size_value > 0),  -- single-size items; multi-size items use variants
  ADD COLUMN size_unit      measure_unit,
  ADD COLUMN size_base      numeric GENERATED ALWAYS AS (unit_to_base(size_value, size_unit)) STORED,
  ADD COLUMN age_ranges     age_range[] NOT NULL DEFAULT '{}',
  ADD COLUMN specs          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(specs) = 'object'),
  ADD CONSTRAINT products_size_pair CHECK ((size_value IS NULL) = (size_unit IS NULL));

CREATE INDEX products_size_idx  ON products (department_id, unit_dimension(size_unit), size_base) WHERE size_unit IS NOT NULL;
CREATE INDEX products_age_idx   ON products USING gin (age_ranges);
CREATE INDEX products_specs_idx ON products USING gin (specs jsonb_path_ops);

-- Department listing templates: which fields the seller form shows for each department.
-- spec_key is '' for built-in attributes, or a suggested spec name such as 'Battery'.
CREATE TABLE attribute_templates (
  department_id text NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
  attribute     text NOT NULL CHECK (attribute IN ('colour', 'size', 'age_range', 'components', 'manufacturer', 'spec')),
  spec_key      text NOT NULL DEFAULT '',
  size_units    measure_unit[] NOT NULL DEFAULT '{}',  -- units offered in the dropdown, first is the default
  required      boolean NOT NULL DEFAULT false,
  position      smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (department_id, attribute, spec_key),
  CHECK ((attribute = 'spec') = (spec_key <> ''))
);

-- ---------- A. Variations (Colour x Size matrix) ----------
CREATE TABLE product_options (                       -- one row per axis: Colour, Size, or a seller-named one
  id          bigserial PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  kind        option_kind NOT NULL,
  name        text NOT NULL,                         -- 'Colour', 'Size', 'Pattern'
  position    smallint NOT NULL DEFAULT 0,
  UNIQUE (product_id, name),
  UNIQUE (id, kind)
);

CREATE TABLE product_option_values (
  id          bigserial PRIMARY KEY,
  option_id   bigint NOT NULL,
  option_kind option_kind NOT NULL,                  -- copied from the axis so the checks below can see it
  label       text NOT NULL,                         -- 'Midnight black', 'XL', '500 ml'
  hex         char(7) CHECK (hex ~ '^#[0-9A-Fa-f]{6}$'),
  size_value  numeric(10,3) CHECK (size_value > 0),  -- measured sizes; letter sizes leave these empty
  size_unit   measure_unit,
  position    smallint NOT NULL DEFAULT 0,
  FOREIGN KEY (option_id, option_kind) REFERENCES product_options (id, kind) ON DELETE CASCADE,
  UNIQUE (option_id, label),
  UNIQUE (id, option_id),
  CHECK ((option_kind = 'colour') = (hex IS NOT NULL)),          -- every colour has a swatch, nothing else does
  CHECK ((size_value IS NULL) = (size_unit IS NULL)),
  CHECK (option_kind = 'size' OR size_value IS NULL)
);

CREATE TABLE product_variants (                      -- one row per combination, e.g. Black / M
  id          bigserial PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  sku         text NOT NULL,
  combo_key   text NOT NULL,                         -- sorted option value ids, '12-40'; blocks duplicate combinations
  stock_qty   integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  price_zmw   numeric(12,2) CHECK (price_zmw > 0),   -- NULL uses the product price
  image       text,                                  -- photo of this colour, optional
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (product_id, sku),
  UNIQUE (product_id, combo_key),
  UNIQUE (id, product_id)
);

CREATE TABLE variant_option_values (
  variant_id  bigint NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
  option_id   bigint NOT NULL,
  value_id    bigint NOT NULL,
  PRIMARY KEY (variant_id, option_id),               -- one value per axis
  FOREIGN KEY (value_id, option_id) REFERENCES product_option_values (id, option_id) ON DELETE CASCADE
);

-- ---------- A. In the box ----------
CREATE TABLE product_components (
  id              bigserial PRIMARY KEY,
  product_id      text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name            text NOT NULL,                     -- 'USB-C cable', 'User manual'
  kind            component_kind NOT NULL DEFAULT 'included',
  quantity        smallint NOT NULL DEFAULT 1 CHECK (quantity > 0),
  addon_price_zmw numeric(12,2),
  position        smallint NOT NULL DEFAULT 0,
  UNIQUE (product_id, name),
  UNIQUE (id, product_id),
  CHECK ((kind = 'included' AND addon_price_zmw IS NULL) OR (kind = 'addon' AND addon_price_zmw >= 0))
);

-- ---------- B. Buyer commit pricing ----------
-- price_zmw stays the fixed Buy now price. In commit mode buyers may also name a price
-- between commit_min_zmw and commit_max_zmw (the retail target), and the seller confirms it.
ALTER TABLE products
  ADD COLUMN pricing_mode   pricing_mode NOT NULL DEFAULT 'fixed',
  ADD COLUMN commit_min_zmw numeric(12,2),
  ADD COLUMN commit_max_zmw numeric(12,2),
  ADD CONSTRAINT products_commit_range CHECK (
    (pricing_mode = 'fixed'  AND commit_min_zmw IS NULL AND commit_max_zmw IS NULL) OR
    (pricing_mode = 'commit' AND commit_min_zmw > 0 AND commit_min_zmw < commit_max_zmw
                             AND commit_max_zmw <= price_zmw));

CREATE TABLE price_commitments (
  id            bigserial PRIMARY KEY,
  product_id    text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  variant_id    bigint,
  buyer_id      bigint NOT NULL REFERENCES users (id),
  amount_zmw    numeric(12,2) NOT NULL CHECK (amount_zmw > 0),   -- per unit, before add-ons
  quantity      integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status        offer_status NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  responded_at  timestamptz,
  FOREIGN KEY (variant_id, product_id) REFERENCES product_variants (id, product_id)
);
CREATE UNIQUE INDEX price_commitments_one_open ON price_commitments (buyer_id, product_id, coalesce(variant_id, 0))
  WHERE status = 'pending';                          -- one open offer per buyer per item
CREATE INDEX price_commitments_product_idx ON price_commitments (product_id, status);

-- Offers must fall inside the seller's range at the time they are made.
CREATE FUNCTION check_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products;
BEGIN
  SELECT * INTO p FROM products WHERE id = NEW.product_id;
  IF p.pricing_mode <> 'commit' THEN
    RAISE EXCEPTION 'Product % does not accept commit pricing', NEW.product_id;
  END IF;
  IF NEW.amount_zmw < p.commit_min_zmw OR NEW.amount_zmw > p.commit_max_zmw THEN
    RAISE EXCEPTION 'Offer % is outside the range % to %', NEW.amount_zmw, p.commit_min_zmw, p.commit_max_zmw;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER price_commitments_check BEFORE INSERT ON price_commitments
  FOR EACH ROW EXECUTE FUNCTION check_commitment();

-- What was ordered: the variant, the add-ons ticked, and where the price came from.
ALTER TABLE order_items
  ADD COLUMN variant_id    bigint,
  ADD COLUMN commitment_id bigint REFERENCES price_commitments (id),
  ADD COLUMN price_source  text NOT NULL DEFAULT 'fixed' CHECK (price_source IN ('fixed', 'deal', 'promotion', 'commit')),
  ADD FOREIGN KEY (variant_id, product_id) REFERENCES product_variants (id, product_id),
  ADD CHECK ((price_source = 'commit') = (commitment_id IS NOT NULL));

CREATE TABLE order_item_addons (
  order_item_id bigint NOT NULL,
  product_id    text NOT NULL,
  component_id  bigint NOT NULL,
  price_zmw     numeric(12,2) NOT NULL CHECK (price_zmw >= 0),  -- add-on price at the time of the order
  PRIMARY KEY (order_item_id, component_id),
  FOREIGN KEY (order_item_id, product_id) REFERENCES order_items (id, product_id) ON DELETE CASCADE,
  FOREIGN KEY (component_id, product_id) REFERENCES product_components (id, product_id)
);

-- ---------- C. Reviews ----------
CREATE TABLE reviews (
  id            bigserial PRIMARY KEY,
  product_id    text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  user_id       bigint NOT NULL REFERENCES users (id),
  order_item_id bigint NOT NULL,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_title  text NOT NULL CHECK (char_length(btrim(review_title)) BETWEEN 1 AND 120),
  review_body   text NOT NULL CHECK (char_length(btrim(review_body)) BETWEEN 1 AND 5000),
  status        text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_item_id, product_id) REFERENCES order_items (id, product_id),
  UNIQUE (order_item_id),                            -- one review per purchase
  UNIQUE (product_id, user_id)                       -- buying twice still means one review; editing updates it
);
CREATE INDEX reviews_product_idx ON reviews (product_id, status, created_at DESC);

-- The purchase must be the reviewer's own, and delivered.
CREATE FUNCTION check_review_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.id = NEW.order_item_id AND o.user_id = NEW.user_id AND o.status = 'delivered'
  ) THEN
    RAISE EXCEPTION 'Reviews need a delivered order of this product by the same buyer';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviews_purchase_check BEFORE INSERT OR UPDATE OF order_item_id, user_id ON reviews
  FOR EACH ROW EXECUTE FUNCTION check_review_purchase();

-- Cached aggregate on the product, so listings and the star breakdown need no extra query.
-- rating_counts[n] is the number of n-star reviews (1-based, so [5] is five stars).
ALTER TABLE products
  ADD COLUMN average_rating      numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN total_reviews_count integer NOT NULL DEFAULT 0,
  ADD COLUMN rating_counts       integer[] NOT NULL DEFAULT '{0,0,0,0,0}'
    CHECK (array_length(rating_counts, 1) = 5);
CREATE INDEX products_rating_idx ON products (average_rating DESC, total_reviews_count DESC);

-- Recounts from the reviews table rather than adding and subtracting, so the cache can't drift.
CREATE FUNCTION refresh_product_rating(pid text) RETURNS void LANGUAGE sql AS $$
  UPDATE products p SET
    total_reviews_count = s.n,
    average_rating      = coalesce(s.avg, 0),
    rating_counts       = ARRAY[s.c1, s.c2, s.c3, s.c4, s.c5]
  FROM (
    SELECT count(*)::int AS n, round(avg(rating), 2) AS avg,
           count(*) FILTER (WHERE rating = 1)::int AS c1, count(*) FILTER (WHERE rating = 2)::int AS c2,
           count(*) FILTER (WHERE rating = 3)::int AS c3, count(*) FILTER (WHERE rating = 4)::int AS c4,
           count(*) FILTER (WHERE rating = 5)::int AS c5
    FROM reviews WHERE product_id = pid AND status = 'published'
  ) s
  WHERE p.id = pid
$$;

CREATE FUNCTION reviews_refresh_rating() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM refresh_product_rating(OLD.product_id); END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.product_id <> OLD.product_id) THEN
    PERFORM refresh_product_rating(NEW.product_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER reviews_rating_cache AFTER INSERT OR UPDATE OF rating, status, product_id OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION reviews_refresh_rating();

COMMIT;
