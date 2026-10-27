-- Better Auth 1.6.23 -> 1.7.12 (`@better-auth/oauth-provider` schema).
-- Additive except for `oauth_clients.public` and `oauth_clients.type`, which
-- 1.7 replaces with `token_endpoint_auth_method` and `application_type` and
-- which are backfilled below before being dropped. The core tables (users,
-- sessions, accounts, verifications) and `two_factors` are unchanged in 1.7.

-- AlterTable
ALTER TABLE "oauth_access_tokens" ADD COLUMN     "authorization_code_id" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requested_user_info_claims" TEXT[],
ADD COLUMN     "resources" TEXT[],
ADD COLUMN     "revoked" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "oauth_clients" ADD COLUMN     "application_type" TEXT,
ADD COLUMN     "backchannel_logout_session_required" BOOLEAN,
ADD COLUMN     "backchannel_logout_uri" TEXT,
ADD COLUMN     "client_credentials_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "client_discovery_id" TEXT,
ADD COLUMN     "dpop_bound_access_tokens" BOOLEAN DEFAULT false,
ADD COLUMN     "jwks" TEXT,
ADD COLUMN     "jwks_uri" TEXT;

-- Backfill the clients registered under 1.6 (1.7 upgrade guide, "Migrate
-- OAuth client records"), before the legacy columns go away:
-- 1. `type` web/native becomes `application_type`; anything else (or nothing)
--    is inferred from the redirect URIs the way 1.7 registration does
--    (`clientRegistrationDefaultApplicationType: 'infer'`): a loopback http or
--    a custom-scheme redirect makes it native, otherwise it stays NULL.
-- 2. A public client without an explicit method becomes
--    `token_endpoint_auth_method = 'none'`, which is how 1.7 tells public
--    clients apart now that `public` is gone.
-- `client_credentials_scopes` already defaults to an empty array, and
-- `oauth_client_resources` is new, so it holds no duplicates.
UPDATE "oauth_clients"
SET "application_type" = CASE
  WHEN "type" IN ('web', 'native') THEN "type"
  WHEN EXISTS (
    SELECT 1 FROM unnest("redirect_uris") AS uri
    WHERE uri ~* '^http://(localhost|127\.0\.0\.1|\[::1\])([:/?#]|$)'
       OR uri !~* '^https?://'
  ) THEN 'native'
  ELSE NULL
END;

UPDATE "oauth_clients"
SET "token_endpoint_auth_method" = 'none'
WHERE "public" = true AND "token_endpoint_auth_method" IS NULL;

ALTER TABLE "oauth_clients" DROP COLUMN "public",
DROP COLUMN "type";

-- AlterTable
ALTER TABLE "oauth_consents" ADD COLUMN     "requested_user_info_claims" TEXT[],
ADD COLUMN     "resources" TEXT[];

-- AlterTable
ALTER TABLE "oauth_refresh_tokens" ADD COLUMN     "authorization_code_id" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requested_user_info_claims" TEXT[],
ADD COLUMN     "resources" TEXT[],
ADD COLUMN     "rotated_at" TIMESTAMP(3),
ADD COLUMN     "rotation_replay_expires_at" TIMESTAMP(3),
ADD COLUMN     "rotation_replay_response" TEXT;

-- CreateTable
CREATE TABLE "oauth_resources" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access_token_ttl" INTEGER,
    "refresh_token_ttl" INTEGER,
    "signing_algorithm" TEXT,
    "signing_key_id" TEXT,
    "allowed_scopes" TEXT[],
    "custom_claims" JSONB,
    "dpop_bound_access_tokens_required" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "policy_version" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauth_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_resources" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_client_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_assertions" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_client_assertions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_resources_identifier_key" ON "oauth_resources"("identifier");

-- CreateIndex
CREATE INDEX "oauth_client_resources_client_id_idx" ON "oauth_client_resources"("client_id");

-- CreateIndex
CREATE INDEX "oauth_client_resources_resource_id_idx" ON "oauth_client_resources"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_resources_client_id_resource_id_key" ON "oauth_client_resources"("client_id", "resource_id");

-- CreateIndex
CREATE INDEX "oauth_access_tokens_authorization_code_id_idx" ON "oauth_access_tokens"("authorization_code_id");

-- CreateIndex
CREATE INDEX "oauth_refresh_tokens_authorization_code_id_idx" ON "oauth_refresh_tokens"("authorization_code_id");

-- AddForeignKey
ALTER TABLE "oauth_client_resources" ADD CONSTRAINT "oauth_client_resources_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client_resources" ADD CONSTRAINT "oauth_client_resources_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "oauth_resources"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;
