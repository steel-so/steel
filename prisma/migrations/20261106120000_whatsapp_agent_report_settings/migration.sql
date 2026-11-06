-- CreateTable
CREATE TABLE "whatsapp_agent_report_settings" (
    "workspace_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_agent_report_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateIndex
CREATE INDEX "whatsapp_agent_report_settings_enabled_idx" ON "whatsapp_agent_report_settings"("enabled");

-- AddForeignKey
ALTER TABLE "whatsapp_agent_report_settings" ADD CONSTRAINT "whatsapp_agent_report_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
