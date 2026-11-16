import { createId } from '@paralleldrive/cuid2'
import type { CrmCompany } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { CrmCompanyDTO } from '@/types/crm-company'

export function createFakeCrmCompany(
  overrides?: Partial<CrmCompany>,
): CrmCompany {
  const now = new Date()
  return {
    id: createId(),
    name: 'Acme Inc.',
    cnpj: null,
    domain: null,
    employees: null,
    linkedin: null,
    address: null,
    arr: null,
    icp: false,
    legalName: null,
    tradeName: null,
    emails: [],
    phones: [],
    cnaeCode: null,
    cnaeDescription: null,
    size: null,
    legalNature: null,
    registrationStatus: null,
    openedAt: null,
    shareCapital: null,
    workspaceId: createId(),
    createdById: createId(),
    accountOwnerId: null,
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeCrmCompanyDTO(
  overrides?: Partial<CrmCompanyDTO>,
): CrmCompanyDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    name: 'Acme Inc.',
    cnpj: null,
    domain: null,
    employees: null,
    linkedin: null,
    address: null,
    arr: null,
    icp: false,
    legalName: null,
    tradeName: null,
    emails: [],
    phones: [],
    cnaeCode: null,
    cnaeDescription: null,
    size: null,
    legalNature: null,
    registrationStatus: null,
    openedAt: null,
    shareCapital: null,
    workspaceId: createId(),
    createdById: createId(),
    accountOwnerId: null,
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmCompany(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmCompany,
      | 'name'
      | 'cnpj'
      | 'domain'
      | 'employees'
      | 'linkedin'
      | 'icp'
      | 'accountOwnerId'
      | 'position'
      | 'deletedAt'
    >
  >,
) {
  return prisma.crmCompany.create({
    data: {
      name: 'Seed Company',
      workspaceId,
      createdById,
      ...overrides,
    },
  })
}
