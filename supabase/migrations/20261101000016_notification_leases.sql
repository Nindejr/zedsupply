-- Persist outbox claims beyond the claiming transaction. Apply before deploying the sender.
BEGIN;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_status_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'skipped'));
ALTER TABLE public.notifications ADD COLUMN claimed_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN claim_token uuid;
CREATE INDEX notifications_lease_idx ON public.notifications (claimed_at) WHERE status = 'processing';

CREATE FUNCTION app.claim_notifications()
RETURNS SETOF public.notifications LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  -- A crashed worker's final attempt must not leave the message processing forever.
  UPDATE notifications SET status = 'failed', claimed_at = NULL, claim_token = NULL,
    last_error = 'Delivery lease expired after final attempt'
    WHERE status = 'processing' AND claimed_at < now() - interval '10 minutes' AND attempts >= 5;
  RETURN QUERY
    WITH candidates AS (
      SELECT id FROM notifications
      WHERE channel = 'whatsapp' AND attempts < 5
        AND (status = 'queued' OR (status = 'processing' AND claimed_at < now() - interval '10 minutes'))
      ORDER BY created_at, id LIMIT 20 FOR UPDATE SKIP LOCKED
    )
    UPDATE notifications n SET status = 'processing', attempts = n.attempts + 1,
      claimed_at = now(), claim_token = gen_random_uuid()
    FROM candidates c WHERE n.id = c.id RETURNING n.*;
END $$;
REVOKE ALL ON FUNCTION app.claim_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.claim_notifications() TO service_role;
COMMIT;
