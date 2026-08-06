-- Attendance for class sessions: a scannable code per reservation, plus who
-- checked it in and when.
--
-- Until now a booked class had nothing to present at the door. Event tickets
-- carry an `ALL-XXXXXX` code and a signed QR; reservations carried neither, so
-- a comercio had no way to confirm the person in front of them holds the spot.
--
-- The code uses a `CLS-` prefix rather than reusing `ALL-`. Staff manual entry
-- resolves a typed code to a row, and with one shared prefix the same string
-- could plausibly name a ticket or a reservation — two tables, two lookups, and
-- an ambiguous answer when both matched. The prefix makes the kind explicit.
--
-- Idempotent: safe to re-run.

ALTER TABLE class_session_reservations
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_by uuid;

-- Two reservations must never share a code: the scanner resolves a typed code
-- to exactly one row, and a duplicate would make check-in ambiguous.
-- Partial, because a row could momentarily exist without one.
CREATE UNIQUE INDEX IF NOT EXISTS class_session_reservations_code_uidx
  ON class_session_reservations (code)
  WHERE code IS NOT NULL;

-- Backfill existing reservations, one row at a time with a retry.
--
-- A single bulk UPDATE with a 6-character hash would have been shorter, but
-- 16^6 is small enough that two rows can hash to the same code, and the unique
-- index above would then abort the whole migration. Retrying per row makes the
-- outcome independent of how many rows exist when this runs.
--
-- Hex rather than the unambiguous alphabet new codes draw from: these are
-- generated here in bulk, and being exact matters more than being easy to
-- dictate. Same choice the ticket-code backfill made.
DO $$
DECLARE
  target uuid;
  candidate text;
  attempts int;
BEGIN
  FOR target IN
    SELECT id FROM class_session_reservations WHERE code IS NULL
  LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      candidate := 'CLS-' || upper(substr(
        md5(target::text || clock_timestamp()::text || attempts::text), 1, 6));
      BEGIN
        UPDATE class_session_reservations SET code = candidate WHERE id = target;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF attempts >= 20 THEN
          RAISE EXCEPTION 'could not allocate a unique code for reservation %', target;
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- The scanner looks a reservation up by code on every scan.
CREATE INDEX IF NOT EXISTS class_session_reservations_checkin_idx
  ON class_session_reservations (provider_id, session_date)
  WHERE checked_in_at IS NULL;
