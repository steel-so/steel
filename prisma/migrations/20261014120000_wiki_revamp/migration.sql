-- AlterEnum
ALTER TYPE "AiUsageFeature" ADD VALUE 'WIKI_ASSISTANT';

-- AlterTable
ALTER TABLE "wiki_pages" ADD COLUMN     "locked_at" TIMESTAMP(3),
ADD COLUMN     "locked_by_id" TEXT,
ADD COLUMN     "public_token" TEXT,
ADD COLUMN     "published_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "wiki_page_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wiki_page_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_page_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wiki_page_favorites_wiki_page_id_idx" ON "wiki_page_favorites"("wiki_page_id");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_page_favorites_user_id_wiki_page_id_key" ON "wiki_page_favorites"("user_id", "wiki_page_id");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_pages_public_token_key" ON "wiki_pages"("public_token");

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_locked_by_id_fkey" FOREIGN KEY ("locked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_favorites" ADD CONSTRAINT "wiki_page_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_favorites" ADD CONSTRAINT "wiki_page_favorites_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

