-- Add dedupe_key to avoid duplicate notifications per user.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- Unique per user, but allow multiple NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_key_unique
  ON public.notifications (user_id, dedupe_key);
