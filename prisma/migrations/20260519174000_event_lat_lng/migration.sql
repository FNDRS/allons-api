-- Event precise location (map pin)

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Optional: basic range checks (soft, not enforced here).
