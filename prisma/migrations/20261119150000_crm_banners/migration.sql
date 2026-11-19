-- CreateTable
CREATE TABLE "crm_banners" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objective" TEXT,
    "document" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_banners_workspace_id_deleted_at_updated_at_idx" ON "crm_banners"("workspace_id", "deleted_at", "updated_at");

-- AddForeignKey
ALTER TABLE "crm_banners" ADD CONSTRAINT "crm_banners_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
