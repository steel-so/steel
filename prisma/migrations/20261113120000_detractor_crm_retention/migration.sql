-- CreateEnum
CREATE TYPE "CrmRetentionSource" AS ENUM ('SURVEY_DETRACTOR', 'HEALTH_DROP');

-- CreateTable
CREATE TABLE "crm_retention_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "on_detractor" BOOLEAN NOT NULL DEFAULT true,
    "on_health_drop" BOOLEAN NOT NULL DEFAULT true,
    "create_opportunity" BOOLEAN NOT NULL DEFAULT false,
    "task_due_days" INTEGER NOT NULL DEFAULT 2,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_retention_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_retention_actions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source" "CrmRetentionSource" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "task_id" TEXT,
    "opportunity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_retention_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_retention_settings_workspace_id_key" ON "crm_retention_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_retention_actions_workspace_id_created_at_idx" ON "crm_retention_actions"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_retention_actions_workspace_id_dedupe_key_key" ON "crm_retention_actions"("workspace_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "crm_retention_settings" ADD CONSTRAINT "crm_retention_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_retention_actions" ADD CONSTRAINT "crm_retention_actions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
