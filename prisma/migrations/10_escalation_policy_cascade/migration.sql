-- Fix: rotation_policies.escalation_policy_id FK had no ON DELETE rule (defaulted to RESTRICT).
-- When a Team is deleted, PostgreSQL cascades to both RotationPolicy and EscalationPolicy.
-- If EscalationPolicy is deleted first while RotationPolicy still references it, RESTRICT fires.
-- Using SET NULL so the reference is cleared before EscalationPolicy row is removed.
ALTER TABLE "rotation_policies" DROP CONSTRAINT IF EXISTS "rotation_policies_escalation_policy_id_fkey";
ALTER TABLE "rotation_policies" ADD CONSTRAINT "rotation_policies_escalation_policy_id_fkey"
  FOREIGN KEY ("escalation_policy_id") REFERENCES "escalation_policies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
