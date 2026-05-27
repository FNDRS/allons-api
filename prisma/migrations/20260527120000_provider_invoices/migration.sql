-- Manual subscription invoices issued by Allons admins.
CREATE TABLE "provider_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_number" TEXT NOT NULL,
    "provider_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" TEXT NOT NULL,
    "billing_interval" TEXT NOT NULL DEFAULT 'annual',
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HNL',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "prorated" BOOLEAN NOT NULL DEFAULT false,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_invoices_invoice_number_key" ON "provider_invoices"("invoice_number");
CREATE INDEX "provider_invoices_provider_id_idx" ON "provider_invoices"("provider_id");
CREATE INDEX "provider_invoices_status_idx" ON "provider_invoices"("status");
