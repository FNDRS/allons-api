-- Soft-delete column on tickets. Lets cancellation preserve the audit
-- trail (scan history, sold_count math, dispute lookups) instead of
-- silently hard-deleting the row.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS tickets_cancelled_at_idx
  ON public.tickets (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

-- One row per cancellation event. Captures policy snapshot at the
-- time of request so a later policy change doesn't rewrite history.
-- `status` is intentionally TEXT (not an enum) — the lifecycle is
-- still evolving and adding enum values requires a migration.
CREATE TABLE IF NOT EXISTS public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id UUID NOT NULL REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HNL',
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  policy_eligible_at_request BOOLEAN NOT NULL,
  policy_deadline_hours_at_request INTEGER,
  paygate_payment_id TEXT,
  paygate_refund_response JSONB,
  notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refunds_payment_order_id_idx
  ON public.refunds (payment_order_id);

CREATE INDEX IF NOT EXISTS refunds_status_requested_at_idx
  ON public.refunds (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS refunds_user_id_requested_at_idx
  ON public.refunds (user_id, requested_at DESC);
