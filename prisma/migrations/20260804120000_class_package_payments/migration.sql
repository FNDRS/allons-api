ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'event_ticket',
  ADD COLUMN IF NOT EXISTS class_program_id uuid REFERENCES class_programs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS class_package_id uuid REFERENCES class_packages(id) ON DELETE RESTRICT;

ALTER TABLE payment_orders_broadcast
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'event_ticket',
  ADD COLUMN IF NOT EXISTS class_program_id uuid REFERENCES class_programs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS class_package_id uuid REFERENCES class_packages(id) ON DELETE RESTRICT;

ALTER TABLE payment_orders
  ALTER COLUMN event_id DROP NOT NULL;

ALTER TABLE payment_orders_broadcast
  ALTER COLUMN event_id DROP NOT NULL;

ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_order_type_chk CHECK (order_type IN ('event_ticket', 'class_package'));

ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_shape_chk CHECK (
    (order_type = 'event_ticket'
      AND event_id IS NOT NULL
      AND class_program_id IS NULL
      AND class_package_id IS NULL)
    OR
    (order_type = 'class_package'
      AND event_id IS NULL
      AND entry_type_id IS NULL
      AND class_program_id IS NOT NULL
      AND class_package_id IS NOT NULL
      AND quantity = 1)
  );

ALTER TABLE payment_orders_broadcast
  ADD CONSTRAINT payment_orders_broadcast_order_type_chk CHECK (order_type IN ('event_ticket', 'class_package'));

ALTER TABLE payment_orders_broadcast
  ADD CONSTRAINT payment_orders_broadcast_shape_chk CHECK (
    (order_type = 'event_ticket'
      AND event_id IS NOT NULL
      AND class_program_id IS NULL
      AND class_package_id IS NULL)
    OR
    (order_type = 'class_package'
      AND event_id IS NULL
      AND entry_type_id IS NULL
      AND class_program_id IS NOT NULL
      AND class_package_id IS NOT NULL
      AND quantity = 1)
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
    order_type,
    event_id,
    entry_type_id,
    class_program_id,
    class_package_id,
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
    NEW.order_type,
    NEW.event_id,
    NEW.entry_type_id,
    NEW.class_program_id,
    NEW.class_package_id,
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
    order_type = EXCLUDED.order_type,
    event_id = EXCLUDED.event_id,
    entry_type_id = EXCLUDED.entry_type_id,
    class_program_id = EXCLUDED.class_program_id,
    class_package_id = EXCLUDED.class_package_id,
    quantity = EXCLUDED.quantity,
    amount_cents = EXCLUDED.amount_cents,
    currency = EXCLUDED.currency,
    status = EXCLUDED.status,
    expires_at = EXCLUDED.expires_at,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_payment_orders_broadcast() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_payment_orders_broadcast() FROM anon;
REVOKE ALL ON FUNCTION public.sync_payment_orders_broadcast() FROM authenticated;

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
    OR class_program_id IN (
      SELECT cp.id
      FROM public.class_programs cp
      WHERE cp.provider_id IN (
        SELECT pm.provider_id
        FROM public.provider_members pm
        WHERE pm.user_id = (SELECT auth.uid()) AND pm.active = true
      )
    )
  );

CREATE INDEX IF NOT EXISTS payment_orders_class_package_idx
  ON payment_orders(class_package_id);

CREATE INDEX IF NOT EXISTS payment_orders_class_program_idx
  ON payment_orders(class_program_id);

CREATE INDEX IF NOT EXISTS payment_orders_broadcast_class_package_idx
  ON payment_orders_broadcast(class_package_id);

CREATE INDEX IF NOT EXISTS payment_orders_broadcast_class_program_idx
  ON payment_orders_broadcast(class_program_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_class_passes_payment_order_uidx
  ON user_class_passes(payment_order_id)
  WHERE payment_order_id IS NOT NULL;
