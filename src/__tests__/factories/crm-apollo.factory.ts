import { createId } from '@paralleldrive/cuid2'
import type { CrmApolloImport, WorkspaceIntegration } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { createFakeWorkspaceIntegration } from './sd-integration.factory'

export function createFakeApolloIntegration(
  overrides?: Partial<WorkspaceIntegration>,
): WorkspaceIntegration {
  return createFakeWorkspaceIntegration({
    id: 'int-apollo-1',
    kind: 'APOLLO',
    externalId: 'apollo',
    externalName: '••••ab12',
    encryptedToken: 'enc:apollo-key',
    ...overrides,
  })
}

export function createFakeCrmApolloImport(
  overrides?: Partial<CrmApolloImport>,
): CrmApolloImport {
  const now = new Date('2026-10-19T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: 'ws1',
    createdById: 'u1',
    status: 'QUEUED',
    source: 'SEARCH',
    filters: {},
    apolloIds: ['a1', 'a2'],
    contacts: null,
    mailingListId: null,
    requestedCount: 2,
    createdCount: 0,
    skippedCount: 0,
    failedCount: 0,
    cursor: 0,
    creditsConsumed: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmApolloImport(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmApolloImport,
      'status' | 'source' | 'apolloIds' | 'requestedCount' | 'mailingListId'
    >
  >,
) {
  return prisma.crmApolloImport.create({
    data: {
      workspaceId,
      createdById,
      source: 'SEARCH',
      apolloIds: ['a1'],
      requestedCount: 1,
      ...overrides,
    },
  })
}
