import { createId } from '@paralleldrive/cuid2'
import type { Plan, Workspace } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { WorkspaceDTO } from '@/types/workspace'

export function createFakeWorkspace(overrides?: Partial<Workspace>): Workspace {
  const now = new Date()
  return {
    id: createId(),
    name: 'Test Workspace',
    slug: `ws-${createId().slice(0, 8)}`,
    activePlan: 'FREE' as Plan,
    trialEndsAt: null,
    status: 'ACTIVE',
    suspendedAt: null,
    suspendedReason: null,
    suspendedById: null,
    wikiEnabled: false,
    whiteboardEnabled: true,
    logoUrl: null,
    allowedIps: [],
    companySize: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeWorkspaceDTO(
  overrides?: Partial<WorkspaceDTO>,
): WorkspaceDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    name: 'Test Workspace',
    slug: `ws-${createId().slice(0, 8)}`,
    activePlan: 'FREE',
    trialEndsAt: null,
    logoUrl: null,
    companySize: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedWorkspace(
  overrides?: Partial<
    Pick<Workspace, 'name' | 'slug' | 'activePlan' | 'trialEndsAt' | 'status'>
  >,
) {
  return prisma.workspace.create({
    data: {
      name: 'Seed Workspace',
      slug: `seed-ws-${createId().slice(0, 8)}`,
      ...overrides,
    },
  })
}
