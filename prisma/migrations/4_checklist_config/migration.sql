ALTER TABLE "rotation_policies" ADD COLUMN "checklist_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rotation_policies" ADD COLUMN "template_tasks" JSONB NOT NULL DEFAULT '[]';
