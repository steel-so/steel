import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppTeamRole } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { WhatsAppTeamWithMembers } from '@/src/repositories/whatsapp-team.repository'

export function createFakeWhatsAppTeam(
  overrides?: Partial<Omit<WhatsAppTeamWithMembers, 'members'>> & {
    members?: { userId: string; role?: WhatsAppTeamRole; name?: string }[]
  },
): WhatsAppTeamWithMembers {
  const now = new Date()
  const { members = [], ...teamOverrides } = overrides ?? {}
  const id = teamOverrides.id ?? createId()
  return {
    id,
    workspaceId: createId(),
    name: 'Vendas',
    description: null,
    distributionLastAssignedUserId: null,
    createdAt: now,
    updatedAt: now,
    ...teamOverrides,
    members: members.map((member) => ({
      id: createId(),
      teamId: id,
      userId: member.userId,
      role: member.role ?? 'AGENT',
      createdAt: now,
      user: {
        id: member.userId,
        name: member.name ?? member.userId,
        email: `${member.userId}@stratus.test`,
        image: null,
      },
    })),
  }
}

export async function seedWhatsAppTeam(data: {
  workspaceId: string
  name?: string
  members?: { userId: string; role?: WhatsAppTeamRole }[]
}) {
  return prisma.whatsAppTeam.create({
    data: {
      workspaceId: data.workspaceId,
      name: data.name ?? `Equipe ${createId().slice(0, 6)}`,
      members: {
        create: (data.members ?? []).map((member) => ({
          userId: member.userId,
          role: member.role ?? 'AGENT',
        })),
      },
    },
  })
}
