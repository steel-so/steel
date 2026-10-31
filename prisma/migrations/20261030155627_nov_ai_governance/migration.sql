-- AlterTable
ALTER TABLE "steel_agent_runs" ADD COLUMN     "delegated_cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
ADD COLUMN     "depth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parent_run_id" TEXT;

-- CreateTable
CREATE TABLE "steel_agent_policies" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "killed_at" TIMESTAMP(3),
    "killed_by_id" TEXT,
    "kill_reason" TEXT,
    "restrict_creators" BOOLEAN NOT NULL DEFAULT false,
    "creator_roles" "Role"[],
    "restrict_auto" BOOLEAN NOT NULL DEFAULT false,
    "auto_rules" JSONB,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steel_agent_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steel_agent_delegates" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "target_agent_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "steel_agent_delegates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steel_mcp_servers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "auth_header_name" TEXT NOT NULL DEFAULT 'Authorization',
    "encrypted_auth_value" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowed_tools" TEXT[],
    "tools_cache" JSONB,
    "discovered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steel_mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "steel_agent_policies_workspace_id_key" ON "steel_agent_policies"("workspace_id");

-- CreateIndex
CREATE INDEX "steel_agent_delegates_target_agent_id_idx" ON "steel_agent_delegates"("target_agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "steel_agent_delegates_agent_id_target_agent_id_key" ON "steel_agent_delegates"("agent_id", "target_agent_id");

-- CreateIndex
CREATE INDEX "steel_mcp_servers_workspace_id_idx" ON "steel_mcp_servers"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "steel_mcp_servers_workspace_id_slug_key" ON "steel_mcp_servers"("workspace_id", "slug");

-- CreateIndex
CREATE INDEX "steel_agent_runs_parent_run_id_idx" ON "steel_agent_runs"("parent_run_id");

-- AddForeignKey
ALTER TABLE "steel_agent_policies" ADD CONSTRAINT "steel_agent_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_agent_delegates" ADD CONSTRAINT "steel_agent_delegates_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "steel_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_agent_delegates" ADD CONSTRAINT "steel_agent_delegates_target_agent_id_fkey" FOREIGN KEY ("target_agent_id") REFERENCES "steel_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steel_mcp_servers" ADD CONSTRAINT "steel_mcp_servers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
