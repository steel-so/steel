import { createId } from '@paralleldrive/cuid2'
import type { CrmForm, CrmFormSubmission, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { CrmFormDTO, CrmFormSubmissionDTO } from '@/types/crm-form'

export function createFakeCrmForm(overrides?: Partial<CrmForm>): CrmForm {
  const now = new Date()
  return {
    id: createId(),
    name: 'Contato',
    description: null,
    status: 'DRAFT',
    publicToken: createId(),
    action: 'LEAD',
    fields: [],
    phases: [],
    successMessage: null,
    redirectUrl: null,
    submissionCount: 0,
    newsletterId: null,
    workspaceId: createId(),
    createdById: createId(),
    updatedById: null,
    position: 0,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeCrmFormDTO(
  overrides?: Partial<CrmFormDTO>,
): CrmFormDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    name: 'Contato',
    description: null,
    status: 'DRAFT',
    publicToken: createId(),
    action: 'LEAD',
    fields: [],
    phases: [],
    successMessage: null,
    redirectUrl: null,
    submissionCount: 0,
    newsletterId: null,
    workspaceId: createId(),
    createdById: createId(),
    updatedById: null,
    position: 0,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmForm(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<CrmForm, 'name' | 'status' | 'action' | 'position' | 'deletedAt'>
  > & {
    fields?: Prisma.InputJsonValue
  },
) {
  return prisma.crmForm.create({
    data: {
      name: 'Seed Form',
      publicToken: createId(),
      workspaceId,
      createdById,
      ...overrides,
    },
  })
}

export function createFakeCrmFormSubmission(
  overrides?: Partial<CrmFormSubmission>,
): CrmFormSubmission {
  return {
    id: createId(),
    formId: createId(),
    values: { name: 'Jane' },
    action: 'LEAD',
    createdPersonId: null,
    createdCompanyId: null,
    createdLeadId: null,
    ipHash: null,
    referrer: null,
    createdAt: new Date(),
    ...overrides,
  }
}

export function createFakeCrmFormSubmissionDTO(
  overrides?: Partial<CrmFormSubmissionDTO>,
): CrmFormSubmissionDTO {
  return {
    id: createId(),
    formId: createId(),
    values: { name: 'Jane' },
    action: 'LEAD',
    createdPersonId: null,
    createdCompanyId: null,
    createdLeadId: null,
    referrer: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}
