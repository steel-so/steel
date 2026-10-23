-- AlterTable
ALTER TABLE "whatsapp_contacts" ADD COLUMN "bsuid" TEXT,
ADD COLUMN "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_workspace_id_bsuid_key" ON "whatsapp_contacts"("workspace_id", "bsuid");
