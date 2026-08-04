ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'event_ticket',
  ADD COLUMN IF NOT EXISTS class_program_id uuid REFERENCES class_programs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS class_package_id uuid REFERENCES class_packages(id) ON DELETE RESTRICT;

ALTER TABLE payment_orders
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

CREATE INDEX IF NOT EXISTS payment_orders_class_package_idx
  ON payment_orders(class_package_id);

CREATE INDEX IF NOT EXISTS payment_orders_class_program_idx
  ON payment_orders(class_program_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_class_passes_payment_order_uidx
  ON user_class_passes(payment_order_id)
  WHERE payment_order_id IS NOT NULL;
