-- CreateTable runbooks: knowledge base articles linked to teams
CREATE TABLE "runbooks" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id"        UUID NOT NULL,
    "title"          TEXT NOT NULL,
    "content"        TEXT NOT NULL DEFAULT '',
    "keywords"       TEXT[] NOT NULL DEFAULT '{}',
    "is_active"      BOOLEAN NOT NULL DEFAULT true,
    "created_by_id"  UUID NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "runbooks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "runbooks_team_id_idx" ON "runbooks"("team_id");

ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON UPDATE CASCADE;
