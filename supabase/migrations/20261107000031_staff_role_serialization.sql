-- Keep at least one owner even when two owners step down at the same time.
-- Migration 030 is already deployed: replace the function in a new migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.staff_set_roles(account_email text, new_roles text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target users; v_roles text[] := ARRAY(SELECT DISTINCT r FROM unnest(coalesce(new_roles, '{}')) r ORDER BY 1); before jsonb;
BEGIN
  -- Only an owner may take the lock, so other accounts can't hold up role changes.
  IF NOT app.has_role('owner') THEN RAISE EXCEPTION 'Only the owner manages staff' USING ERRCODE = '42501'; END IF;
  -- Serialize role changes, then check again: another owner may have changed this one's roles meanwhile.
  LOCK TABLE staff_roles IN SHARE ROW EXCLUSIVE MODE;
  IF NOT app.has_role('owner') THEN RAISE EXCEPTION 'Only the owner manages staff' USING ERRCODE = '42501'; END IF;
  IF NOT v_roles <@ ARRAY['owner', 'operations', 'support', 'catalogue', 'finance'] THEN RAISE EXCEPTION 'Unknown role'; END IF;
  SELECT * INTO target FROM users WHERE lower(email) = lower(btrim(account_email)) FOR UPDATE;
  IF NOT FOUND OR target.auth_id IS NULL THEN RAISE EXCEPTION 'No account with that email. They need to sign in to the shop once first.'; END IF;
  -- The shop always keeps an owner
  IF NOT ('owner' = ANY (v_roles)) AND EXISTS (SELECT 1 FROM staff_roles WHERE user_id = target.id AND role = 'owner')
     AND NOT EXISTS (SELECT 1 FROM staff_roles r JOIN users u ON u.id = r.user_id WHERE r.role = 'owner' AND u.is_staff AND r.user_id <> target.id) THEN
    RAISE EXCEPTION 'Make someone else an owner first: the shop must always have one';
  END IF;
  before := (SELECT coalesce(jsonb_agg(role ORDER BY role), '[]') FROM staff_roles WHERE user_id = target.id);
  PERFORM app.staff_only('set_staff_roles', target.email, jsonb_build_object('before', before, 'after', to_jsonb(v_roles)));
  IF cardinality(v_roles) = 0 THEN
    UPDATE users SET is_staff = false WHERE id = target.id;   -- the trigger removes the roles
    DELETE FROM staff_roles WHERE user_id = target.id;
  ELSE
    UPDATE users SET is_staff = true WHERE id = target.id;
    DELETE FROM staff_roles WHERE user_id = target.id AND NOT (role = ANY (v_roles));
    INSERT INTO staff_roles (user_id, role, granted_by) SELECT target.id, r, app.user_id() FROM unnest(v_roles) r ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('email', target.email, 'roles', to_jsonb(v_roles));
END $$;

COMMIT;
