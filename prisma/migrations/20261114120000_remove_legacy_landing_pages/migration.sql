-- Removes the legacy CRM landing page feature (ADR 0068).
-- Landing pages already migrated to Sites keep their public `/l/<token>`
-- address through `sites.legacy_landing_share_token`; every landing page that
-- was not migrated is deleted together with its sections and view beacons.

-- 1. Keep the old public address of migrated sites -------------------------
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "legacy_landing_share_token" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sites' AND column_name = 'source_landing_page_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_landing_pages'
  ) THEN
    UPDATE "sites" s
    SET "legacy_landing_share_token" = lp."share_token"
    FROM "crm_landing_pages" lp
    WHERE s."source_landing_page_id" = lp."id"
      AND s."legacy_landing_share_token" IS NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "sites_legacy_landing_share_token_key"
  ON "sites"("legacy_landing_share_token");

-- 2. Campaigns pointing to a landing page ---------------------------------
-- Migrated page: the campaign now points to the home page of the site.
-- Anything else: no destination (a draft just needs a new one).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crm_campaigns' AND column_name = 'landing_page_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sites' AND column_name = 'source_landing_page_id'
  ) THEN
    UPDATE "crm_campaigns" c
    SET "destination_type" = 'SITE_PAGE',
        "site_id" = s."id",
        "site_page_id" = s."home_page_id",
        "landing_page_id" = NULL
    FROM "sites" s
    WHERE c."destination_type" = 'LANDING_PAGE'
      AND s."source_landing_page_id" = c."landing_page_id"
      AND s."home_page_id" IS NOT NULL
      AND s."deleted_at" IS NULL;

    UPDATE "crm_campaigns"
    SET "destination_type" = NULL, "landing_page_id" = NULL
    WHERE "destination_type" = 'LANDING_PAGE';
  END IF;
END $$;

-- 3. Drop the LANDING_PAGE destination type (the enum is rebuilt) ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CrmCampaignDestinationType' AND e.enumlabel = 'LANDING_PAGE'
  ) THEN
    ALTER TYPE "CrmCampaignDestinationType" RENAME TO "CrmCampaignDestinationType_old";
    CREATE TYPE "CrmCampaignDestinationType" AS ENUM ('FORM', 'SITE_PAGE');
    ALTER TABLE "crm_campaigns"
      ALTER COLUMN "destination_type" TYPE "CrmCampaignDestinationType"
      USING ("destination_type"::text::"CrmCampaignDestinationType");
    DROP TYPE "CrmCampaignDestinationType_old";
  END IF;
END $$;

ALTER TABLE "crm_campaigns" DROP COLUMN IF EXISTS "landing_page_id";

-- 4. Drop the sites -> landing page link ------------------------------------
DROP INDEX IF EXISTS "sites_source_landing_page_id_key";
ALTER TABLE "sites" DROP COLUMN IF EXISTS "source_landing_page_id";

-- 5. Dashboard widgets that read the landing page list have nothing to show
DELETE FROM "crm_dashboard_widgets"
WHERE "type" IN ('CHART', 'VIEW')
  AND "config"->>'source' = 'landing-pages';

-- 6. Drop the landing page tables and enums ---------------------------------
DROP TABLE IF EXISTS "crm_landing_page_views";
DROP TABLE IF EXISTS "crm_landing_page_sections";
DROP TABLE IF EXISTS "crm_landing_pages";
DROP TYPE IF EXISTS "CrmLandingPageSectionType";
DROP TYPE IF EXISTS "CrmLandingPageStatus";
