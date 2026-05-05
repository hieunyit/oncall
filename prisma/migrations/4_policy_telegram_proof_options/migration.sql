ALTER TABLE rotation_policies
ADD COLUMN IF NOT EXISTS telegram_require_photo_on_confirm BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE rotation_policies
ADD COLUMN IF NOT EXISTS telegram_end_shift_reminder_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE rotation_policies
ADD COLUMN IF NOT EXISTS telegram_require_photo_on_checkout BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE rotation_policies
ADD COLUMN IF NOT EXISTS telegram_manager_import_error_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS shift_verification_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES rotation_policies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('CHECK_IN', 'CHECK_OUT')),
  source TEXT NOT NULL DEFAULT 'TELEGRAM',
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  telegram_file_id TEXT,
  telegram_message_id BIGINT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_verification_photos_shift_kind
  ON shift_verification_photos (shift_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_verification_photos_user_created
  ON shift_verification_photos (user_id, created_at DESC);
