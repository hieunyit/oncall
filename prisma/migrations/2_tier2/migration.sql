-- Add AlertStatus and IntegrationType enums
CREATE TYPE "AlertStatus" AS ENUM ('FIRING', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "IntegrationType" AS ENUM ('GENERIC_WEBHOOK', 'PROMETHEUS', 'GRAFANA');

-- Create alert_integrations table
CREATE TABLE "alert_integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL DEFAULT 'GENERIC_WEBHOOK',
    "token" TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "alert_integrations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "alert_integrations"
    ADD CONSTRAINT "alert_integrations_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "alert_integrations_token_key" ON "alert_integrations"("token");
CREATE INDEX "alert_integrations_team_id_idx" ON "alert_integrations"("team_id");

-- Create alerts table
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "integration_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "severity" TEXT,
    "status" "AlertStatus" NOT NULL DEFAULT 'FIRING',
    "source_ref" TEXT,
    "payload_json" JSONB NOT NULL,
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "alert_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_acknowledged_by_fkey"
    FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON UPDATE CASCADE;

CREATE INDEX "alerts_integration_id_triggered_at_idx" ON "alerts"("integration_id", "triggered_at");
CREATE INDEX "alerts_status_idx" ON "alerts"("status");
