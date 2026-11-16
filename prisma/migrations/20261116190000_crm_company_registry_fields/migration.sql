-- Registry data on the CRM company itself (Receita), plus e-mails and phones.
-- Until now only the name and the address were copied from the Receita; the
-- rest lived in the enrichment snapshot. These columns make every field
-- visible and editable in the grid and the side panel.

ALTER TABLE "crm_companies"
  ADD COLUMN IF NOT EXISTS "legal_name" TEXT,
  ADD COLUMN IF NOT EXISTS "trade_name" TEXT,
  ADD COLUMN IF NOT EXISTS "emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "cnae_code" TEXT,
  ADD COLUMN IF NOT EXISTS "cnae_description" TEXT,
  ADD COLUMN IF NOT EXISTS "size" TEXT,
  ADD COLUMN IF NOT EXISTS "legal_nature" TEXT,
  ADD COLUMN IF NOT EXISTS "registration_status" TEXT,
  ADD COLUMN IF NOT EXISTS "opened_at" DATE,
  ADD COLUMN IF NOT EXISTS "share_capital" DECIMAL(16, 2);

-- Companies already enriched keep what the Receita told us: copy the snapshot
-- into the new columns (nothing the user typed is touched: they did not exist).
UPDATE "crm_companies" AS c
SET
  "legal_name" = e."legal_name",
  "trade_name" = e."trade_name",
  "cnae_code" = e."cnae_code",
  "cnae_description" = e."cnae_description",
  "size" = e."size",
  "legal_nature" = e."legal_nature",
  "registration_status" = e."registration_status",
  "opened_at" = e."opened_at",
  "share_capital" = e."share_capital"
FROM "crm_company_enrichments" AS e
WHERE e."company_id" = c."id";
