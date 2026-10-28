-- Orders and after-sales: saved addresses, delivery preferences, gifts, VAT, cancellations,
-- returns and complaints (PostgreSQL 15+). Apply after 001–005.
-- The browser prototype already uses these fields (js/main.js, settings.orderOptions); this is
-- where they live once accounts and orders move to the server.

BEGIN;

-- ---------- VAT ----------
-- Zed Supply's own registration lives in settings; each seller can be VAT-registered or not.
ALTER TABLE sellers
  ADD COLUMN vat_registered boolean NOT NULL DEFAULT true,
  ADD COLUMN tpin text CHECK (tpin IS NULL OR tpin ~ '^[0-9]{10}$');   -- ZRA taxpayer number

-- ---------- Saved addresses ----------
CREATE TABLE user_addresses (
  id            bigserial PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label         text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 30),   -- Home, Work…
  recipient     text CHECK (char_length(recipient) <= 60),
  phone         text CHECK (char_length(phone) <= 20),
  town          text NOT NULL CHECK (char_length(btrim(town)) BETWEEN 1 AND 60),
  area          text CHECK (char_length(area) <= 60),
  landmark      text CHECK (char_length(landmark) <= 100),
  instructions  text CHECK (char_length(instructions) <= 160),
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX user_addresses_one_default ON user_addresses (user_id) WHERE is_default;

-- Up to 10 addresses per buyer, as the address book allows
CREATE FUNCTION check_address_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM user_addresses WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'A buyer can save up to 10 addresses';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_addresses_limit BEFORE INSERT ON user_addresses FOR EACH ROW EXECUTE FUNCTION check_address_limit();

-- ---------- What the order records at checkout ----------
-- The address is copied into deliver_to, so editing or deleting a saved address never changes a past order.
ALTER TABLE orders
  ADD COLUMN ref             text UNIQUE CHECK (ref ~ '^ZS-[A-Z0-9]{4,12}$'),
  ADD COLUMN address_id      bigint,
  ADD COLUMN deliver_to      text CHECK (char_length(deliver_to) <= 300),
  ADD COLUMN recipient_phone text CHECK (char_length(recipient_phone) <= 20),
  ADD COLUMN delivery_scope  text CHECK (delivery_scope IN ('town', 'country', 'world')),
  ADD COLUMN courier_id      text,
  ADD COLUMN preferred_date  date,
  ADD COLUMN preferred_slot  text CHECK (char_length(preferred_slot) <= 30),   -- settings.delivery.slots ids
  ADD COLUMN is_gift         boolean NOT NULL DEFAULT false,
  ADD COLUMN gift_message    text CHECK (char_length(gift_message) <= 250),
  ADD COLUMN hide_prices     boolean NOT NULL DEFAULT false,
  ADD COLUMN payment_method  text CHECK (char_length(payment_method) <= 40),
  ADD COLUMN voucher_code    text,
  ADD COLUMN subtotal_zmw    numeric(12,2) CHECK (subtotal_zmw >= 0),
  ADD COLUMN discount_zmw    numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_zmw >= 0),
  ADD COLUMN delivery_zmw    numeric(12,2) CHECK (delivery_zmw >= 0),           -- confirmed on WhatsApp
  ADD COLUMN vat_rate        numeric(5,2) CHECK (vat_rate >= 0 AND vat_rate < 100),
  ADD COLUMN vat_included    boolean NOT NULL DEFAULT true,
  ADD COLUMN vat_zmw         numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_zmw >= 0),
  ADD COLUMN total_zmw       numeric(12,2) CHECK (total_zmw >= 0),
  ADD COLUMN notes           text CHECK (char_length(notes) <= 500),
  ADD FOREIGN KEY (address_id, user_id) REFERENCES user_addresses (id, user_id) ON DELETE SET NULL (address_id),
  -- preferred_date must be on or after the order day: checked by the API, since a date cast
  -- from timestamptz depends on the server's time zone
  ADD CHECK (is_gift OR (gift_message IS NULL AND NOT hide_prices)),
  ADD CHECK (vat_rate IS NOT NULL OR vat_zmw = 0);

