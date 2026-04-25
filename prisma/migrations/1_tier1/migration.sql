-- Add NotificationUrgency enum
CREATE TYPE "NotificationUrgency" AS ENUM ('DEFAULT', 'IMPORTANT');

-- Add phone to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- Add override_for_shift_id to shifts
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "override_for_shift_id" UUID;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_override_for_shift_id_fkey"
  FOREIGN KEY ("override_for_shift_id") REFERENCES "shifts"("id") ON UPDATE CASCADE;

-- Create escalation_policies table
CREATE TABLE "escalation_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "escalation_policies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rename escalation_rules.policy_id -> escalation_policy_id and add FK
ALTER TABLE "escalation_rules" RENAME COLUMN "policy_id" TO "escalation_policy_id";
ALTER TABLE "escalation_rules" DROP CONSTRAINT IF EXISTS "escalation_rules_policy_id_step_order_key";
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_escalation_policy_id_step_order_key"
  UNIQUE ("escalation_policy_id", "step_order");
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_escalation_policy_id_fkey"
  FOREIGN KEY ("escalation_policy_id") REFERENCES "escalation_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add escalation_policy_id to rotation_policies
ALTER TABLE "rotation_policies" ADD COLUMN IF NOT EXISTS "escalation_policy_id" UUID;
ALTER TABLE "rotation_policies" ADD CONSTRAINT "rotation_policies_escalation_policy_id_fkey"
  FOREIGN KEY ("escalation_policy_id") REFERENCES "escalation_policies"("id") ON UPDATE CASCADE;

-- Create user_notification_rules table
CREATE TABLE "user_notification_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "urgency" "NotificationUrgency" NOT NULL DEFAULT 'DEFAULT',
    "step_order" INTEGER NOT NULL,
    "channel_type" "ChannelType" NOT NULL,
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "user_notification_rules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "user_notification_rules" ADD CONSTRAINT "user_notification_rules_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "user_notification_rules_user_id_urgency_step_order_key"
  ON "user_notification_rules"("user_id", "urgency", "step_order");

CREATE INDEX "escalation_policies_team_id_idx" ON "escalation_policies"("team_id");
CREATE INDEX "user_notification_rules_user_id_idx" ON "user_notification_rules"("user_id");
