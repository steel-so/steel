import type { Role } from '@prisma/client'
import {
  type ConversationVisibilityTarget,
  canSeeConversation,
  scopeFromSnapshot,
  type WhatsAppTeamSnapshot,
} from './conversation-scope'

/**
 * Who the supervisors of the Comunicação module are for a notice about one
 * conversation — shared by the sentiment alert and the unassigned-conversation
 * alerts (ADR 0047), so the rule lives in one place:
 *
 * - the configured list (`configuredIds`) when it is not empty, else every
 *   OWNER/ADMIN of the workspace;
 * - plus `extraUserIds` (for instance the leaders of the conversation's team);
 * - and never someone who cannot see the conversation (Equipes): the notice
 *   carries the contact name and a link to it.
 */
export interface SupervisorCandidate {
  userId: string
  role: Role
}

export function filterSupervisorRecipients<
  T extends SupervisorCandidate,
>(input: {
  members: T[]
  configuredIds: string[]
  extraUserIds?: string[]
  target: ConversationVisibilityTarget
  teams: WhatsAppTeamSnapshot[]
}): T[] {
  const configured = new Set(input.configuredIds)
  const extra = new Set(input.extraUserIds ?? [])
  return input.members
    .filter((member) => {
      if (extra.has(member.userId)) return true
      return configured.size > 0
        ? configured.has(member.userId)
        : member.role === 'OWNER' || member.role === 'ADMIN'
    })
    .filter((member) =>
      canSeeConversation(
        scopeFromSnapshot(member.userId, member.role, input.teams),
        input.target,
      ),
    )
}

/** Leaders of one team, from the cached snapshot. */
export function teamLeaderIds(
  teams: WhatsAppTeamSnapshot[],
  teamId: string | null,
): string[] {
  if (!teamId) return []
  const team = teams.find((candidate) => candidate.id === teamId)
  return team
    ? team.members
        .filter((member) => member.role === 'LEADER')
        .map((member) => member.userId)
    : []
}
