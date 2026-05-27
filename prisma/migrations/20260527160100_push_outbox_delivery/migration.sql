-- Delivery bookkeeping for the push worker (retry + error visibility).
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
