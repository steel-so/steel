-- CreateEnum
CREATE TYPE "BioLinkStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "BioLinkEventKind" AS ENUM ('VIEW', 'CLICK');

-- CreateTable
CREATE TABLE "bio_links" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "BioLinkStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "description" TEXT,
    "avatar_url" TEXT,
    "theme" JSONB NOT NULL DEFAULT '{}',
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "no_index" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bio_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bio_link_events" (
    "id" TEXT NOT NULL,
    "bio_link_id" TEXT NOT NULL,
    "kind" "BioLinkEventKind" NOT NULL,
    "link_id" TEXT,
    "link_title" TEXT,
    "visitor_hash" TEXT NOT NULL,
    "referrer" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "country" TEXT,
    "device" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bio_link_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bio_links_slug_key" ON "bio_links"("slug");

-- CreateIndex
CREATE INDEX "bio_links_workspace_id_idx" ON "bio_links"("workspace_id");

-- CreateIndex
CREATE INDEX "bio_link_events_bio_link_id_created_at_idx" ON "bio_link_events"("bio_link_id", "created_at");

-- CreateIndex
CREATE INDEX "bio_link_events_bio_link_id_kind_link_id_idx" ON "bio_link_events"("bio_link_id", "kind", "link_id");

-- AddForeignKey
ALTER TABLE "bio_links" ADD CONSTRAINT "bio_links_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bio_links" ADD CONSTRAINT "bio_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bio_links" ADD CONSTRAINT "bio_links_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bio_link_events" ADD CONSTRAINT "bio_link_events_bio_link_id_fkey" FOREIGN KEY ("bio_link_id") REFERENCES "bio_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
