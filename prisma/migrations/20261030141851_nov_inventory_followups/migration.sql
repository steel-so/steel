-- CreateEnum
CREATE TYPE "SdSnmpVersion" AS ENUM ('V2C', 'V3');

-- CreateEnum
CREATE TYPE "SdSnmpAuthProtocol" AS ENUM ('MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512');

-- CreateEnum
CREATE TYPE "SdSnmpPrivProtocol" AS ENUM ('DES', 'AES', 'AES256B', 'AES256R');

-- AlterEnum
ALTER TYPE "SdInventorySource" ADD VALUE 'DISCOVERY';

-- AlterTable
ALTER TABLE "sd_inventory_devices" ADD COLUMN     "discovery_range_id" TEXT,
ADD COLUMN     "ignored" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "managed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "merge_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "merged_into_id" TEXT;

-- AlterTable
ALTER TABLE "sd_inventory_settings" ADD COLUMN     "agent_auto_update" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sd_inventory_snmp_targets" ADD COLUMN     "snmp_version" "SdSnmpVersion" NOT NULL DEFAULT 'V2C',
ADD COLUMN     "v3_auth_key_enc" TEXT,
ADD COLUMN     "v3_auth_protocol" "SdSnmpAuthProtocol",
ADD COLUMN     "v3_priv_key_enc" TEXT,
ADD COLUMN     "v3_priv_protocol" "SdSnmpPrivProtocol",
ADD COLUMN     "v3_username" TEXT;

-- CreateTable
CREATE TABLE "sd_inventory_discovery_ranges" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "interval_minutes" INTEGER NOT NULL DEFAULT 1440,
    "customer_id" TEXT,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_status" "SdInventoryScanStatus",
    "last_probed" INTEGER NOT NULL DEFAULT 0,
    "last_found" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sd_inventory_discovery_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_inventory_agent_releases" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "arch" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sd_inventory_agent_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sd_inventory_discovery_ranges_workspace_id_idx" ON "sd_inventory_discovery_ranges"("workspace_id");

-- CreateIndex
CREATE INDEX "sd_inventory_discovery_ranges_enabled_next_run_at_idx" ON "sd_inventory_discovery_ranges"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "sd_inventory_agent_releases_os_arch_active_published_at_idx" ON "sd_inventory_agent_releases"("os", "arch", "active", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "sd_inventory_agent_releases_version_os_arch_key" ON "sd_inventory_agent_releases"("version", "os", "arch");

-- CreateIndex
CREATE INDEX "sd_inventory_devices_workspace_id_merged_into_id_idx" ON "sd_inventory_devices"("workspace_id", "merged_into_id");

-- AddForeignKey
ALTER TABLE "sd_inventory_devices" ADD CONSTRAINT "sd_inventory_devices_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "sd_inventory_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_discovery_ranges" ADD CONSTRAINT "sd_inventory_discovery_ranges_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
