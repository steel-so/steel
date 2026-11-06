import {
  canAssignConversation,
  canChangeConversationTeam,
  scopeFromSnapshot,
  type WhatsAppConversationScope,
} from '@/src/lib/whatsapp/conversation-scope'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type {
  WhatsAppConversationScopeDTO,
  WhatsAppTeamDTO,
} from '@/types/whatsapp-team'

/**
 * Client mirror of the Equipes rule, so the UI only offers what the API
 * accepts (the API still decides). `ALL` behaves like the owner and
 * `SCOPED` like a member — the team snapshot does the rest.
 */
export function clientConversationScope(
  scope: WhatsAppConversationScopeDTO | undefined,
  teams: WhatsAppTeamDTO[] | undefined,
  userId: string | undefined,
): WhatsAppConversationScope | null {
  if (!scope || !userId) return null
  return scopeFromSnapshot(
    userId,
    scope.mode === 'ALL' ? 'OWNER' : 'MEMBER',
    (teams ?? []).map((team) => ({
      id: team.id,
      members: team.members.map(({ userId, role }) => ({ userId, role })),
    })),
  )
}

/** Members the viewer may assign this conversation to (`null` = queue). */
export function canAssignTo(
  scope: WhatsAppConversationScope | null,
  conversation: Pick<WhatsAppConversationDTO, 'assignedUserId' | 'teamId'>,
  nextAssigneeId: string | null,
): boolean {
  // Scope still loading: let the API answer.
  if (!scope) return true
  return canAssignConversation(scope, conversation, nextAssigneeId)
}

/** Teams the viewer may move this conversation to (`null` = no team). */
export function canMoveToTeam(
  scope: WhatsAppConversationScope | null,
  conversation: Pick<WhatsAppConversationDTO, 'assignedUserId' | 'teamId'>,
  nextTeamId: string | null,
): boolean {
  if (!scope) return false
  return canChangeConversationTeam(scope, conversation, nextTeamId)
}

/** Inbox filter: everything, mine, the queue (unassigned) or one team. */
export type WhatsAppInboxFilter = 'all' | 'mine' | 'queue' | `team:${string}`

/**
 * A team filter shows the conversations placed in the team and the ones
 * assigned to one of its members — most workspaces assign agents directly and
 * never set a team on the conversation, so matching `teamId` alone left the
 * filter empty.
 */
export function matchesInboxFilter(
  conversation: Pick<WhatsAppConversationDTO, 'assignedUserId' | 'teamId'>,
  filter: WhatsAppInboxFilter,
  userId: string | undefined,
  teams: { id: string; members: { userId: string }[] }[] = [],
): boolean {
  if (filter === 'all') return true
  if (filter === 'mine') return conversation.assignedUserId === userId
  if (filter === 'queue') return conversation.assignedUserId === null
  const teamId = filter.slice('team:'.length)
  if (conversation.teamId === teamId) return true
  if (!conversation.assignedUserId) return false
  const team = teams.find((candidate) => candidate.id === teamId)
  return Boolean(
    team?.members.some(
      (member) => member.userId === conversation.assignedUserId,
    ),
  )
}
