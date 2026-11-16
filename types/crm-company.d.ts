export interface CrmCompanyAddress {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zipCode?: string
  country?: string
}

export interface CrmCompanyDTO {
  id: string
  name: string
  cnpj: string | null
  domain: string | null
  employees: number | null
  linkedin: string | null
  address: CrmCompanyAddress | null
  arr: number | null
  icp: boolean
  /** Registry data (Receita): razão social, nome fantasia, CNAE... */
  legalName: string | null
  tradeName: string | null
  emails: string[]
  phones: string[]
  cnaeCode: string | null
  cnaeDescription: string | null
  size: 'ME' | 'EPP' | 'DEMAIS' | null
  legalNature: string | null
  registrationStatus: string | null
  /** ISO date (`YYYY-MM-DD`). */
  openedAt: string | null
  shareCapital: number | null
  workspaceId: string
  createdById: string
  accountOwnerId: string | null
  updatedById: string | null
  position: number
  createdAt: string
  updatedAt: string
  /** Valores de campos customizados achatados, chave `cf_<definitionId>`. */
  customFields?: Record<string, unknown>
}
