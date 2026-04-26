-- Fix: shift override self-referential FK blocked cascade deletion of shifts.
-- When a policy's shifts are cascade-deleted, override shifts that reference
-- other shifts in the same policy caused a RESTRICT violation mid-cascade.
-- Using SET NULL so override shifts become standalone when their original is deleted.
ALTER TABLE "shifts" DROP CONSTRAINT IF EXISTS "shifts_override_for_shift_id_fkey";
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_override_for_shift_id_fkey"
  FOREIGN KEY ("override_for_shift_id") REFERENCES "shifts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
