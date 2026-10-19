-- AlterTable
ALTER TABLE "crm_apollo_imports" ADD COLUMN     "phone_only_people" JSONB,
ADD COLUMN     "phones_received" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phones_requested" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reveal_phones" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "webhook_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "crm_apollo_imports_webhook_token_hash_key" ON "crm_apollo_imports"("webhook_token_hash");

