-- Append-only audit log for privileged actions originating from **allons-admin**
-- (and any future callers using the same table). Rows are immutable at app layer
-- thanks to Postgres trigger below.

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    actor_user_id UUID,
    actor_email TEXT,

    source TEXT NOT NULL,
    action TEXT NOT NULL,

    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,

    outcome TEXT NOT NULL,

    http_method TEXT,
    http_path TEXT,

    ip_address TEXT,
    user_agent TEXT,

    correlation_id UUID,
    client_request_id TEXT,

    error_code TEXT,
    error_message TEXT,

    state_before JSONB NOT NULL DEFAULT '{}'::jsonb,
    state_after JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id),
    CONSTRAINT admin_audit_logs_outcome_check CHECK (
        outcome = ANY (ARRAY['success'::text, 'failure'::text])
    ),
    CONSTRAINT admin_audit_logs_action_nonempty CHECK (LENGTH(TRIM(action)) > 0),
    CONSTRAINT admin_audit_logs_resource_type_nonempty CHECK (LENGTH(TRIM(resource_type)) > 0),
    CONSTRAINT admin_audit_logs_resource_id_nonempty CHECK (LENGTH(TRIM(resource_id)) > 0)
);

COMMENT ON TABLE public.admin_audit_logs IS
    'Privileged admin actions (immutable via trigger); inserted by trusted server code after root gate.';
COMMENT ON COLUMN public.admin_audit_logs.source IS
    'eg. server_action | route_handler';
COMMENT ON COLUMN public.admin_audit_logs.action IS
    'Stable taxonomy: area.operation (auth.user_suspend, event.status_patch, ...)';

CREATE INDEX IF NOT EXISTS admin_audit_logs_occurred_at_idx
    ON public.admin_audit_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_resource_idx
    ON public.admin_audit_logs (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_user_id_idx
    ON public.admin_audit_logs (actor_user_id);

CREATE INDEX IF NOT EXISTS admin_audit_logs_action_idx
    ON public.admin_audit_logs (action);

CREATE OR REPLACE FUNCTION public.admin_audit_logs_reject_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_logs is append-only: % not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_audit_logs_no_update_delete ON public.admin_audit_logs;

CREATE TRIGGER trg_admin_audit_logs_no_update_delete
    BEFORE UPDATE OR DELETE ON public.admin_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.admin_audit_logs_reject_mutations();

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Same pattern as waitlist_qr_sources: no permissive consumer policies —
-- anon/authenticated do not SELECT/INSERT via PostgREST. Server uses service_role
-- after enforcing root admin session in Next.js.
