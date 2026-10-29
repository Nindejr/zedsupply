-- Make the 10-address limit hold when two addresses are saved at the same moment
-- (PostgreSQL 15+). Apply after 001–007.
-- In 006 the check only counted existing rows, so two saves at once each counted 9 and
-- both went through, leaving 11 (found with two live connections on PostgreSQL 18).
-- Locking the buyer's row first makes the second save wait, then count 10 and stop.

BEGIN;

CREATE OR REPLACE FUNCTION check_address_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF (SELECT count(*) FROM user_addresses WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'A buyer can save up to 10 addresses';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
