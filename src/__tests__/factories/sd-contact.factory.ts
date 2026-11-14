import { createId } from '@paralleldrive/cuid2'
import type { Prisma, SdContact } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SdContactRow } from '@/src/repositories/sd-contact.repository'

export function createFakeSdContact(
  overrides?: Partial<SdContactRow>,
): SdContactRow {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Ana Souza',
    jobTitle: 'Coordenadora de TI',
    email: 'ana@acme.com.br',
    phone: null,
    whatsapp: '5511987654321',
    userId: null,
    notes: null,
    customFields: {},
    crmPersonId: null,
    active: true,
    createdById: createId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    user: null,
    customers: [],
    ...overrides,
  }
}

export async function seedSdContact(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Omit<Prisma.SdContactUncheckedCreateInput, 'id'>>,
  customerIds: string[] = [],
): Promise<SdContact> {
  return prisma.sdContact.create({
    data: {
      workspaceId,
      createdById,
      name: `Contato ${createId().slice(0, 6)}`,
      ...overrides,
      customers: {
        create: customerIds.map((customerId, i) => ({
          customerId,
          isPrimary: i === 0,
        })),
      },
    },
  })
}
