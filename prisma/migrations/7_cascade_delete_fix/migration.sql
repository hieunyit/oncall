-- Fix cascade delete chain so that deleting a Team removes all dependent data cleanly.
--
-- Before: RotationPolicy cascades from Team, but Shift and ScheduleBatch only had
--         ON UPDATE CASCADE (no ON DELETE clause), so PostgreSQL would RESTRICT the delete.
--         SwapRequest also had no delete rule on originalShiftId.
--
-- After:  Full cascade chain: Team → RotationPolicy → ScheduleBatch → Shift → SwapRequest

-- 1. ScheduleBatch must cascade when its RotationPolicy is deleted
ALTER TABLE "schedule_batches" DROP CONSTRAINT IF EXISTS "schedule_batches_policy_id_fkey";
ALTER TABLE "schedule_batches" ADD CONSTRAINT "schedule_batches_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "rotation_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Shift must cascade when its RotationPolicy is deleted
ALTER TABLE "shifts" DROP CONSTRAINT IF EXISTS "shifts_policy_id_fkey";
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "rotation_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. SwapRequest must cascade when the original Shift is deleted
ALTER TABLE "swap_requests" DROP CONSTRAINT IF EXISTS "swap_requests_original_shift_id_fkey";
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_original_shift_id_fkey"
  FOREIGN KEY ("original_shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. SwapRequest targetShift: cascade when the target shift is deleted (swap is invalid anyway)
ALTER TABLE "swap_requests" DROP CONSTRAINT IF EXISTS "swap_requests_target_shift_id_fkey";
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_target_shift_id_fkey"
  FOREIGN KEY ("target_shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
