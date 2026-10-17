-- AlterEnum
ALTER TYPE "AiActionSource" ADD VALUE 'MCP';

-- AlterTable
ALTER TABLE "ai_action_logs" ADD COLUMN     "oauth_client_id" TEXT;

-- AlterTable
ALTER TABLE "ai_pending_actions" ADD COLUMN     "integration_grant_id" TEXT;

-- CreateIndex
CREATE INDEX "ai_pending_actions_integration_grant_id_idx" ON "ai_pending_actions"("integration_grant_id");

-- AddForeignKey
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_integration_grant_id_fkey" FOREIGN KEY ("integration_grant_id") REFERENCES "integration_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
