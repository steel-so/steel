-- The "AI never answers CRM contacts" lock is replaced by context: drop its column.
ALTER TABLE "whatsapp_contacts" DROP COLUMN "crm_outreach_at";

-- CreateTable
CREATE TABLE "whatsapp_crm_outbound" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "wa_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" "WhatsAppMessageType" NOT NULL DEFAULT 'TEXT',
    "text" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_crm_outbound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_crm_outbound_workspace_id_wa_id_imported_at_idx" ON "whatsapp_crm_outbound"("workspace_id", "wa_id", "imported_at");

-- AddForeignKey
ALTER TABLE "whatsapp_crm_outbound" ADD CONSTRAINT "whatsapp_crm_outbound_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
