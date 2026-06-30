-- Human-friendly access code for tickets (shown to holders, accepted by the
-- scanner's manual-entry fallback). Added nullable, backfilled with a unique
-- `ALL-XXXXXX` per existing row, then locked to NOT NULL + UNIQUE.
ALTER TABLE "tickets" ADD COLUMN "code" TEXT;

DO $$
DECLARE
  r RECORD;
  new_code TEXT;
  alphabet TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
BEGIN
  FOR r IN SELECT id FROM tickets WHERE code IS NULL LOOP
    LOOP
      new_code := 'ALL-' || (
        SELECT string_agg(
          substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1),
          ''
        )
        FROM generate_series(1, 6)
      );
      EXIT WHEN NOT EXISTS (SELECT 1 FROM tickets WHERE code = new_code);
    END LOOP;
    UPDATE tickets SET code = new_code WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "tickets" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");
