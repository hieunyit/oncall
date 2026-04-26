-- Clean up shifts and related rows that were orphaned when teams/policies
-- were deleted before cascade rules were in place (migrations 7-10).
DELETE FROM shift_tasks       WHERE shift_id IN (SELECT id FROM shifts WHERE policy_id NOT IN (SELECT id FROM rotation_policies));
DELETE FROM shift_confirmations WHERE shift_id IN (SELECT id FROM shifts WHERE policy_id NOT IN (SELECT id FROM rotation_policies));
DELETE FROM swap_requests     WHERE original_shift_id IN (SELECT id FROM shifts WHERE policy_id NOT IN (SELECT id FROM rotation_policies))
                                 OR target_shift_id   IN (SELECT id FROM shifts WHERE policy_id NOT IN (SELECT id FROM rotation_policies));
DELETE FROM shifts            WHERE policy_id NOT IN (SELECT id FROM rotation_policies);
DELETE FROM schedule_batches  WHERE policy_id NOT IN (SELECT id FROM rotation_policies);
