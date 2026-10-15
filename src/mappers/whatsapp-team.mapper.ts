import type { WhatsAppTeamWithMembers } from '@/src/repositories/whatsapp-team.repository'
import type { WhatsAppTeamDTO } from '@/types/whatsapp-team'

/** Leaders first, then agents, each group by name. */
export function toWhatsAppTeamDTO(
  team: WhatsAppTeamWithMembers,
): WhatsAppTeamDTO {
  const members = team.members
    .map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      role: member.role,
    }))
    .sort((a, b) =>
      a.role === b.role
        ? a.name.localeCompare(b.name, 'pt-BR')
        : a.role === 'LEADER'
          ? -1
          : 1,
    )

  return {
    id: team.id,
    workspaceId: team.workspaceId,
    name: team.name,
    description: team.description,
    members,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  }
}
