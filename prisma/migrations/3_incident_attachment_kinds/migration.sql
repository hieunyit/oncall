-- Extend incident attachment kinds for report uploads
DO $$
BEGIN
  ALTER TYPE "IncidentAttachmentKind" ADD VALUE IF NOT EXISTS 'PDF';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "IncidentAttachmentKind" ADD VALUE IF NOT EXISTS 'WORD';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "IncidentAttachmentKind" ADD VALUE IF NOT EXISTS 'TEXT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
