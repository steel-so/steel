-- CreateEnum
CREATE TYPE "WorkspaceAccessOutcome" AS ENUM ('ALLOWED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "WorkspaceAccessSurface" AS ENUM ('APP', 'API');

-- CreateTable
CREATE TABLE "workspace_access_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT,
    "user_email" TEXT,
    "user_name" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "outcome" "WorkspaceAccessOutcome" NOT NULL,
    "surface" "WorkspaceAccessSurface" NOT NULL,
    "path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_access_logs_workspace_id_created_at_idx" ON "workspace_access_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_access_logs_created_at_idx" ON "workspace_access_logs"("created_at");

-- AddForeignKey
ALTER TABLE "workspace_access_logs" ADD CONSTRAINT "workspace_access_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
