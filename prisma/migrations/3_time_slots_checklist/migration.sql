-- Add time_slots column to rotation_policies
ALTER TABLE "rotation_policies" ADD COLUMN "time_slots" JSONB NOT NULL DEFAULT '[]';

-- Create shift_tasks table
CREATE TABLE "shift_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shift_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shift_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shift_tasks_shift_id_idx" ON "shift_tasks"("shift_id");

ALTER TABLE "shift_tasks" ADD CONSTRAINT "shift_tasks_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
