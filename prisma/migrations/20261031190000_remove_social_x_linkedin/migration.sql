-- Removes the X (Twitter) and LinkedIn providers from the CRM Social module.

-- Scheduled post targets for the removed platforms; posts left without any
-- target would be unpublishable, so they go too (media rows cascade).
DELETE FROM "crm_scheduled_post_targets" WHERE "platform"::text IN ('TWITTER', 'LINKEDIN');
DELETE FROM "crm_scheduled_posts" p
WHERE NOT EXISTS (SELECT 1 FROM "crm_scheduled_post_targets" t WHERE t."post_id" = p."id");

-- Connections and tracked competitors (snapshots, posts and idea sets cascade).
DELETE FROM "crm_social_connections" WHERE "platform"::text IN ('TWITTER', 'LINKEDIN');
DELETE FROM "crm_tracked_competitors" WHERE "platform"::text IN ('TWITTER', 'LINKEDIN');

-- Hook vault items are kept, but lose the platform tag (nullable column).
UPDATE "crm_hook_vault_items" SET "platform" = NULL WHERE "platform"::text IN ('TWITTER', 'LINKEDIN');

-- Recreate the enum without the removed values.
ALTER TYPE "CrmSocialPlatform" RENAME TO "CrmSocialPlatform_old";
CREATE TYPE "CrmSocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'GOOGLE_ANALYTICS', 'GOOGLE_ADS');

ALTER TABLE "crm_social_connections" ALTER COLUMN "platform" TYPE "CrmSocialPlatform" USING ("platform"::text::"CrmSocialPlatform");
ALTER TABLE "crm_hook_vault_items" ALTER COLUMN "platform" TYPE "CrmSocialPlatform" USING ("platform"::text::"CrmSocialPlatform");
ALTER TABLE "crm_tracked_competitors" ALTER COLUMN "platform" TYPE "CrmSocialPlatform" USING ("platform"::text::"CrmSocialPlatform");
ALTER TABLE "crm_scheduled_post_targets" ALTER COLUMN "platform" TYPE "CrmSocialPlatform" USING ("platform"::text::"CrmSocialPlatform");

DROP TYPE "CrmSocialPlatform_old";
