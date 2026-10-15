-- AlterEnum
ALTER TYPE "CrmWidgetType" ADD VALUE 'SALES';

-- AlterTable
ALTER TABLE "crm_dashboard_widgets" ADD COLUMN     "page" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "crm_dashboards" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "crm_opportunities" ADD COLUMN     "won_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "crm_dashboard_tv_links" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "dashboard_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_dashboard_tv_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_dashboard_tv_links_token_key" ON "crm_dashboard_tv_links"("token");

-- CreateIndex
CREATE INDEX "crm_dashboard_tv_links_workspace_id_idx" ON "crm_dashboard_tv_links"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_dashboard_tv_links_dashboard_id_idx" ON "crm_dashboard_tv_links"("dashboard_id");

-- CreateIndex
CREATE INDEX "crm_opportunities_workspace_id_won_at_idx" ON "crm_opportunities"("workspace_id", "won_at");

-- AddForeignKey
ALTER TABLE "crm_dashboard_tv_links" ADD CONSTRAINT "crm_dashboard_tv_links_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "crm_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: deals already in a WON stage count as won on their close date
-- (or, without one, on their last update). New wins stamp `won_at` when the
-- deal enters a WON stage.
UPDATE "crm_opportunities" AS o
SET "won_at" = COALESCE(o."close_date", o."updated_at")
FROM "crm_pipeline_stages" AS s
WHERE s."id" = o."stage_id" AND s."category" = 'WON' AND o."won_at" IS NULL;
