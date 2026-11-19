-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_GOOGLE_REVIEW_NEGATIVE';

-- CreateTable
CREATE TABLE "crm_google_business_connections" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "google_email" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "status" "CrmSocialConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "account_name" TEXT,
    "location_name" TEXT,
    "location_title" TEXT,
    "place_id" TEXT,
    "maps_uri" TEXT,
    "new_review_uri" TEXT,
    "reply_tone" TEXT,
    "average_rating" DOUBLE PRECISION,
    "total_review_count" INTEGER,
    "last_reviews_sync_at" TIMESTAMP(3),
    "last_metrics_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "connected_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_google_business_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_google_reviews" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "google_review_id" TEXT NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "reviewer_photo_url" TEXT,
    "star_rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "google_updated_at" TIMESTAMP(3) NOT NULL,
    "reply_comment" TEXT,
    "reply_updated_at" TIMESTAMP(3),
    "alerted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_google_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_google_business_daily_metrics" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions_maps_desktop" INTEGER NOT NULL DEFAULT 0,
    "impressions_maps_mobile" INTEGER NOT NULL DEFAULT 0,
    "impressions_search_desktop" INTEGER NOT NULL DEFAULT 0,
    "impressions_search_mobile" INTEGER NOT NULL DEFAULT 0,
    "call_clicks" INTEGER NOT NULL DEFAULT 0,
    "direction_requests" INTEGER NOT NULL DEFAULT 0,
    "website_clicks" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_google_business_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_google_business_connections_workspace_id_key" ON "crm_google_business_connections"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_google_business_connections_status_idx" ON "crm_google_business_connections"("status");

-- CreateIndex
CREATE INDEX "crm_google_reviews_workspace_id_reviewed_at_idx" ON "crm_google_reviews"("workspace_id", "reviewed_at");

-- CreateIndex
CREATE INDEX "crm_google_reviews_connection_id_star_rating_idx" ON "crm_google_reviews"("connection_id", "star_rating");

-- CreateIndex
CREATE UNIQUE INDEX "crm_google_reviews_connection_id_google_review_id_key" ON "crm_google_reviews"("connection_id", "google_review_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_google_business_daily_metrics_connection_id_date_key" ON "crm_google_business_daily_metrics"("connection_id", "date");

-- AddForeignKey
ALTER TABLE "crm_google_business_connections" ADD CONSTRAINT "crm_google_business_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_google_reviews" ADD CONSTRAINT "crm_google_reviews_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "crm_google_business_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_google_business_daily_metrics" ADD CONSTRAINT "crm_google_business_daily_metrics_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "crm_google_business_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
