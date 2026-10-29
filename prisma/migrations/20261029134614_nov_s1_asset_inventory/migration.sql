-- CreateEnum
CREATE TYPE "SdInventorySource" AS ENUM ('AGENT', 'SNMP');

-- CreateEnum
CREATE TYPE "SdInventoryAlertKind" AS ENUM ('DISK', 'RAM');

-- CreateEnum
CREATE TYPE "SdInventoryAlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SdInventoryScanStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "sd_inventory_settings" (
    "workspace_id" TEXT NOT NULL,
    "disk_threshold_percent" INTEGER NOT NULL DEFAULT 90,
    "ram_threshold_percent" INTEGER NOT NULL DEFAULT 90,
    "stale_after_days" INTEGER NOT NULL DEFAULT 7,
    "sync_config_items" BOOLEAN NOT NULL DEFAULT true,
    "default_type_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_inventory_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "sd_inventory_tokens" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sd_inventory_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_inventory_devices" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "config_item_id" TEXT,
    "source" "SdInventorySource" NOT NULL,
    "external_key" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "os_name" TEXT,
    "os_version" TEXT,
    "arch" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "cpu_model" TEXT,
    "cpu_cores" INTEGER,
    "ram_total_mb" INTEGER,
    "ram_used_mb" INTEGER,
    "ip_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mac_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "disks" JSONB NOT NULL DEFAULT '[]',
    "agent_version" TEXT,
    "snmp_target_id" TEXT,
    "token_id" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_inventory_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_inventory_software" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "publisher" TEXT,

    CONSTRAINT "sd_inventory_software_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_inventory_alerts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "kind" "SdInventoryAlertKind" NOT NULL,
    "mount" TEXT NOT NULL DEFAULT '',
    "status" "SdInventoryAlertStatus" NOT NULL DEFAULT 'OPEN',
    "used_percent" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_inventory_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_inventory_snmp_targets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ranges" TEXT[],
    "port" INTEGER NOT NULL DEFAULT 161,
    "community_enc" TEXT NOT NULL,
    "interval_minutes" INTEGER NOT NULL DEFAULT 1440,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "customer_id" TEXT,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_status" "SdInventoryScanStatus",
    "last_found" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sd_inventory_snmp_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sd_inventory_tokens_token_hash_key" ON "sd_inventory_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "sd_inventory_tokens_workspace_id_idx" ON "sd_inventory_tokens"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "sd_inventory_devices_config_item_id_key" ON "sd_inventory_devices"("config_item_id");

-- CreateIndex
CREATE INDEX "sd_inventory_devices_workspace_id_last_seen_at_idx" ON "sd_inventory_devices"("workspace_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "sd_inventory_devices_workspace_id_external_key_key" ON "sd_inventory_devices"("workspace_id", "external_key");

-- CreateIndex
CREATE INDEX "sd_inventory_software_name_idx" ON "sd_inventory_software"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sd_inventory_software_device_id_name_version_key" ON "sd_inventory_software"("device_id", "name", "version");

-- CreateIndex
CREATE INDEX "sd_inventory_alerts_workspace_id_status_idx" ON "sd_inventory_alerts"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sd_inventory_alerts_device_id_kind_mount_key" ON "sd_inventory_alerts"("device_id", "kind", "mount");

-- CreateIndex
CREATE INDEX "sd_inventory_snmp_targets_workspace_id_idx" ON "sd_inventory_snmp_targets"("workspace_id");

-- CreateIndex
CREATE INDEX "sd_inventory_snmp_targets_active_next_run_at_idx" ON "sd_inventory_snmp_targets"("active", "next_run_at");

-- AddForeignKey
ALTER TABLE "sd_inventory_settings" ADD CONSTRAINT "sd_inventory_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_tokens" ADD CONSTRAINT "sd_inventory_tokens_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_tokens" ADD CONSTRAINT "sd_inventory_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_devices" ADD CONSTRAINT "sd_inventory_devices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_devices" ADD CONSTRAINT "sd_inventory_devices_config_item_id_fkey" FOREIGN KEY ("config_item_id") REFERENCES "sd_config_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_devices" ADD CONSTRAINT "sd_inventory_devices_snmp_target_id_fkey" FOREIGN KEY ("snmp_target_id") REFERENCES "sd_inventory_snmp_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_software" ADD CONSTRAINT "sd_inventory_software_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "sd_inventory_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_alerts" ADD CONSTRAINT "sd_inventory_alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "sd_inventory_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_snmp_targets" ADD CONSTRAINT "sd_inventory_snmp_targets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_inventory_snmp_targets" ADD CONSTRAINT "sd_inventory_snmp_targets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
