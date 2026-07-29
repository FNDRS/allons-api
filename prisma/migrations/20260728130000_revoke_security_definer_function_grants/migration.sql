-- Fixes for the Supabase database linter (security advisors):
--   * anon_security_definer_function_executable
--   * authenticated_security_definer_function_executable
--
-- Flagged functions: public.admin_audit_logs_reject_mutations(),
-- public.sync_payment_orders_broadcast(), public.repair_auth_users_token_nulls().
-- All three are SECURITY DEFINER, and Postgres grants EXECUTE to PUBLIC by
-- default on function creation — which anon/authenticated inherit — making
-- them callable via `/rest/v1/rpc/<fn>` even though none of them are meant
-- to be called that way:
--   * admin_audit_logs_reject_mutations / sync_payment_orders_broadcast are
--     trigger functions only. Revoking PUBLIC's EXECUTE doesn't affect the
--     triggers firing — trigger invocation runs under the function's
--     owner, not the row-inserting role, so this is a pure lockdown with
--     no functional change.
--   * repair_auth_users_token_nulls is service_role-only (called from
--     allons-admin). Its migration already revoked PUBLIC and granted
--     service_role; re-applied here defensively in case that hasn't
--     reached every environment yet (REVOKE on a privilege the role
--     doesn't hold is a no-op, so this is safe to re-run).
--
-- Not covered here: `auth_leaked_password_protection` is a project-level
-- Supabase Auth setting (Authentication -> Providers -> Password ->
-- "Leaked password protection" in the Dashboard), not a schema change —
-- this repo has no supabase/config.toml managing Auth config as code.

REVOKE ALL ON FUNCTION public.admin_audit_logs_reject_mutations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_audit_logs_reject_mutations() FROM anon;
REVOKE ALL ON FUNCTION public.admin_audit_logs_reject_mutations() FROM authenticated;

REVOKE ALL ON FUNCTION public.sync_payment_orders_broadcast() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_payment_orders_broadcast() FROM anon;
REVOKE ALL ON FUNCTION public.sync_payment_orders_broadcast() FROM authenticated;

REVOKE ALL ON FUNCTION public.repair_auth_users_token_nulls() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_auth_users_token_nulls() FROM anon;
REVOKE ALL ON FUNCTION public.repair_auth_users_token_nulls() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.repair_auth_users_token_nulls() TO service_role;
