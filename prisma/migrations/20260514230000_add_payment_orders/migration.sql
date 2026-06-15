-- CreateEnum
CREATE TYPE "payment_order_status" AS ENUM ('pending_payment', 'paid', 'failed', 'cancelled', 'refunded');

-- AlterTable
DO $migration$
BEGIN
  IF to_regclass('public.tickets') IS NOT NULL THEN
    ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "payment_order_id" UUID;
  END IF;
END
$migration$;

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "entry_type_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HNL',
    "status" "payment_order_status" NOT NULL DEFAULT 'pending_payment',
    "paygate_link_id" TEXT,
    "paygate_payment_id" TEXT,
    "paygate_raw_webhook" JSONB,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_paygate_link_id_key" ON "payment_orders"("paygate_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_paygate_payment_id_key" ON "payment_orders"("paygate_payment_id");

-- CreateIndex
CREATE INDEX "payment_orders_user_id_idx" ON "payment_orders"("user_id");

-- CreateIndex
CREATE INDEX "payment_orders_event_id_idx" ON "payment_orders"("event_id");

-- CreateIndex
CREATE INDEX "payment_orders_status_idx" ON "payment_orders"("status");

-- CreateIndex
DO $migration$
BEGIN
  IF to_regclass('public.tickets') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "tickets_payment_order_id_idx" ON "tickets"("payment_order_id");
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF to_regclass('public.tickets') IS NOT NULL THEN
    ALTER TABLE "tickets"
      ADD CONSTRAINT "tickets_payment_order_id_fkey"
      FOREIGN KEY ("payment_order_id")
      REFERENCES "payment_orders"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE "payment_orders"
      ADD CONSTRAINT "payment_orders_user_id_fkey"
      FOREIGN KEY ("user_id")
      REFERENCES "profiles"("user_id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF to_regclass('public.events') IS NOT NULL THEN
    ALTER TABLE "payment_orders"
      ADD CONSTRAINT "payment_orders_event_id_fkey"
      FOREIGN KEY ("event_id")
      REFERENCES "events"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
$migration$;

