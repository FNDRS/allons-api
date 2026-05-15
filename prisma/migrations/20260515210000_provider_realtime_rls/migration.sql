-- Enable Row Level Security + add Realtime publication entries for the
-- tables the provider mobile app subscribes to via Supabase Realtime.
--
-- Notes:
--   * The API connects with the `postgres` role (Supabase pooler), which
--     bypasses RLS by default, so server-side writes through Prisma are
--     unaffected.
--   * `auth.uid()` is provided by Supabase Auth. The policies wrap it in
--     `(SELECT auth.uid())` so the planner caches the call per query
--     instead of evaluating it per row.
--   * `events` does NOT have RLS enabled — it's referenced from the
--     policy subqueries below but stays open (events are largely public).
--   * `provider_event_ticket_types`, `provider_activity_log`, and
--     `provider_members` are created via raw `ensure*Tables` DDL inside
--     `MeService` / `ProvidersService` rather than Prisma's model layer.
--     This migration assumes those tables already exist; if a fresh
--     environment hasn't booted the API yet, run the API once before
--     applying this migration so the ensure* helpers materialize them.

-- =====================================================================
-- 1. provider_members
-- =====================================================================
ALTER TABLE public.provider_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_members_select_self"
  ON public.provider_members;

CREATE POLICY "provider_members_select_self"
  ON public.provider_members
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND active = true);

-- =====================================================================
-- 2. provider_event_ticket_types
-- =====================================================================
ALTER TABLE public.provider_event_ticket_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_event_ticket_types_select_member"
  ON public.provider_event_ticket_types;

CREATE POLICY "provider_event_ticket_types_select_member"
  ON public.provider_event_ticket_types
  FOR SELECT
  TO authenticated
  USING (
    provider_id IN (
      SELECT pm.provider_id
      FROM public.provider_members pm
      WHERE pm.user_id = (SELECT auth.uid()) AND pm.active = true
    )
  );

-- =====================================================================
-- 3. provider_activity_log
-- =====================================================================
ALTER TABLE public.provider_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_activity_log_select_member"
  ON public.provider_activity_log;

CREATE POLICY "provider_activity_log_select_member"
  ON public.provider_activity_log
  FOR SELECT
  TO authenticated
  USING (
    provider_id IN (
      SELECT pm.provider_id
      FROM public.provider_members pm
      WHERE pm.user_id = (SELECT auth.uid()) AND pm.active = true
    )
  );

-- =====================================================================
-- 4. payment_orders
--    Provider members of the event's owning provider can see orders;
--    the buyer can also see their own orders.
-- =====================================================================
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_orders_select_buyer_or_provider"
  ON public.payment_orders;

CREATE POLICY "payment_orders_select_buyer_or_provider"
  ON public.payment_orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR event_id IN (
      SELECT e.id
      FROM public.events e
      WHERE e.provider_id IN (
        SELECT pm.provider_id
        FROM public.provider_members pm
        WHERE pm.user_id = (SELECT auth.uid()) AND pm.active = true
      )
    )
  );

-- =====================================================================
-- 5. tickets
--    Owner sees their tickets; provider members see tickets for their
--    own events.
-- =====================================================================
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tickets_select_owner_or_provider"
  ON public.tickets;

CREATE POLICY "tickets_select_owner_or_provider"
  ON public.tickets
  FOR SELECT
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR event_id IN (
      SELECT e.id
      FROM public.events e
      WHERE e.provider_id IN (
        SELECT pm.provider_id
        FROM public.provider_members pm
        WHERE pm.user_id = (SELECT auth.uid()) AND pm.active = true
      )
    )
  );

-- =====================================================================
-- 6. Add the 4 broadcast tables to the supabase_realtime publication.
--    Idempotent: only adds tables that aren't already in the publication.
--    `provider_members` is intentionally NOT broadcast — we only need
--    its SELECT for the policy joins above.
-- =====================================================================
DO $$
DECLARE
  target_table text;
  tables text[] := ARRAY[
    'provider_event_ticket_types',
    'provider_activity_log',
    'payment_orders',
    'tickets'
  ];
BEGIN
  -- Some environments (rare) ship without the publication. Create on demand.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH target_table IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        target_table
      );
    END IF;
  END LOOP;
END $$;
