-- Prorated upgrades keep the current term end; activation reads this column.
ALTER TABLE "provider_subscription_orders" ADD COLUMN "period_end" TIMESTAMPTZ(6);
