-- Locations: provinces and towns, seller stock locations with collection, the provinces each
-- seller delivers to, delivery estimates by distance, and delivery or collection on orders and
-- addresses (PostgreSQL 15+). Apply after 001–008.
-- Mirrors js/catalogue.js settings.provinces, settings.towns, settings.delivery.estimates and
-- sellers[].location. Buyers' exact GPS positions are never stored: the device turns them
-- into the nearest town, and only the town and province are kept.

BEGIN;

CREATE TABLE provinces (
  id    text PRIMARY KEY CHECK (id ~ '^[a-z]+$'),    -- 'copperbelt'
  name  text NOT NULL UNIQUE
);

-- Town centres, for matching a device position to the nearest town and for suggestions
CREATE TABLE towns (
  name        text PRIMARY KEY,
  province_id text NOT NULL REFERENCES provinces (id),
  lat         numeric(7,4) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         numeric(7,4) NOT NULL CHECK (lng BETWEEN -180 AND 180)
);
CREATE INDEX towns_province_idx ON towns (province_id);

-- Where a seller's stock is, and whether buyers can collect from there
CREATE TABLE seller_locations (
  seller_id          text PRIMARY KEY REFERENCES sellers (id) ON DELETE CASCADE,
  town               text NOT NULL CHECK (char_length(btrim(town)) BETWEEN 1 AND 60),
  area               text CHECK (char_length(area) <= 60),
  province_id        text REFERENCES provinces (id),
  collection_enabled boolean NOT NULL DEFAULT false,
  collection_address text CHECK (char_length(collection_address) <= 120),
  collection_hours   text CHECK (char_length(collection_hours) <= 60),
  delivers_everywhere boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Collection needs an address. IS NOT NULL is explicit: a CHECK on a NULL passes otherwise.
  CHECK (NOT collection_enabled OR (collection_address IS NOT NULL AND char_length(btrim(collection_address)) > 0))
);

-- When a seller doesn't deliver everywhere: the provinces they do deliver to
CREATE TABLE seller_delivery_areas (
  seller_id   text NOT NULL REFERENCES seller_locations (seller_id) ON DELETE CASCADE,
  province_id text NOT NULL REFERENCES provinces (id),
  PRIMARY KEY (seller_id, province_id)
);

-- Typical delivery time in working days by how far a parcel travels
CREATE TABLE delivery_estimates (
  zone      text PRIMARY KEY CHECK (zone IN ('town', 'province', 'country', 'world')),
  min_days  smallint NOT NULL CHECK (min_days >= 0),
  max_days  smallint NOT NULL,
  CHECK (max_days >= min_days)
);

-- Buyers: the province with each saved address, and delivery or collection as their preference
ALTER TABLE user_addresses ADD COLUMN province_id text REFERENCES provinces (id);
ALTER TABLE users ADD COLUMN preferred_fulfilment text NOT NULL DEFAULT 'delivery' CHECK (preferred_fulfilment IN ('delivery', 'collection'));

-- Orders: delivered or collected, and for collection, the seller location it's collected from
-- (copied, so a later change to the seller's address doesn't rewrite the order)
ALTER TABLE orders
  ADD COLUMN fulfilment         text NOT NULL DEFAULT 'delivery' CHECK (fulfilment IN ('delivery', 'collection')),
  ADD COLUMN buyer_town         text CHECK (char_length(buyer_town) <= 60),
  ADD COLUMN buyer_province_id  text REFERENCES provinces (id),
  ADD COLUMN collection_point   text CHECK (char_length(collection_point) <= 200),
  ADD CHECK (fulfilment = 'collection' OR collection_point IS NULL);

COMMIT;
