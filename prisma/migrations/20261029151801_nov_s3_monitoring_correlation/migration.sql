-- CreateEnum
CREATE TYPE "SdMonitorCorrelationMode" AS ENUM ('OFF', 'HOST');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SdMonitorKind" ADD VALUE 'GRAFANA';
ALTER TYPE "SdMonitorKind" ADD VALUE 'PRTG';

-- AlterTable
ALTER TABLE "sd_monitor_alerts" ADD COLUMN     "correlated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correlation_key" TEXT,
ADD COLUMN     "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "occurrences" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sd_monitor_sources" ADD COLUMN     "correlation_mode" "SdMonitorCorrelationMode" NOT NULL DEFAULT 'HOST',
ADD COLUMN     "correlation_window_minutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "sd_monitor_host_aliases" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "config_item_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sd_monitor_host_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sd_monitor_host_aliases_config_item_id_idx" ON "sd_monitor_host_aliases"("config_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sd_monitor_host_aliases_workspace_id_host_key" ON "sd_monitor_host_aliases"("workspace_id", "host");

-- CreateIndex
CREATE INDEX "sd_monitor_alerts_workspace_id_correlation_key_status_idx" ON "sd_monitor_alerts"("workspace_id", "correlation_key", "status");

-- CreateIndex
CREATE INDEX "sd_monitor_alerts_config_item_id_idx" ON "sd_monitor_alerts"("config_item_id");

-- AddForeignKey
ALTER TABLE "sd_monitor_host_aliases" ADD CONSTRAINT "sd_monitor_host_aliases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_monitor_host_aliases" ADD CONSTRAINT "sd_monitor_host_aliases_config_item_id_fkey" FOREIGN KEY ("config_item_id") REFERENCES "sd_config_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
