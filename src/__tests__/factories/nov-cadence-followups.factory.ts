import { createId } from '@paralleldrive/cuid2'
import type { CrmCadenceRun } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export function createFakeCrmCadenceRun(
  overrides?: Partial<CrmCadenceRun>,
): CrmCadenceRun {
  return {
    id: createId(),
    workspaceId: createId(),
    cadenceId: createId(),
    enrollmentId: createId(),
    stepId: createId(),
    position: 0,
    type: 'EMAIL',
    status: 'PENDING',
    detail: null,
    providerMessageId: null,
    idempotencyKey: null,
    openedAt: null,
    clickedAt: null,
    openCount: 0,
    clickCount: 0,
    createdAt: new Date(),
    ...overrides,
  }
}

export async function seedCrmCadenceRun(
  input: {
    workspaceId: string
    cadenceId: string
    enrollmentId: string
  } & Partial<CrmCadenceRun>,
) {
  const { id: _id, createdAt: _createdAt, ...rest } = createFakeCrmCadenceRun()
  return prisma.crmCadenceRun.create({ data: { ...rest, ...input } })
}
