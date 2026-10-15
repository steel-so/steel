import type { Role, WhatsAppTeamRole } from '@prisma/client'
import type { WhatsAppConversationScopeDTO } from '@/types/whatsapp-team'

/**
 * Who sees which Comunicação conversation (Equipes). Pure rules — the
 * resolution (membership role + team snapshot) lives in
 * `src/services/whatsapp-conversation-scope.service.ts`.
 *
 * - OWNER sees everything;
 * - ADMIN sees everything unless they belong to some team;
 * - everyone else ("scoped") sees: conversations assigned to them; the ones
 *   assigned to agents of the teams they lead and the ones whose team they
 *   lead; and the queue — unassigned conversations without a team or with a
 *   team they belong to.
 */

/** Team membership of a workspace, as cached for the scope resolution. */
export interface WhatsAppTeamSnapshot {
  id: string
  members: { userId: string; role: WhatsAppTeamRole }[]
}

export interface WhatsAppConversationScope {
  mode: 'ALL' | 'SCOPED'
  userId: string
  /** Teams the viewer leads. */
  leadsTeamIds: string[]
  /** Teams the viewer belongs to (any role). */
  memberTeamIds: string[]
  /** Agents of the teams the viewer leads (the viewer excluded). */
  ledAgentIds: string[]
  /** Every member of the teams the viewer leads — who they may assign to. */
  ledTeamMemberIds: string[]
}

/** The two fields of a conversation the rule looks at. */
export interface ConversationVisibilityTarget {
  assignedUserId: string | null
  teamId: string | null
}

/** Filter a scoped viewer applies to the conversation list. */
export interface WhatsAppConversationVisibility {
  userId: string
  ledAgentIds: string[]
  leadsTeamIds: string[]
  memberTeamIds: string[]
}

export function scopeFromSnapshot(
  userId: string,
  role: Role,
  teams: WhatsAppTeamSnapshot[],
): WhatsAppConversationScope {
  const leadsTeamIds: string[] = []
  const memberTeamIds: string[] = []
  const ledAgents = new Set<string>()
  const ledMembers = new Set<string>()

  for (const team of teams) {
    const own = team.members.find((member) => member.userId === userId)
    if (!own) continue
    memberTeamIds.push(team.id)
    if (own.role !== 'LEADER') continue
    leadsTeamIds.push(team.id)
    for (const member of team.members) {
      ledMembers.add(member.userId)
      if (member.role === 'AGENT' && member.userId !== userId) {
        ledAgents.add(member.userId)
      }
    }
  }

  const unscoped =
    role === 'OWNER' || (role === 'ADMIN' && memberTeamIds.length === 0)

  return {
    mode: unscoped ? 'ALL' : 'SCOPED',
    userId,
    leadsTeamIds,
    memberTeamIds,
    ledAgentIds: [...ledAgents],
    ledTeamMemberIds: [...ledMembers],
  }
}

export function canSeeConversation(
  scope: WhatsAppConversationScope,
  conversation: ConversationVisibilityTarget,
): boolean {
  if (scope.mode === 'ALL') return true
  const { assignedUserId, teamId } = conversation
  if (assignedUserId) {
    return (
      assignedUserId === scope.userId ||
      scope.ledAgentIds.includes(assignedUserId) ||
      (teamId !== null && scope.leadsTeamIds.includes(teamId))
    )
  }
  return teamId === null || scope.memberTeamIds.includes(teamId)
}

/** `undefined` = no restriction (the viewer sees every conversation). */
export function scopeVisibility(
  scope: WhatsAppConversationScope,
): WhatsAppConversationVisibility | undefined {
  if (scope.mode === 'ALL') return undefined
  return {
    userId: scope.userId,
    ledAgentIds: scope.ledAgentIds,
    leadsTeamIds: scope.leadsTeamIds,
    memberTeamIds: scope.memberTeamIds,
  }
}

export function toWhatsAppConversationScopeDTO(
  scope: WhatsAppConversationScope,
): WhatsAppConversationScopeDTO {
  return {
    mode: scope.mode,
    leadsTeamIds: scope.leadsTeamIds,
    memberTeamIds: scope.memberTeamIds,
  }
}

/**
 * May the viewer move the conversation from `current` to `next` assignee?
 * Unscoped viewers assign freely. A leader assigns inside the teams they lead
 * (themselves, nobody, or a member of a led team); an agent only takes an
 * unassigned queue item or hands their own conversation back.
 */
export function canAssignConversation(
  scope: WhatsAppConversationScope,
  current: ConversationVisibilityTarget,
  nextAssigneeId: string | null,
): boolean {
  if (scope.mode === 'ALL') return true
  if (!canSeeConversation(scope, current)) return false

  const takesFromQueue =
    current.assignedUserId === null && nextAssigneeId === scope.userId
  const handsBack =
    current.assignedUserId === scope.userId && nextAssigneeId === null
  if (takesFromQueue || handsBack) return true

  if (scope.leadsTeamIds.length === 0) return false
  return (
    nextAssigneeId === null ||
    nextAssigneeId === scope.userId ||
    scope.ledTeamMemberIds.includes(nextAssigneeId)
  )
}

/**
 * May the viewer move the conversation between teams? Unscoped viewers move
 * freely; a leader moves between the teams they lead (or to/from no team).
 */
export function canChangeConversationTeam(
  scope: WhatsAppConversationScope,
  current: ConversationVisibilityTarget,
  nextTeamId: string | null,
): boolean {
  if (scope.mode === 'ALL') return true
  if (!canSeeConversation(scope, current)) return false
  const ledOrNone = (teamId: string | null) =>
    teamId === null || scope.leadsTeamIds.includes(teamId)
  return (
    scope.leadsTeamIds.length > 0 &&
    ledOrNone(current.teamId) &&
    ledOrNone(nextTeamId)
  )
}
