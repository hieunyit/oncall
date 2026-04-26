-- Make target_user_id optional to support open swap requests (Grafana-style)
-- Open swaps have targetUserId = NULL and can be taken by any eligible team member
ALTER TABLE "swap_requests" ALTER COLUMN "target_user_id" DROP NOT NULL;
