-- Daily agent report counts messages per workspace and day range.
CREATE INDEX "whatsapp_messages_workspace_id_created_at_idx" ON "whatsapp_messages"("workspace_id", "created_at");
