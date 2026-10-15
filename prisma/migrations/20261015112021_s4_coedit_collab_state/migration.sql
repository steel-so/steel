-- CreateTable
CREATE TABLE "canvas_collab_states" (
    "document_name" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "document_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_collab_states_pkey" PRIMARY KEY ("document_name")
);

-- CreateIndex
CREATE INDEX "canvas_collab_states_workspace_id_idx" ON "canvas_collab_states"("workspace_id");

-- AddForeignKey
ALTER TABLE "canvas_collab_states" ADD CONSTRAINT "canvas_collab_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
