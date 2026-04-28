-- Add secure Telegram link token fields to users table
-- These allow users to link their Telegram account via a time-limited deep link
-- instead of exposing their userId directly.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_link_token" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_link_token_exp" TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_link_token_key"
  ON "users"("telegram_link_token");
