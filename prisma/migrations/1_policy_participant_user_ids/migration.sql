-- Add selected participants per rotation policy (optional subset of team members)
ALTER TABLE "rotation_policies"
ADD COLUMN IF NOT EXISTS "participant_user_ids" JSONB NOT NULL DEFAULT '[]';
