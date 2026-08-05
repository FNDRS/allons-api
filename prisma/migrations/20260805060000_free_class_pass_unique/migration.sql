-- One free claim per user per package, enforced by the database.
--
-- `POST /me/class-packages/:packageId/claim` checked for an existing pass and
-- then inserted, which two concurrent requests could both pass before either
-- wrote, minting several free passes for a package meant to be claimable once.
-- The existing `user_class_passes_payment_order_uidx` only guards non-null
-- `payment_order_id`, so it does not cover a claimed pass.
--
-- Scoped to `payment_order_id IS NULL` on purpose: buying the same package
-- twice is legitimate and must keep creating separate passes. Only claims are
-- capped at one.
CREATE UNIQUE INDEX IF NOT EXISTS user_class_passes_free_claim_uidx
  ON user_class_passes (user_id, package_id)
  WHERE payment_order_id IS NULL AND package_id IS NOT NULL;
