-- Recurring classes, phase 1: make the sold plan explicit and give classes the
-- fields they need (discipline, per-session capacity, credit-based packages).
--
-- Context:
--   * `provider_event_ticket_types` is a lazily-created side table (see
--     `ProvidersService.ensureInfrastructure` / `MeService.ensureProviderSalesTables`).
--     The ADD COLUMNs below are mirrored there so a cold DB converges either way.
--   * `tickets` had no link to the tier that was sold: ticket creation guessed it
--     by ordering `kind` general -> early -> vip and bumped that row's
--     `sold_count`. With packages a purchase must know its plan, so
--     `ticket_type_id` becomes the source of truth and existing rows are
--     backfilled with the same heuristic they were counted under.
--   * A package purchase produces one ticket row per credit, sharing
--     `purchase_group_id`. `occurrence_date IS NULL` means "credit not booked
--     yet"; a booked class ticket carries the session it grants access to.

-- =====================================================================
-- 1. events: class metadata
-- =====================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS class_discipline text,
  -- Seats per session for recurring classes. `capacity` stays the total for
  -- single events; for classes it is not a meaningful limit.
  ADD COLUMN IF NOT EXISTS capacity_per_occurrence integer;

-- =====================================================================
-- 2. provider_event_ticket_types: a package is a ticket type with credits
-- =====================================================================

ALTER TABLE public.provider_event_ticket_types
  -- 'drop_in' | 'pack' | 'unlimited' for recurring classes; NULL for single events.
  ADD COLUMN IF NOT EXISTS plan_kind text,
  -- Sessions granted by one purchase. NULL = not credit-based (single events,
  -- or an unlimited pass bounded by validity_days instead).
  ADD COLUMN IF NOT EXISTS credits integer,
  ADD COLUMN IF NOT EXISTS validity_days integer,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS provider_event_ticket_types_event_sort_idx
  ON public.provider_event_ticket_types(event_id, sort_order, created_at);

-- =====================================================================
-- 3. tickets: which plan was sold, and which session it grants
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS ticket_type_id uuid,
  ADD COLUMN IF NOT EXISTS occurrence_date date,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchase_group_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_ticket_type_id_fkey'
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_ticket_type_id_fkey
      FOREIGN KEY (ticket_type_id)
      REFERENCES public.provider_event_ticket_types(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tickets_ticket_type_idx
  ON public.tickets(ticket_type_id);

-- Per-session capacity checks and "which credits are still unbooked" both scan
-- by (event, date), with NULLs (unbooked credits) clustered together.
CREATE INDEX IF NOT EXISTS tickets_event_occurrence_idx
  ON public.tickets(event_id, occurrence_date);

CREATE INDEX IF NOT EXISTS tickets_purchase_group_idx
  ON public.tickets(purchase_group_id)
  WHERE purchase_group_id IS NOT NULL;

-- =====================================================================
-- 4. Backfill tickets.ticket_type_id with the heuristic that counted them
-- =====================================================================

UPDATE public.tickets t
SET ticket_type_id = pick.id
FROM (
  SELECT DISTINCT ON (tt.event_id) tt.event_id, tt.id
  FROM public.provider_event_ticket_types tt
  WHERE tt.active = true
  ORDER BY
    tt.event_id,
    CASE tt.kind
      WHEN 'general' THEN 0
      WHEN 'early' THEN 1
      WHEN 'vip' THEN 2
      ELSE 3
    END ASC,
    tt.created_at ASC
) AS pick
WHERE t.ticket_type_id IS NULL
  AND t.event_id = pick.event_id;
