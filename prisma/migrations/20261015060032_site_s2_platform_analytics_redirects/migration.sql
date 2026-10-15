-- CreateEnum
CREATE TYPE "SiteEventKind" AS ENUM ('VIEW', 'CONVERSION');

-- AlterTable
ALTER TABLE "site_views" ADD COLUMN     "form_token" TEXT,
ADD COLUMN     "kind" "SiteEventKind" NOT NULL DEFAULT 'VIEW';

-- CreateTable
CREATE TABLE "site_redirects" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "from_path" TEXT NOT NULL,
    "to_path" TEXT NOT NULL,
    "permanent" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_redirects_site_id_from_path_key" ON "site_redirects"("site_id", "from_path");

-- AddForeignKey
ALTER TABLE "site_redirects" ADD CONSTRAINT "site_redirects_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