-- ---------- Cancellations ----------
CREATE TYPE cancel_status AS ENUM ('requested', 'approved', 'declined', 'withdrawn');
CREATE TABLE order_cancellations (
  id            bigserial PRIMARY KEY,
  order_id      bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  status        cancel_status NOT NULL DEFAULT 'requested',
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  refund_zmw    numeric(12,2) CHECK (refund_zmw >= 0),       -- if already paid
  refunded_at   timestamptz,
  note          text CHECK (char_length(note) <= 500),
  CHECK ((status = 'requested') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX order_cancellations_one_open ON order_cancellations (order_id) WHERE status = 'requested';

-- A cancellation can only be asked for while the order isn't delivered or already cancelled;
-- approving one cancels the order.
CREATE FUNCTION check_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF TG_OP = 'INSERT' AND st IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'Order % is already %; use a return instead', NEW.order_id, st;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status = 'requested' THEN
    UPDATE orders SET status = 'cancelled' WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_cancellations_check BEFORE INSERT OR UPDATE OF status ON order_cancellations
  FOR EACH ROW EXECUTE FUNCTION check_cancellation();

-- ---------- Returns ----------
CREATE TYPE return_kind AS ENUM ('faulty', 'damaged', 'wrong', 'not_described', 'missing_parts', 'change_of_mind');
CREATE TYPE return_status AS ENUM ('requested', 'approved', 'declined', 'collected', 'received', 'refunded', 'replaced', 'repaired', 'closed');
CREATE TYPE refund_method AS ENUM ('mobile', 'bank', 'card', 'cash');
CREATE TABLE return_requests (
  id              bigserial PRIMARY KEY,
  order_item_id   bigint NOT NULL REFERENCES order_items (id),
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  kind            return_kind NOT NULL,
  details         text CHECK (char_length(details) <= 1000),
  status          return_status NOT NULL DEFAULT 'requested',
  buyer_pays_return boolean NOT NULL DEFAULT false,         -- true only for change of mind
  requested_at    timestamptz NOT NULL DEFAULT now(),
  received_at     timestamptz,
  refund_zmw      numeric(12,2) CHECK (refund_zmw >= 0),
  refund_method   refund_method,
  refunded_at     timestamptz,
  CHECK (kind = 'change_of_mind' OR NOT buyer_pays_return),
  CHECK ((refunded_at IS NULL) OR (refund_zmw IS NOT NULL AND refund_method IS NOT NULL))
);
CREATE INDEX return_requests_item_idx ON return_requests (order_item_id);

-- ---------- Complaints ----------
CREATE TYPE complaint_type AS ENUM ('not_received', 'damaged', 'wrong', 'not_described', 'faulty', 'missing',
  'refund', 'conduct', 'misleading', 'unsafe', 'delivery', 'other');
CREATE TYPE complaint_want AS ENUM ('refund', 'replace', 'repair', 'return', 'fix', 'inform');
CREATE TYPE complaint_status AS ENUM ('sent', 'review', 'seller', 'resolved', 'closed');
CREATE TYPE complaint_author AS ENUM ('buyer', 'seller', 'staff');

-- Anyone can complain, including someone who hasn't bought: user_id and order_id are optional,
-- but a complaint always has a way to reply (a user or a phone number).
CREATE TABLE complaints (
  id                bigserial PRIMARY KEY,
  ref               text NOT NULL UNIQUE CHECK (ref ~ '^ZC-[A-Z0-9]{4,12}$'),
  user_id           bigint REFERENCES users (id) ON DELETE SET NULL,
  contact_name      text NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 1 AND 60),
  contact_phone     text CHECK (char_length(contact_phone) <= 20),
  order_id          bigint REFERENCES orders (id) ON DELETE SET NULL,
  seller_id         text REFERENCES sellers (id) ON DELETE SET NULL,
  product_id        text REFERENCES products (id) ON DELETE SET NULL,
  type              complaint_type NOT NULL,
  wanted            complaint_want NOT NULL,
  details           text NOT NULL CHECK (char_length(btrim(details)) BETWEEN 10 AND 1000),
  share_with_seller boolean NOT NULL DEFAULT true,
  status            complaint_status NOT NULL DEFAULT 'sent',
  created_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_at   timestamptz,
  reply_due_at      timestamptz,                -- created_at + settings.orderOptions.complaints.replyDays working days
  seller_replied_at timestamptz,
  resolved_at       timestamptz,
  outcome           text CHECK (char_length(outcome) <= 1000),
  upheld            boolean,                    -- Zed Supply's finding once resolved: was the buyer right?
  review_requested  boolean NOT NULL DEFAULT false,
  referred_to       text CHECK (referred_to IN ('ccpc', 'zicta', 'payment_provider')),
  CHECK (user_id IS NOT NULL OR contact_phone IS NOT NULL),
  CHECK ((status IN ('resolved', 'closed')) = (resolved_at IS NOT NULL))
);
CREATE INDEX complaints_seller_idx ON complaints (seller_id, status, created_at DESC);
CREATE INDEX complaints_user_idx ON complaints (user_id, created_at DESC);

-- The conversation: buyer, seller and Zed Supply staff. A seller only sees complaints about their
-- own store, and only when share_with_seller is true (enforce in the API's row-level rules).
CREATE TABLE complaint_messages (
  id            bigserial PRIMARY KEY,
  complaint_id  bigint NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
  author        complaint_author NOT NULL,
  body          text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE complaint_attachments (
  id            bigserial PRIMARY KEY,
  complaint_id  bigint NOT NULL REFERENCES complaints (id) ON DELETE CASCADE,
  src           text NOT NULL,
  alt           text CHECK (char_length(alt) <= 160),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Upheld complaints per seller in the last 90 days, for warnings and pausing stores
CREATE VIEW seller_complaint_counts AS
  SELECT seller_id, count(*) FILTER (WHERE upheld) AS upheld_90d, count(*) AS total_90d
  FROM complaints WHERE seller_id IS NOT NULL AND created_at > now() - interval '90 days'
  GROUP BY seller_id;

COMMIT;
