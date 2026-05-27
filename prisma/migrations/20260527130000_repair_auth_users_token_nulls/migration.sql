-- GoTrue auth.admin.listUsers fails when token columns are NULL instead of ''.
-- Rows inserted outside invite/createUser (manual SQL, bad imports) can leave NULLs.
-- Callable from allons-admin before listing users (service_role only).

CREATE OR REPLACE FUNCTION public.repair_auth_users_token_nulls()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  WITH updated AS (
    UPDATE auth.users SET
      confirmation_token = COALESCE(confirmation_token, ''),
      recovery_token = COALESCE(recovery_token, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      email_change = COALESCE(email_change, ''),
      phone_change = COALESCE(phone_change, ''),
      phone_change_token = COALESCE(phone_change_token, ''),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      reauthentication_token = COALESCE(reauthentication_token, '')
    WHERE confirmation_token IS NULL
       OR recovery_token IS NULL
       OR email_change_token_new IS NULL
       OR email_change IS NULL
       OR phone_change IS NULL
       OR phone_change_token IS NULL
       OR email_change_token_current IS NULL
       OR reauthentication_token IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION public.repair_auth_users_token_nulls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_auth_users_token_nulls() TO service_role;
