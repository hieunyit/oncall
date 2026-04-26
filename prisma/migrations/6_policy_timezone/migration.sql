-- Migration 6: Add timezone to rotation_policies
ALTER TABLE "rotation_policies"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
