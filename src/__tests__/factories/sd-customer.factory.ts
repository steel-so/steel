import { createId } from '@paralleldrive/cuid2'
import type { Prisma, SdCustomer } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  SdCustomerDetailRow,
  SdCustomerWithCounts,
} from '@/src/repositories/sd-customer.repository'

export function createFakeSdCustomer(
  overrides?: Partial<SdCustomerWithCounts>,
): SdCustomerWithCounts {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    kind: 'CLIENT',
    personType: 'LEGAL',
    name: 'Acme Ltda',
    tradeName: 'Acme',
    document: '11222333000181',
    email: 'contato@acme.com.br',
    phone: '551133334444',
    whatsapp: '5511987654321',
    zipCode: '01001000',
    street: 'Praça da Sé',
    number: '100',
    complement: null,
    district: 'Sé',
    city: 'São Paulo',
    state: 'SP',
    country: 'BR',
    ibgeCode: '3550308',
    notes: null,
    customFields: {},
    crmCompanyId: null,
    active: true,
    createdById: createId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    _count: { contacts: 0, configItems: 0 },
    ...overrides,
  }
}

export function createFakeSdCustomerDetail(
  overrides?: Partial<SdCustomerDetailRow>,
): SdCustomerDetailRow {
  return { ...createFakeSdCustomer(), contacts: [], ...overrides }
}

export async function seedSdCustomer(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Omit<Prisma.SdCustomerUncheckedCreateInput, 'id'>>,
): Promise<SdCustomer> {
  return prisma.sdCustomer.create({
    data: {
      workspaceId,
      createdById,
      name: `Cliente ${createId().slice(0, 6)}`,
      ...overrides,
    },
  })
}
