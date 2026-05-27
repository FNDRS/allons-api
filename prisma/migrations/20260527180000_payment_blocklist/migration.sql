-- Deny-list for payment fraud (checked at initiate). By email and/or user_id.
CREATE TABLE "payment_blocklist" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT,
  "user_id" UUID,
  "reason" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_blocklist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_blocklist_email_idx" ON "payment_blocklist" (lower("email"));
CREATE INDEX "payment_blocklist_user_id_idx" ON "payment_blocklist" ("user_id");
