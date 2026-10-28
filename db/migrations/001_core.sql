-- Zed Supply: core tables (PostgreSQL 15+)
-- The live site is static and reads js/catalogue.js. These tables are the same data
-- once accounts, orders and reviews move to a server (Phase 2). Column names follow
-- catalogue.js: priceZMW -> price_zmw, wasZMW -> was_zmw, match -> match_key.

BEGIN;

CREATE TABLE departments (
  id          text PRIMARY KEY,                      -- 'tech', 'essentials', ...
  name        text NOT NULL
);

CREATE TABLE sellers (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  city        text NOT NULL DEFAULT 'Lusaka',
  verified    boolean NOT NULL DEFAULT false,
  about       text
);

CREATE TABLE brands (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  tagline     text,
  featured    boolean NOT NULL DEFAULT false
);

CREATE TABLE users (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  phone       text NOT NULL UNIQUE,                  -- WhatsApp number, E.164
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id            text PRIMARY KEY,                    -- 'L004'
  title         text NOT NULL,
  department_id text NOT NULL REFERENCES departments (id),
  seller_id     text NOT NULL REFERENCES sellers (id),
  brand_id      text REFERENCES brands (id),
  price_zmw     numeric(12,2) NOT NULL CHECK (price_zmw > 0),
  was_zmw       numeric(12,2) CHECK (was_zmw > price_zmw),
  stock_status  text NOT NULL DEFAULT 'in' CHECK (stock_status IN ('in', 'low', 'request')),
  image         text,
  alt           text,
  tags          text,
  description   text,
  match_key     text,                                -- same item from different sellers
  added_on      date NOT NULL DEFAULT current_date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_department_idx ON products (department_id);
CREATE INDEX products_seller_idx ON products (seller_id);
CREATE INDEX products_match_idx ON products (match_key) WHERE match_key IS NOT NULL;

CREATE TABLE orders (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users (id),
  status      text NOT NULL DEFAULT 'placed'
              CHECK (status IN ('placed', 'confirmed', 'delivered', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX orders_user_idx ON orders (user_id);

CREATE TABLE order_items (
  id              bigserial PRIMARY KEY,
  order_id        bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id      text NOT NULL REFERENCES products (id),
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_zmw  numeric(12,2) NOT NULL CHECK (unit_price_zmw > 0),  -- price at the time of the order
  UNIQUE (id, product_id)                            -- lets reviews check the product matches
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

COMMIT;
