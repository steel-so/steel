-- CreateTable
CREATE TABLE "sd_ai_suggestions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sd_ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sd_ai_suggestions_workspace_id_created_at_idx" ON "sd_ai_suggestions"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "sd_ai_suggestions_ticket_id_idx" ON "sd_ai_suggestions"("ticket_id");

-- AddForeignKey
ALTER TABLE "sd_ai_suggestions" ADD CONSTRAINT "sd_ai_suggestions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sd_ai_suggestions" ADD CONSTRAINT "sd_ai_suggestions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "sd_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
