-- CreateEnum
CREATE TYPE "SitePostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SiteCollectionItemStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterEnum
ALTER TYPE "SiteGlobalKind" ADD VALUE 'TEMPLATE';

-- CreateTable
CREATE TABLE "site_posts" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" JSONB NOT NULL DEFAULT '[]',
    "content_html" TEXT NOT NULL DEFAULT '',
    "plain_text" TEXT NOT NULL DEFAULT '',
    "cover_image_url" TEXT,
    "cover_image_alt" TEXT,
    "author_id" TEXT,
    "status" "SitePostStatus" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "reading_minutes" INTEGER NOT NULL DEFAULT 1,
    "seo" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_blog_categories" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_blog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_blog_tags" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_blog_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_post_categories" (
    "post_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "site_post_categories_pkey" PRIMARY KEY ("post_id","category_id")
);

-- CreateTable
CREATE TABLE "site_post_tags" (
    "post_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "site_post_tags_pkey" PRIMARY KEY ("post_id","tag_id")
);

-- CreateTable
CREATE TABLE "site_authors" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bio" TEXT,
    "avatar_url" TEXT,
    "links" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_collections" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "template_global_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_collection_items" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "SiteCollectionItemStatus" NOT NULL DEFAULT 'DRAFT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_posts_site_id_status_published_at_idx" ON "site_posts"("site_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "site_posts_status_published_at_idx" ON "site_posts"("status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_posts_site_id_slug_key" ON "site_posts"("site_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "site_blog_categories_site_id_slug_key" ON "site_blog_categories"("site_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "site_blog_tags_site_id_slug_key" ON "site_blog_tags"("site_id", "slug");

-- CreateIndex
CREATE INDEX "site_post_categories_category_id_idx" ON "site_post_categories"("category_id");

-- CreateIndex
CREATE INDEX "site_post_tags_tag_id_idx" ON "site_post_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_authors_site_id_slug_key" ON "site_authors"("site_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "site_authors_site_id_user_id_key" ON "site_authors"("site_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_collections_site_id_slug_key" ON "site_collections"("site_id", "slug");

-- CreateIndex
CREATE INDEX "site_collection_items_collection_id_status_position_idx" ON "site_collection_items"("collection_id", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "site_collection_items_collection_id_slug_key" ON "site_collection_items"("collection_id", "slug");

-- AddForeignKey
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "site_authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_blog_categories" ADD CONSTRAINT "site_blog_categories_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_blog_tags" ADD CONSTRAINT "site_blog_tags_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_post_categories" ADD CONSTRAINT "site_post_categories_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "site_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_post_categories" ADD CONSTRAINT "site_post_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "site_blog_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_post_tags" ADD CONSTRAINT "site_post_tags_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "site_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_post_tags" ADD CONSTRAINT "site_post_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "site_blog_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_authors" ADD CONSTRAINT "site_authors_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_collections" ADD CONSTRAINT "site_collections_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_collection_items" ADD CONSTRAINT "site_collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "site_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "site_posts" ADD COLUMN     "auto_excerpt" TEXT NOT NULL DEFAULT '';
