import { createId } from '@paralleldrive/cuid2'
import type { WorkspaceAccessLog } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export function createFakeWorkspaceAccessLog(
  overrides?: Partial<WorkspaceAccessLog>,
): WorkspaceAccessLog {
  return {
    id: createId(),
    workspaceId: createId(),
    userId: createId(),
    userEmail: 'ana@acme.com.br',
    userName: 'Ana Souza',
    ip: '200.1.2.3',
    userAgent: 'Mozilla/5.0',
    outcome: 'ALLOWED',
    surface: 'APP',
    path: '/acme/home',
    createdAt: new Date('2026-10-27T13:00:00.000Z'),
    ...overrides,
  }
}

export async function seedWorkspaceAccessLog(
  workspaceId: string,
  overrides?: Partial<Omit<WorkspaceAccessLog, 'id' | 'workspaceId'>>,
): Promise<WorkspaceAccessLog> {
  const { id: _id, ...fake } = createFakeWorkspaceAccessLog(overrides)
  return prisma.workspaceAccessLog.create({
    data: { ...fake, workspaceId },
  })
}
