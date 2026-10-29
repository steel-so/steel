import { createId } from '@paralleldrive/cuid2'
import { prisma } from '@/src/lib/prisma'
import type { SdSwarmRow } from '@/src/repositories/sd-swarm.repository'

const fixed = () => new Date('2026-10-29T12:00:00.000Z')

function user(id: string, name: string) {
  return { id, name, email: `${id}@example.com`, image: null }
}

/** Swarm with the relations of the repository include (unit tests). */
export function createFakeSdSwarm(overrides?: Partial<SdSwarmRow>): SdSwarmRow {
  const id = overrides?.id ?? createId()
  return {
    id,
    workspaceId: 'ws1',
    ticketId: 't1',
    status: 'OPEN',
    reason: 'Queda intermitente do link',
    outcome: null,
    slackChannelId: null,
    slackChannelName: null,
    slackError: null,
    slackArchivedAt: null,
    startedById: 'agent',
    closedById: null,
    startedAt: fixed(),
    closedAt: null,
    startedBy: user('agent', 'Ana Agente'),
    closedBy: null,
    members: [
      {
        swarmId: id,
        userId: 's1',
        status: 'INVITED',
        invitedById: 'agent',
        invitedAt: fixed(),
        respondedAt: null,
        user: user('s1', 'Rui Rede'),
      },
    ],
    ...overrides,
  }
}

export async function seedSdSwarm(
  workspaceId: string,
  ticketId: string,
  startedById: string,
  memberIds: string[],
  status: 'OPEN' | 'CLOSED' = 'OPEN',
) {
  return prisma.sdSwarm.create({
    data: {
      workspaceId,
      ticketId,
      startedById,
      status,
      reason: 'Preciso de ajuda com a rede',
      members: {
        create: memberIds.map((userId) => ({
          userId,
          invitedById: startedById,
        })),
      },
    },
  })
}
