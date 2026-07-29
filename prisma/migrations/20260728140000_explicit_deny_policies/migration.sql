-- Cosmetic fix for the Supabase database linter's `rls_enabled_no_policy`
-- INFO advisory: these tables already have RLS enabled with zero policies
-- (default-deny) as of 20260728120000_supabase_lint_security_fixes, which
-- is intentional — they're only ever accessed via this API's `postgres`
-- role (which bypasses RLS), not directly by client apps.
--
-- No functional change: an explicit `USING (false) WITH CHECK (false)`
-- policy denies exactly what the absence of any policy already denied.
-- This just documents the "no direct API access" intent in SQL so the
-- linter stops flagging it as maybe-unintentional, and so a future
-- reader doesn't mistake the empty policy list for an oversight.
--
-- `public.waitlist` is not tracked in this repo's migrations (managed
-- out-of-band in Supabase directly, same as `waitlist_by_source`), so
-- it's guarded on existence.

DO $migration$
DECLARE
  target_table text;
  tables text[] := ARRAY[
    '_prisma_migrations',
    'admin_audit_logs',
    'conversation_members',
    'conversation_reads',
    'conversations',
    'customer_referral_benefits',
    'customer_referral_claims',
    'customer_referral_codes',
    'customer_referral_events',
    'event_attendees',
    'event_interests',
    'event_media',
    'interests',
    'messages',
    'notifications',
    'payment_blocklist',
    'profile_interests',
    'profiles',
    'provider_brand_settings',
    'provider_discounts',
    'provider_follows',
    'provider_payout_requests',
    'provider_refund_policies',
    'provider_reviews',
    'provider_scan_records',
    'provider_subscription_orders',
    'providers',
    'push_outbox',
    'push_tokens',
    'refunds',
    'waitlist'
  ];
BEGIN
  FOREACH target_table IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = target_table
    ) THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        'deny_direct_access', target_table
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        'deny_direct_access', target_table
      );
    END IF;
  END LOOP;
END $migration$;
