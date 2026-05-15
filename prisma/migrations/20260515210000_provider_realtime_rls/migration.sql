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
--   * Provider-side `ensure*Tables` DDL is mirrored below with
--     `CREATE TABLE IF NOT EXISTS` so `migrate deploy` succeeds on a cold
--     DB without booting the API first.
--   * Realtime uses `payment_orders_broadcast` (sanitized columns only),
--     not `payment_orders`, so paygate identifiers / raw webhook payloads
--     never leave Postgres over the replication stream to Realtime clients.

-- =====================================================================
-- 0. Materialize lazy-created tables (subset of ProvidersService / MeService)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.provider_members (
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, user_id)
);

CREATE INDEX IF NOT EXISTS provider_members_user_idx
  ON public.provider_members(user_id);

ALTER TABLE public.provider_members
  ADD COLUMN IF NOT EXISTS full_name text;

ALTER TABLE public.provider_members
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.provider_members
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.provider_members
  ADD COLUMN IF NOT EXISTS avatar_color text;

CREATE TABLE IF NOT EXISTS public.provider_event_ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'general',
  price numeric(12, 2) NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  sold_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_event_ticket_types_event_idx
  ON public.provider_event_ticket_types(event_id);

CREATE TABLE IF NOT EXISTS public.provider_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  meta text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_activity_log_provider_idx
  ON public.provider_activity_log(provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ticket_holders (
  ticket_id uuid PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  holder_name text NOT NULL,
  holder_email text NOT NULL,
  holder_user_id uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_holders
  ADD COLUMN IF NOT EXISTS holder_user_id uuid;

ALTER TABLE public.ticket_holders
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- =====================================================================
-- 0b. Sanitized payment-order feed for Realtime (no gateway secrets)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.payment_orders_broadcast (
  id uuid PRIMARY KEY REFERENCES public.payment_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  entry_type_id uuid,
  quantity integer NOT NULL DEFAULT 1,
  amount_cents integer NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'HNL',
  status payment_order_status NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION public.sync_payment_orders_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payment_orders_broadcast AS b (
    id,
    user_id,
    event_id,
    entry_type_id,
    quantity,
    amount_cents,
    currency,
    status,
    expires_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.user_id,
    NEW.event_id,
    NEW.entry_type_id,
    NEW.quantity,
    NEW.amount_cents,
    NEW.currency,
    NEW.status,
    NEW.expires_at,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    event_id = EXCLUDED.event_id,
    entry_type_id = EXCLUDED.entry_type_id,
    quantity = EXCLUDED.quantity,
    amount_cents = EXCLUDED.amount_cents,
    currency = EXCLUDED.currency,
    status = EXCLUDED.status,
    expires_at = EXCLUDED.expires_at,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_orders_broadcast_sync ON public.payment_orders;

CREATE TRIGGER payment_orders_broadcast_sync
  AFTER INSERT OR UPDATE ON public.payment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_payment_orders_broadcast();

INSERT INTO public.payment_orders_broadcast (
  id,
  user_id,
  event_id,
  entry_type_id,
  quantity,
  amount_cents,
  currency,
  status,
  expires_at,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  event_id,
  entry_type_id,
  quantity,
  amount_cents,
  currency,
  status,
  expires_at,
  created_at,
  updated_at
FROM public.payment_orders
ON CONFLICT (id) DO NOTHING;

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
-- 4b. payment_orders_broadcast (same SELECT semantics, safe columns only)
-- =====================================================================
ALTER TABLE public.payment_orders_broadcast ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_orders_broadcast_select_buyer_or_provider"
  ON public.payment_orders_broadcast;

CREATE POLICY "payment_orders_broadcast_select_buyer_or_provider"
  ON public.payment_orders_broadcast
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

REVOKE INSERT, UPDATE, DELETE ON public.payment_orders_broadcast FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_orders_broadcast FROM anon;

-- =====================================================================
-- 5. tickets
--    Owner, assigned holder (ticket_holders), or provider members for the event.
-- =====================================================================
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tickets_select_owner_or_provider"
  ON public.tickets;

DROP POLICY IF EXISTS "tickets_select_owner_holder_or_provider"
  ON public.tickets;

CREATE POLICY "tickets_select_owner_holder_or_provider"
  ON public.tickets
  FOR SELECT
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.ticket_holders th
      WHERE th.ticket_id = tickets.id
        AND th.holder_user_id = (SELECT auth.uid())
    )
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
-- 6. Add broadcast tables to the supabase_realtime publication.
--    Idempotent: only adds tables that aren't already in the publication.
--    `provider_members` is intentionally NOT broadcast — we only need
--    its SELECT for the policy joins above.
--    Uses payment_orders_broadcast (sanitized); payment_orders is NOT published.
-- =====================================================================
DO $migration$
DECLARE
  target_table text;
  tables text[] := ARRAY[
    'provider_event_ticket_types',
    'provider_activity_log',
    'payment_orders_broadcast',
    'tickets'
  ];
BEGIN
  -- Some environments (rare) ship without the publication. Create on demand.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  -- Drop legacy unsafe publication target if an older revision added it.
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'payment_orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.payment_orders';
  END IF;

  FOREACH target_table IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = target_table
    )
       AND NOT EXISTS (
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
END $migration$;
