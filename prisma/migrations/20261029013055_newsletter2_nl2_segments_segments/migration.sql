-- CreateTable
CREATE TABLE "crm_newsletter_segments" (
    "id" TEXT NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_newsletter_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_newsletter_segments_workspace_id_idx" ON "crm_newsletter_segments"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_newsletter_segments_newsletter_id_name_key" ON "crm_newsletter_segments"("newsletter_id", "name");

-- Subscribers pointing at a person that no longer exists lose the link
-- before the foreign key is added (the link was a plain column until now).
UPDATE "crm_newsletter_subscribers" s
SET "person_id" = NULL
WHERE s."person_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "crm_people" p WHERE p."id" = s."person_id");

-- AddForeignKey
ALTER TABLE "crm_newsletter_subscribers" ADD CONSTRAINT "crm_newsletter_subscribers_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "crm_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_newsletter_segments" ADD CONSTRAINT "crm_newsletter_segments_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "crm_newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
