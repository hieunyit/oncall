-- Incident lifecycle + attachment support

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IncidentSeverity') THEN
    CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IncidentStatus') THEN
    CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IncidentAttachmentKind') THEN
    CREATE TYPE "IncidentAttachmentKind" AS ENUM ('IMAGE', 'EXCEL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "policy_id" uuid REFERENCES "rotation_policies"("id") ON DELETE SET NULL,
  "shift_id" uuid REFERENCES "shifts"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "description" text,
  "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
  "occurred_at" timestamptz NOT NULL,
  "resolved_at" timestamptz,
  "created_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "assignee_id" uuid REFERENCES "users"("id"),
  "impact_summary" text,
  "root_cause" text,
  "action_items" text,
  "metadata_json" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "incident_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "incident_id" uuid NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "storage_path" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" int NOT NULL,
  "kind" "IncidentAttachmentKind" NOT NULL,
  "uploaded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "incident_lifecycle_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "incident_id" uuid NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
  "from_status" "IncidentStatus",
  "to_status" "IncidentStatus" NOT NULL,
  "note" text,
  "changed_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "incidents_team_id_occurred_at_idx"
  ON "incidents"("team_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "incidents_status_severity_idx"
  ON "incidents"("status", "severity");
CREATE INDEX IF NOT EXISTS "incidents_policy_id_idx"
  ON "incidents"("policy_id");
CREATE INDEX IF NOT EXISTS "incidents_shift_id_idx"
  ON "incidents"("shift_id");
CREATE INDEX IF NOT EXISTS "incident_attachments_incident_id_idx"
  ON "incident_attachments"("incident_id");
CREATE INDEX IF NOT EXISTS "incident_lifecycle_events_incident_id_created_at_idx"
  ON "incident_lifecycle_events"("incident_id", "created_at");

CREATE OR REPLACE FUNCTION set_incidents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_incidents_updated_at ON "incidents";
CREATE TRIGGER trg_incidents_updated_at
BEFORE UPDATE ON "incidents"
FOR EACH ROW
EXECUTE FUNCTION set_incidents_updated_at();
