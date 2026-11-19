-- CreateTable
CREATE TABLE "site_seo_keywords" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_seo_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_seo_snapshots" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "seo" INTEGER NOT NULL,
    "aeo" INTEGER NOT NULL,
    "geo" INTEGER NOT NULL,
    "pages" INTEGER NOT NULL,
    "issues" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_seo_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_seo_keywords_site_id_normalized_key" ON "site_seo_keywords"("site_id", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "site_seo_snapshots_site_id_day_key" ON "site_seo_snapshots"("site_id", "day");

-- AddForeignKey
ALTER TABLE "site_seo_keywords" ADD CONSTRAINT "site_seo_keywords_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_seo_snapshots" ADD CONSTRAINT "site_seo_snapshots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
