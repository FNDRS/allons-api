-- Marks a reservation whose session reminder has already been queued.
--
-- The reminder sweep runs every 15 minutes, so it will see the same upcoming
-- session many times. Deduping on a column rather than on "the cron only fires
-- once" keeps it idempotent across restarts, redeploys and overlapping runs —
-- a push telling someone about the same class four times is worse than none.
ALTER TABLE class_session_reservations
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

-- Partial: the sweep only ever looks for rows still awaiting a reminder, which
-- is a shrinking slice of the table.
CREATE INDEX IF NOT EXISTS class_session_reservations_pending_reminder_idx
  ON class_session_reservations (session_date, start_time)
  WHERE reminded_at IS NULL AND status = 'reserved';
