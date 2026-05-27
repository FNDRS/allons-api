-- Provider annual subscription purchase orders (Paygate). Separate from
-- payment_orders (ticket purchases) so the live ticket flow is untouched.
CREATE TABLE "provider_subscription_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HNL',
    "status" "payment_order_status" NOT NULL DEFAULT 'pending_payment',
    "paygate_link_id" TEXT,
    "paygate_payment_id" TEXT,
    "paygate_raw_webhook" JSONB,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_subscription_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_subscription_orders_paygate_link_id_key" ON "provider_subscription_orders"("paygate_link_id");
CREATE UNIQUE INDEX "provider_subscription_orders_paygate_payment_id_key" ON "provider_subscription_orders"("paygate_payment_id");
CREATE INDEX "provider_subscription_orders_provider_id_idx" ON "provider_subscription_orders"("provider_id");
CREATE INDEX "provider_subscription_orders_user_id_idx" ON "provider_subscription_orders"("user_id");
CREATE INDEX "provider_subscription_orders_status_idx" ON "provider_subscription_orders"("status");
