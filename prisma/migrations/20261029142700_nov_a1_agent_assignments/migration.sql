-- CreateEnum
CREATE TYPE "SteelAgentAssignmentEntity" AS ENUM ('SD_TICKET', 'CRM_LEAD');

-- CreateTable
CREATE TABLE "steel_agent_assignments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "entity_type" "SteelAgentAssignmentEntity" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "assigned_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "steel_agent_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "steel_agent_assignments_workspace_id_agent_id_idx" ON "steel_agent_assignments"("workspace_id", "agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "steel_agent_assignments_entity_type_entity_id_key" ON "steel_agent_assignments"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "steel_agent_assignments" ADD CONSTRAINT "steel_agent_assignments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "steel_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
