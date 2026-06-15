-- Tax-inclusive breakdown (ISV) for subscription orders: base + tax = amount.
ALTER TABLE "provider_subscription_orders" ADD COLUMN "base_cents" INTEGER;
ALTER TABLE "provider_subscription_orders" ADD COLUMN "tax_cents" INTEGER;
