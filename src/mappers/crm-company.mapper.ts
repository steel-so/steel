import type { CrmCompany } from '@prisma/client'
import type { CrmCompanyAddress, CrmCompanyDTO } from '@/types/crm-company'

export function toCrmCompanyDTO(company: CrmCompany): CrmCompanyDTO {
  return {
    id: company.id,
    name: company.name,
    cnpj: company.cnpj,
    domain: company.domain,
    employees: company.employees,
    linkedin: company.linkedin,
    address: (company.address as CrmCompanyAddress | null) ?? null,
    arr: company.arr ? Number(company.arr) : null,
    icp: company.icp,
    legalName: company.legalName ?? null,
    tradeName: company.tradeName ?? null,
    emails: company.emails ?? [],
    phones: company.phones ?? [],
    cnaeCode: company.cnaeCode ?? null,
    cnaeDescription: company.cnaeDescription ?? null,
    size: (company.size as CrmCompanyDTO['size']) ?? null,
    legalNature: company.legalNature ?? null,
    registrationStatus: company.registrationStatus ?? null,
    openedAt: company.openedAt
      ? company.openedAt.toISOString().slice(0, 10)
      : null,
    shareCapital: company.shareCapital ? Number(company.shareCapital) : null,
    workspaceId: company.workspaceId,
    createdById: company.createdById,
    accountOwnerId: company.accountOwnerId,
    updatedById: company.updatedById,
    position: company.position,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  }
}
