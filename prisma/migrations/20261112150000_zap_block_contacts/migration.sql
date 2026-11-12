-- CreateEnum
CREATE TYPE "WhatsAppContactBlockStatus" AS ENUM ('APPLIED', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppContactBlockOrigin" AS ENUM ('STEEL', 'PROVIDER');

-- CreateTable
CREATE TABLE "whatsapp_contact_blocks" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "wa_id" TEXT NOT NULL,
    "reason" VARCHAR(500),
    "provider_status" "WhatsAppContactBlockStatus" NOT NULL DEFAULT 'PENDING',
    "provider_error" TEXT,
    "applied_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "origin" "WhatsAppContactBlockOrigin" NOT NULL DEFAULT 'STEEL',
    "dropped_count" INTEGER NOT NULL DEFAULT 0,
    "last_dropped_at" TIMESTAMP(3),
    "blocked_by_id" TEXT,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_contact_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_contact_blocks_workspace_id_idx" ON "whatsapp_contact_blocks"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_contact_blocks_contact_id_idx" ON "whatsapp_contact_blocks"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contact_blocks_connection_id_wa_id_key" ON "whatsapp_contact_blocks"("connection_id", "wa_id");

-- AddForeignKey
ALTER TABLE "whatsapp_contact_blocks" ADD CONSTRAINT "whatsapp_contact_blocks_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contact_blocks" ADD CONSTRAINT "whatsapp_contact_blocks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
