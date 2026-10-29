import type { CrmCnpjEnrichmentRun, CrmCompanyEnrichment } from '@prisma/client'
import type { CnpjProfile } from '@/src/lib/cnpj/provider'
import type {
  CrmCnpjPartnerDTO,
  CrmCnpjProfileDTO,
  CrmCnpjRunDTO,
  CrmCnpjSecondaryCnaeDTO,
  CrmCnpjSizeDTO,
  CrmCompanyEnrichmentDTO,
} from '@/types/crm-cnpj'

export function toCrmCnpjProfileDTO(profile: CnpjProfile): CrmCnpjProfileDTO {
  return { ...profile }
}

/** Provider profile → columns of `crm_company_enrichments`. */
export function toEnrichmentData(profile: CnpjProfile, source: string) {
  return {
    cnpj: profile.cnpj,
    legalName: profile.legalName,
    tradeName: profile.tradeName,
    cnaeCode: profile.cnaeCode,
    cnaeDescription: profile.cnaeDescription,
    secondaryCnaes: profile.secondaryCnaes,
    size: profile.size,
    legalNature: profile.legalNature,
    registrationStatus: profile.registrationStatus,
    openedAt: profile.openedAt
      ? new Date(`${profile.openedAt}T00:00:00Z`)
      : null,
    shareCapital: profile.shareCapital,
    partners: profile.partners,
    source,
  }
}

export function toCrmCompanyEnrichmentDTO(
  row: CrmCompanyEnrichment,
): CrmCompanyEnrichmentDTO {
  return {
    id: row.id,
    companyId: row.companyId,
    cnpj: row.cnpj,
    legalName: row.legalName,
    tradeName: row.tradeName,
    cnaeCode: row.cnaeCode,
    cnaeDescription: row.cnaeDescription,
    secondaryCnaes:
      (row.secondaryCnaes as unknown as CrmCnpjSecondaryCnaeDTO[]) ?? [],
    size: row.size as CrmCnpjSizeDTO | null,
    legalNature: row.legalNature,
    registrationStatus: row.registrationStatus,
    openedAt: row.openedAt ? row.openedAt.toISOString().slice(0, 10) : null,
    shareCapital: row.shareCapital ? Number(row.shareCapital) : null,
    partners: (row.partners as unknown as CrmCnpjPartnerDTO[]) ?? [],
    source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
  }
}

export function toCrmCnpjRunDTO(run: CrmCnpjEnrichmentRun): CrmCnpjRunDTO {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    createdById: run.createdById,
    status: run.status,
    onlyMissing: run.onlyMissing,
    overwrite: run.overwrite,
    total: run.total,
    processed: run.processed,
    enriched: run.enriched,
    notFound: run.notFound,
    invalid: run.invalid,
    failed: run.failed,
    error: run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  }
}
