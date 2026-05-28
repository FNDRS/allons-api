-- Per-event refund policy (set by comercios in allons-mobile event form).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS refund_policy text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS refund_partial_pct integer,
  ADD COLUMN IF NOT EXISTS refund_deadline_days integer;
