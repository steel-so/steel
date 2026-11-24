-- AlterTable
ALTER TABLE "crm_proposals" ADD COLUMN "sent_at" TIMESTAMP(3);

-- Backfill: proposals already out of DRAFT get the first view, else the
-- acceptance, else the last update (best available approximation).
UPDATE "crm_proposals" p
SET "sent_at" = COALESCE(
  (SELECT MIN(v."created_at") FROM "crm_proposal_views" v WHERE v."proposal_id" = p."id"),
  p."accepted_at",
  p."updated_at"
)
WHERE p."status" <> 'DRAFT';
