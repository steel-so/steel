-- One default policy per workspace (a plain unique treats NULL team ids as distinct).
CREATE UNIQUE INDEX "whatsapp_sla_policies_workspace_default_key" ON "whatsapp_sla_policies"("workspace_id") WHERE "team_id" IS NULL;

-- At most one open SLA cycle per conversation.
CREATE UNIQUE INDEX "whatsapp_sla_cycles_open_conversation_key" ON "whatsapp_sla_cycles"("conversation_id") WHERE "resolved_at" IS NULL;

-- Scan job: open cycles with a pending warning/breach.
CREATE INDEX "whatsapp_sla_cycles_open_due_idx" ON "whatsapp_sla_cycles"("first_response_due_at") WHERE "resolved_at" IS NULL;
