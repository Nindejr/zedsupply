-- Seller applications: a signed-in applicant applies to sell, Zed Supply staff review the queue
-- and approve (which opens the store with the applicant as its owner), ask for more information
-- or reject. Apply after 021. Every staff decision is kept in staff_actions.
--
--   new ──► review ──► approved
--    ▲  └──────┴─────► info_needed ──(applicant updates)──► new
--    │             └──► rejected
--    └ the applicant can withdraw while it is open (new, review or info_needed)
BEGIN;

CREATE TABLE seller_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  business     text NOT NULL CHECK (char_length(business) BETWEEN 2 AND 120),
  contact_name text NOT NULL CHECK (char_length(contact_name) BETWEEN 2 AND 80),
  phone        text NOT NULL CHECK (phone ~ '^\+260[0-9]{9}$'),
  email        text NOT NULL CHECK (char_length(email) <= 254),
  town         text NOT NULL CHECK (char_length(town) BETWEEN 2 AND 60),
  pacra        text CHECK (char_length(pacra) <= 40),
  categories   text[] NOT NULL DEFAULT '{}' CHECK (cardinality(categories) <= 30),
  about        text CHECK (char_length(about) <= 2000),
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'review', 'info_needed', 'approved', 'rejected', 'withdrawn')),
  staff_note   text CHECK (char_length(staff_note) <= 1000),   -- shown to the applicant
  reviewed_by  bigint REFERENCES users (id) ON DELETE SET NULL,
  seller_id    text REFERENCES sellers (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
-- One open application per account
CREATE UNIQUE INDEX seller_applications_open_key ON seller_applications (user_id) WHERE status IN ('new', 'review', 'info_needed');
CREATE INDEX seller_applications_queue_idx ON seller_applications (created_at) WHERE status IN ('new', 'review', 'info_needed');

ALTER TABLE seller_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Your applications, or all for staff" ON seller_applications FOR SELECT TO authenticated
  USING (user_id = (SELECT app.user_id()) OR app.is_staff());
REVOKE ALL ON seller_applications FROM anon, authenticated;
GRANT SELECT ON seller_applications TO authenticated;
GRANT ALL ON seller_applications TO service_role;

-- Zambian mobile numbers as +260 and nine digits; 09... and 260... are accepted and converted
CREATE FUNCTION app.zm_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN d ~ '^0[0-9]{9}$' THEN '+260' || substr(d, 2) WHEN d ~ '^260[0-9]{9}$' THEN '+' || d WHEN d ~ '^\+260[0-9]{9}$' THEN d END
    FROM (SELECT regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g') AS d) x
$$;

-- The applicant learns of each decision on WhatsApp (template seller_application_update) when
-- the sender is set up, and always on My Account.
CREATE FUNCTION app.notify_application(a seller_applications) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.queue_notification(a.user_id, NULL, 'seller_application_update',
    jsonb_build_object('business', a.business, 'status', a.status), a.phone)
$$;
REVOKE ALL ON FUNCTION app.zm_phone(text), app.notify_application(seller_applications) FROM PUBLIC, anon, authenticated;

-- Apply, or update an application that staff asked more information about.
-- At most 3 new applications per account in 30 days.
CREATE FUNCTION public.submit_seller_application(business text, contact_name text, phone text, town text,
  pacra text DEFAULT NULL, categories text[] DEFAULT '{}', about text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid bigint := app.user_id(); v_email text; v_phone text := app.zm_phone(phone); open_app seller_applications; v_id uuid;
  v_business text := btrim(business); v_contact text := btrim(contact_name); v_town text := btrim(town);
  v_pacra text := nullif(btrim(pacra), ''); v_about text := nullif(btrim(about), '');
  v_categories text[] := ARRAY(SELECT DISTINCT left(btrim(c), 80) FROM unnest(coalesce(categories, '{}')) c WHERE btrim(c) <> '');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT email INTO v_email FROM users WHERE id = uid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Sign in with a confirmed email to apply'; END IF;
  IF char_length(coalesce(v_business, '')) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Enter your business name'; END IF;
  IF char_length(coalesce(v_contact, '')) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Enter a contact person'; END IF;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'Enter a Zambian mobile number, for example 0977 123456'; END IF;
  IF char_length(coalesce(v_town, '')) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Enter your town or city'; END IF;
  IF char_length(v_pacra) > 40 THEN RAISE EXCEPTION 'The PACRA number is too long'; END IF;
  IF cardinality(v_categories) > 30 THEN RAISE EXCEPTION 'Choose up to 30 departments'; END IF;
  IF char_length(v_about) > 2000 THEN RAISE EXCEPTION 'Keep the description under 2,000 characters'; END IF;

  SELECT * INTO open_app FROM seller_applications WHERE user_id = uid AND status IN ('new', 'review', 'info_needed') FOR UPDATE;
  IF FOUND THEN
    IF open_app.status <> 'info_needed' THEN RAISE EXCEPTION 'Your application is already with us. We''ll be in touch.'; END IF;
    UPDATE seller_applications SET business = v_business, contact_name = v_contact, phone = v_phone, email = v_email, town = v_town,
      pacra = v_pacra, categories = v_categories, about = v_about, status = 'new', updated_at = now()
      WHERE id = open_app.id;
    RETURN open_app.id;
  END IF;
  IF (SELECT count(*) FROM seller_applications WHERE user_id = uid AND created_at > now() - interval '30 days') >= 3 THEN
    RAISE EXCEPTION 'You''ve applied several times recently. Contact us on WhatsApp for help.';
  END IF;
  INSERT INTO seller_applications (user_id, business, contact_name, phone, email, town, pacra, categories, about)
    VALUES (uid, v_business, v_contact, v_phone, v_email, v_town, v_pacra, v_categories, v_about) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.withdraw_seller_application(application uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE seller_applications SET status = 'withdrawn', updated_at = now(), decided_at = now()
   WHERE id = application AND user_id = app.user_id() AND status IN ('new', 'review', 'info_needed');
  IF NOT FOUND THEN RAISE EXCEPTION 'No open application was found for your account'; END IF;
END $$;

-- Staff: mark under review, ask for more information or reject. Asking and rejecting need a
-- message, which the applicant sees.
CREATE FUNCTION public.staff_review_application(application uuid, decision text, note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a seller_applications; v_note text := nullif(btrim(note), '');
BEGIN
  PERFORM app.staff_only('review_seller_application', application::text, jsonb_build_object('decision', decision, 'note', v_note));
  IF decision IS NULL OR decision NOT IN ('review', 'info_needed', 'rejected') THEN RAISE EXCEPTION 'Choose a decision'; END IF;
  IF decision <> 'review' AND char_length(coalesce(v_note, '')) < 5 THEN RAISE EXCEPTION 'Write a message to the applicant'; END IF;
  IF char_length(v_note) > 1000 THEN RAISE EXCEPTION 'Keep the message under 1,000 characters'; END IF;
  UPDATE seller_applications SET status = decision, staff_note = coalesce(v_note, staff_note), reviewed_by = app.user_id(), updated_at = now(),
    decided_at = CASE WHEN decision = 'rejected' THEN now() END
   WHERE id = application AND status IN ('new', 'review', 'info_needed') RETURNING * INTO a;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open application'; END IF;
  IF decision <> 'review' THEN PERFORM app.notify_application(a); END IF;
END $$;

-- Staff: approve. Opens the store, verified, with the applicant as its owner. VAT stays off until
-- staff confirm the store's registration and TPIN with ZRA and set them on the store.
CREATE FUNCTION public.staff_approve_application(application uuid, store_id text, store_name text DEFAULT NULL, note text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a seller_applications; v_id text := lower(btrim(store_id)); v_note text := nullif(btrim(note), '');
BEGIN
  PERFORM app.staff_only('approve_seller_application', application::text, jsonb_build_object('store_id', v_id, 'note', v_note));
  IF v_id IS NULL OR v_id !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN RAISE EXCEPTION 'Use 3–40 lowercase letters, numbers and dashes for the store ID'; END IF;
  IF char_length(v_note) > 1000 THEN RAISE EXCEPTION 'Keep the message under 1,000 characters'; END IF;
  SELECT * INTO a FROM seller_applications WHERE id = application FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('new', 'review', 'info_needed') THEN RAISE EXCEPTION 'No open application'; END IF;
  IF EXISTS (SELECT 1 FROM sellers WHERE id = v_id) THEN RAISE EXCEPTION 'That store ID is taken. Choose another.'; END IF;
  INSERT INTO sellers (id, name, city, verified, vat_registered)
    VALUES (v_id, left(coalesce(nullif(btrim(store_name), ''), a.business), 120), a.town, true, false);
  INSERT INTO seller_members (seller_id, user_id, role) VALUES (v_id, a.user_id, 'owner');
  PERFORM app.team_log(v_id, 'joined', app.member_label(a.user_id), 'owner');
  UPDATE seller_applications SET status = 'approved', seller_id = v_id, staff_note = v_note, reviewed_by = app.user_id(),
    updated_at = now(), decided_at = now() WHERE id = application RETURNING * INTO a;
  PERFORM app.notify_application(a);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_seller_application(text, text, text, text, text, text[], text), public.withdraw_seller_application(uuid),
  public.staff_review_application(uuid, text, text), public.staff_approve_application(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_seller_application(text, text, text, text, text, text[], text), public.withdraw_seller_application(uuid),
  public.staff_review_application(uuid, text, text), public.staff_approve_application(uuid, text, text, text) TO authenticated, service_role;
COMMIT;
