-- Fixes for the Supabase database linter (security advisors):
--   * security_definer_view  -> public.waitlist_by_source
--   * rls_disabled_in_public -> 30 public tables (see list below)
--   * sensitive_columns_exposed -> public.push_tokens.token
--
-- Notes:
--   * The API connects with the `postgres` role (Supabase pooler), which
--     bypasses RLS by default, so server-side reads/writes through Prisma
--     are unaffected by anything in this migration.
--   * None of the tables below are added to the `supabase_realtime`
--     publication and none are queried directly by client apps via
--     supabase-js/PostgREST (confirmed by grep across src/) — access is
--     always mediated by this API. So for most tables the correct fix is
--     "enable RLS, add no policies" (default-deny for `anon`/`authenticated`,
--     matching how they're actually used today).
--   * Two exceptions need real SELECT policies because the existing
--     `provider_realtime_rls` migration's policies subquery them while
--     evaluating RLS as the `authenticated` role (Realtime/PostgREST
--     access to `tickets` / `payment_orders` / `payment_orders_broadcast`):
--       - `events` (subquery target) -> public read policy, matching the
--         prior "events are largely public, left open" behavior.
--       - `ticket_holders` (EXISTS subquery target) -> holder can read
--         their own row, matching the existing "holder can see their
--         ticket" behavior.
--   * `public.waitlist_by_source` is not created anywhere in this repo's
--     migration history (managed out-of-band in Supabase directly), so we
--     can't recreate its definition here. We only flip the
--     `security_invoker` reloption, which doesn't require the view body.
--
-- Several tables below (customer_referral_*, provider_follows,
-- provider_refund_policies, provider_brand_settings, provider_discounts,
-- provider_payout_requests, provider_scan_records, conversation_reads) are
-- created lazily at runtime via `ensure*Table()` helpers in the relevant
-- services rather than tracked by a dedicated migration. They're mirrored
-- here with `CREATE TABLE IF NOT EXISTS` (same shape as those helpers) so
-- `prisma migrate deploy` succeeds on a cold DB, per the precedent set in
-- 20260515210000_provider_realtime_rls.

-- =====================================================================
-- 0. Materialize lazily-created tables so ENABLE ROW LEVEL SECURITY
--    below doesn't fail on a cold DB.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.conversation_reads (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.provider_follows (
  user_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider_id)
);

CREATE TABLE IF NOT EXISTS public.provider_refund_policies (
  provider_id uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  refund_enabled boolean NOT NULL DEFAULT false,
  refund_deadline_hours integer NOT NULL DEFAULT 24,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_brand_settings (
  provider_id uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  logo_color text NOT NULL DEFAULT '#F67010',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  code text NOT NULL,
  percent integer NOT NULL,
  max_uses integer NOT NULL DEFAULT 0,
  uses integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  method text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_scan_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_id uuid,
  ticket_code text NOT NULL,
  attendee_name text,
  ticket_type text,
  scanned_by uuid NOT NULL,
  status text NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_referral_codes (
  owner_user_id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_referral_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id uuid NOT NULL UNIQUE,
  referrer_user_id uuid NOT NULL,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  captured_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  invalid_reason text
);

CREATE TABLE IF NOT EXISTS public.customer_referral_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL UNIQUE,
  referred_user_id uuid NOT NULL UNIQUE,
  discount_type text NOT NULL,
  discount_value integer NOT NULL,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_name text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 1. security_definer_view: public.waitlist_by_source
--    Not tracked in this repo's migrations, so guard on existence and
--    only flip the reloption (no view body needed).
-- =====================================================================
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'waitlist_by_source'
  ) THEN
    EXECUTE 'ALTER VIEW public.waitlist_by_source SET (security_invoker = on)';
  END IF;
END $migration$;

-- =====================================================================
-- 2. rls_disabled_in_public: enable RLS on every flagged table.
--    Default-deny (no policies) unless noted otherwise in section 3 —
--    safe because access is always mediated by the API's `postgres`
--    role, which bypasses RLS.
-- =====================================================================
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_referral_benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_referral_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_referral_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_refund_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_brand_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_scan_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_blocklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_subscription_orders ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 3. Policies required to keep existing RLS chains working now that
--    their subquery targets have RLS enabled too.
-- =====================================================================

-- `events` is subquery'd by the `tickets` and `payment_orders`/
-- `payment_orders_broadcast` SELECT policies (provider_realtime_rls
-- migration) while evaluated as `authenticated`. Events were previously
-- left fully open ("largely public"); keep that behavior explicit.
DROP POLICY IF EXISTS "events_select_public" ON public.events;

CREATE POLICY "events_select_public"
  ON public.events
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- `ticket_holders` is subquery'd (EXISTS) by the `tickets` SELECT policy
-- so a ticket's assigned holder can see it. Mirror that same access here.
DROP POLICY IF EXISTS "ticket_holders_select_self" ON public.ticket_holders;

CREATE POLICY "ticket_holders_select_self"
  ON public.ticket_holders
  FOR SELECT
  TO authenticated
  USING (holder_user_id = (SELECT auth.uid()));
