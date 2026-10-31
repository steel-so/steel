-- CreateEnum
CREATE TYPE "SdStatusComponentState" AS ENUM ('OPERATIONAL', 'DEGRADED', 'OUTAGE');

-- AlterTable
ALTER TABLE "sd_monitor_alerts" ADD COLUMN     "suppressed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sd_monitor_sources" ADD COLUMN     "raise_priority_on_correlation" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "sd_status_components" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service_id" TEXT,
    "state" "SdStatusComponentState" NOT NULL DEFAULT 'OPERATIONAL',
    "position" INTEGER NOT NULL DEFAULT 0,
    "state_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_status_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_status_maintenances" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "suppress_monitoring" BOOLEAN NOT NULL DEFAULT false,
    "config_item_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notify_subscribers" BOOLEAN NOT NULL DEFAULT true,
    "announced_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "canceled_notice_at" TIMESTAMP(3),
    "notify_total" INTEGER NOT NULL DEFAULT 0,
    "notify_sent" INTEGER NOT NULL DEFAULT 0,
    "notify_failed" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_status_maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_status_maintenance_pages" (
    "maintenance_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,

    CONSTRAINT "sd_status_maintenance_pages_pkey" PRIMARY KEY ("maintenance_id","page_id")
);

-- CreateIndex
CREATE INDEX "sd_status_components_page_id_position_idx" ON "sd_status_components"("page_id", "position");

-- CreateIndex
CREATE INDEX "sd_status_components_workspace_id_idx" ON "sd_status_components"("workspace_id");

-- CreateIndex
CREATE INDEX "sd_status_maintenances_workspace_id_starts_at_idx" ON "sd_status_maintenances"("workspace_id", "starts_at");

-- CreateIndex
CREATE INDEX "sd_status_maintenances_workspace_id_suppress_monitoring_sta_idx" ON "sd_status_maintenances"("workspace_id", "suppress_monitoring", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "sd_status_maintenance_pages_page_id_idx" ON "sd_status_maintenance_pages"("page_id");

-- CreateIndex
CREATE INDEX "sd_status_maintenance_pages_workspace_id_idx" ON "sd_status_maintenance_pages"("workspace_id");

-- AddForeignKey
ALTER TABLE "sd_status_components" ADD CONSTRAINT "sd_status_components_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "sd_status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_status_maintenance_pages" ADD CONSTRAINT "sd_status_maintenance_pages_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "sd_status_maintenances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_status_maintenance_pages" ADD CONSTRAINT "sd_status_maintenance_pages_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "sd_status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
