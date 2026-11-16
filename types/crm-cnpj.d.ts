import type { CrmCompanyAddress, CrmCompanyDTO } from '@/types/crm-company'

export type CrmCnpjSizeDTO = 'ME' | 'EPP' | 'DEMAIS'

export interface CrmCnpjPartnerDTO {
  name: string
  qualification: string | null
  enteredAt: string | null
}

export interface CrmCnpjSecondaryCnaeDTO {
  code: string
  description: string
}

/** Receita profile of a CNPJ (preview, not yet attached to a company). */
export interface CrmCnpjProfileDTO {
  cnpj: string
  legalName: string | null
  tradeName: string | null
  cnaeCode: string | null
  cnaeDescription: string | null
  secondaryCnaes: CrmCnpjSecondaryCnaeDTO[]
  size: CrmCnpjSizeDTO | null
  legalNature: string | null
  registrationStatus: string | null
  openedAt: string | null
  shareCapital: number | null
  partners: CrmCnpjPartnerDTO[]
  address: CrmCompanyAddress | null
  /** Contacts the sources returned (deduplicated, e-mails lowercase). */
  emails: string[]
  /** Phones as `(11) 2395-8400`. */
  phones: string[]
}

/** Stored profile; address, e-mails and phones live on the company itself. */
export interface CrmCompanyEnrichmentDTO
  extends Omit<CrmCnpjProfileDTO, 'address' | 'emails' | 'phones'> {
  id: string
  companyId: string
  source: string
  fetchedAt: string
}

/** Company fields the enrichment wrote. */
export type CrmCnpjAppliedField =
  | 'name'
  | 'address'
  | 'legalName'
  | 'tradeName'
  | 'emails'
  | 'phones'
  | 'domain'
  | 'cnae'
  | 'size'
  | 'legalNature'
  | 'registrationStatus'
  | 'openedAt'
  | 'shareCapital'

export interface CrmCompanyEnrichResultDTO {
  company: CrmCompanyDTO
  enrichment: CrmCompanyEnrichmentDTO
  applied: CrmCnpjAppliedField[]
}

export type CrmCnpjRunStatusDTO =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'

export interface CrmCnpjRunDTO {
  id: string
  workspaceId: string
  createdById: string
  status: CrmCnpjRunStatusDTO
  onlyMissing: boolean
  overwrite: boolean
  total: number
  processed: number
  enriched: number
  notFound: number
  invalid: number
  failed: number
  error: string | null
  /** True once an admin asked to stop (the worker stops between companies). */
  cancelRequested: boolean
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}
