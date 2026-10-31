-- CreateEnum
CREATE TYPE "SdRemoteProvider" AS ENUM ('RUSTDESK', 'ANYDESK');

-- CreateTable
CREATE TABLE "sd_remote_settings" (
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "SdRemoteProvider" NOT NULL DEFAULT 'RUSTDESK',
    "link_template" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_remote_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "sd_remote_endpoints" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "config_item_id" TEXT NOT NULL,
    "provider" "SdRemoteProvider" NOT NULL,
    "remote_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_remote_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_remote_sessions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "config_item_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "user_id" TEXT NOT NULL,
    "provider" "SdRemoteProvider" NOT NULL,
    "remote_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sd_remote_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_software_licenses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "match_pattern" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER,
    "purchased_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "renewal_notice_days" INTEGER NOT NULL DEFAULT 30,
    "last_notice_kind" TEXT,
    "last_notice_at" TIMESTAMP(3),
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_software_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_software_license_assets" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "config_item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sd_software_license_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sd_wfm_settings" (
    "workspace_id" TEXT NOT NULL,
    "history_weeks" INTEGER NOT NULL DEFAULT 8,
    "tickets_per_agent_hour" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "target_occupancy_percent" INTEGER NOT NULL DEFAULT 75,
    "min_agents_per_shift" INTEGER NOT NULL DEFAULT 1,
    "shifts" JSONB NOT NULL DEFAULT '[{"name":"Manhã","startHour":6,"endHour":14},{"name":"Tarde","startHour":14,"endHour":22}]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sd_wfm_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateIndex
CREATE INDEX "sd_remote_endpoints_workspace_id_idx" ON "sd_remote_endpoints"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "sd_remote_endpoints_config_item_id_provider_key" ON "sd_remote_endpoints"("config_item_id", "provider");

-- CreateIndex
CREATE INDEX "sd_remote_sessions_workspace_id_started_at_idx" ON "sd_remote_sessions"("workspace_id", "started_at");

-- CreateIndex
CREATE INDEX "sd_remote_sessions_config_item_id_started_at_idx" ON "sd_remote_sessions"("config_item_id", "started_at");

-- CreateIndex
CREATE INDEX "sd_remote_sessions_ticket_id_idx" ON "sd_remote_sessions"("ticket_id");

-- CreateIndex
CREATE INDEX "sd_software_licenses_workspace_id_expires_at_idx" ON "sd_software_licenses"("workspace_id", "expires_at");

-- CreateIndex
CREATE INDEX "sd_software_license_assets_config_item_id_idx" ON "sd_software_license_assets"("config_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sd_software_license_assets_license_id_config_item_id_key" ON "sd_software_license_assets"("license_id", "config_item_id");

-- AddForeignKey
ALTER TABLE "sd_remote_settings" ADD CONSTRAINT "sd_remote_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_remote_endpoints" ADD CONSTRAINT "sd_remote_endpoints_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_remote_endpoints" ADD CONSTRAINT "sd_remote_endpoints_config_item_id_fkey" FOREIGN KEY ("config_item_id") REFERENCES "sd_config_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_remote_sessions" ADD CONSTRAINT "sd_remote_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_remote_sessions" ADD CONSTRAINT "sd_remote_sessions_config_item_id_fkey" FOREIGN KEY ("config_item_id") REFERENCES "sd_config_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_remote_sessions" ADD CONSTRAINT "sd_remote_sessions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "sd_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_remote_sessions" ADD CONSTRAINT "sd_remote_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_software_licenses" ADD CONSTRAINT "sd_software_licenses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_software_licenses" ADD CONSTRAINT "sd_software_licenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_software_license_assets" ADD CONSTRAINT "sd_software_license_assets_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "sd_software_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_software_license_assets" ADD CONSTRAINT "sd_software_license_assets_config_item_id_fkey" FOREIGN KEY ("config_item_id") REFERENCES "sd_config_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_wfm_settings" ADD CONSTRAINT "sd_wfm_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
