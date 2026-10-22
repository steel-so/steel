import type { Role, WhatsAppConversation } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { isWithinBusinessHours } from '@/src/lib/whatsapp/business-hours'
import {
  type DistributionCandidate,
  type DistributionSkipReason,
  pickAssignee,
} from '@/src/lib/whatsapp/distribution-picker'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppSettingsDTO } from '@/src/mappers/whatsapp-settings.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppAgentPresenceRepository } from '@/src/repositories/whatsapp-agent-presence.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppDistributionRepository } from '@/src/repositories/whatsapp-distribution.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type { WhatsAppSettingsDTO } from '@/types/whatsapp-settings'
import { loadWhatsAppTeamSnapshot } from './whatsapp-conversation-scope.service'
import {
  notifyWhatsAppUsers,
  whatsAppConversationPath,
} from './whatsapp-notify'

/** Conversations the queue drain looks at per run (bounded on purpose). */
export const WHATSAPP_DISTRIBUTION_DRAIN_LIMIT = 25

export type WhatsAppDistributionOutcome =
  | { assigned: true; userId: string }
  | {
      assigned: false
      reason:
        | 'disabled'
        | 'not_eligible'
        | 'outside_business_hours'
        | 'already_assigned'
        | DistributionSkipReason
    }

interface Pool {
  teamId: string | null
  candidates: { userId: string; name: string }[]
}

/**
 * Who may receive a conversation of `teamId` (ADR 0047):
 * - with a team: its members (agents and leaders) that are still workspace
 *   members and are not VIEWERs — an admin who sits in the team is a member;
 * - without a team: the workspace members with the MEMBER role (owners and
 *   admins supervise the queue, they are not part of the rotation).
 */
function resolvePool(
  members: { userId: string; role: Role; user: { name: string } }[],
  teams: { id: string; members: { userId: string }[] }[],
  teamId: string | null,
): Pool {
  const byId = new Map(members.map((member) => [member.userId, member]))
  if (teamId) {
    const team = teams.find((candidate) => candidate.id === teamId)
    const candidates = (team?.members ?? [])
      .map((member) => byId.get(member.userId))
      .filter(
        (member): member is NonNullable<typeof member> =>
          member !== undefined && member.role !== 'VIEWER',
      )
      .map((member) => ({ userId: member.userId, name: member.user.name }))
    return { teamId, candidates }
  }
  return {
    teamId: null,
    candidates: members
      .filter((member) => member.role === 'MEMBER')
      .map((member) => ({ userId: member.userId, name: member.user.name })),
  }
}

function isAwaiting(conversation: {
  status: string
  assignedUserId: string | null
  aiActive: boolean
  archivedAt: Date | null
  deletedAt: Date | null
}): boolean {
  return (
    conversation.status !== 'CLOSED' &&
    conversation.assignedUserId === null &&
    !conversation.aiActive &&
    conversation.archivedAt === null &&
    conversation.deletedAt === null
  )
}

export const WhatsAppDistributionService = {
  /**
   * Gives one waiting conversation to an agent, by the workspace's mode.
   * System flow (webhook, tick, presence change): never throws; a human's
   * assignment always wins because the write is conditional on the
   * conversation still being unassigned. `settings` lets a drain reuse one
   * read for many conversations.
   */
  async distributeConversation(
    workspaceId: string,
    conversationId: string,
    options: { now?: Date; settings?: WhatsAppSettingsDTO } = {},
  ): Promise<Result<WhatsAppDistributionOutcome>> {
    const now = options.now ?? new Date()

    let settings = options.settings
    if (!settings) {
      const row = await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
      if (!row.ok) return row
      settings = toWhatsAppSettingsDTO(workspaceId, row.value)
    }
    if (settings.distributionMode === 'OFF') {
      return ok({ assigned: false, reason: 'disabled' })
    }

    const found = await WhatsAppConversationRepository.findById(
      conversationId,
      workspaceId,
    )
    if (!found.ok) return found
    const conversation = found.value
    if (!conversation || !isAwaiting(conversation)) {
      return ok({ assigned: false, reason: 'not_eligible' })
    }

    if (
      settings.distributionRespectBusinessHours &&
      !isWithinBusinessHours(
        {
          enabled: settings.businessHoursEnabled,
          start: settings.businessHoursStart,
          end: settings.businessHoursEnd,
          days: settings.businessHoursDays,
        },
        now,
      )
    ) {
      return ok({ assigned: false, reason: 'outside_business_hours' })
    }

    const members =
      await MembershipRepository.listWithUserByWorkspace(workspaceId)
    if (!members.ok) return members
    const teams = await loadWhatsAppTeamSnapshot(workspaceId)
    if (!teams.ok) return teams
    const pool = resolvePool(members.value, teams.value, conversation.teamId)
    const mode = settings.distributionMode

    // One lock per workspace: the pick (loads, pointer) and the claim of the
    // conversation can't interleave with another message's pick.
    const picked = await WhatsAppDistributionRepository.withLock(
      `whatsapp-distribution:${workspaceId}`,
      async (): Promise<
        Result<WhatsAppDistributionOutcome & { name?: string }>
      > => {
        const ids = pool.candidates.map((candidate) => candidate.userId)
        const [counts, presence, pointer] = await Promise.all([
          WhatsAppConversationRepository.countOpenByAssignees(workspaceId, ids),
          WhatsAppAgentPresenceRepository.list(workspaceId, ids),
          readPointer(workspaceId, pool.teamId),
        ])
        if (!counts.ok) return counts
        if (!presence.ok) return presence
        if (!pointer.ok) return pointer

        const presenceByUser = new Map(
          presence.value.map((row) => [row.userId, row]),
        )
        const candidates: DistributionCandidate[] = ids.map((userId) => {
          const row = presenceByUser.get(userId)
          return {
            userId,
            openCount: counts.value.get(userId) ?? 0,
            available: !row || row.status === 'AVAILABLE',
            lastAssignedAt: row?.lastAssignedAt ?? null,
          }
        })
        const pick = pickAssignee({
          mode,
          candidates,
          maxOpenPerAgent: settings.distributionMaxOpenPerAgent,
          onlyAvailable: settings.distributionOnlyAvailable,
          lastAssignedUserId: pointer.value,
        })
        if (pick.userId === null) {
          return ok({ assigned: false, reason: pick.reason })
        }

        const claimed = await WhatsAppConversationRepository.claimForAssignment(
          conversationId,
          workspaceId,
          pick.userId,
        )
        if (!claimed.ok) return claimed
        if (!claimed.value) {
          return ok({ assigned: false, reason: 'already_assigned' })
        }

        const moved = await (pool.teamId
          ? WhatsAppDistributionRepository.setTeamPointer(
              pool.teamId,
              pick.userId,
            )
          : WhatsAppDistributionRepository.setWorkspacePointer(
              workspaceId,
              pick.userId,
            ))
        if (!moved.ok) {
          logger.warn('whatsapp.distribution.pointer_failed', {
            component: 'WhatsAppDistributionService',
            workspaceId,
            reason: moved.error.code,
          })
        }
        const touched = await WhatsAppAgentPresenceRepository.touchLastAssigned(
          workspaceId,
          pick.userId,
          now,
        )
        if (!touched.ok) {
          logger.warn('whatsapp.distribution.last_assigned_failed', {
            component: 'WhatsAppDistributionService',
            workspaceId,
            reason: touched.error.code,
          })
        }
        const name = pool.candidates.find(
          (candidate) => candidate.userId === pick.userId,
        )?.name
        return ok({ assigned: true, userId: pick.userId, name })
      },
    )
    if (!picked.ok) return picked
    if (!picked.value.assigned) {
      return ok({ assigned: false, reason: picked.value.reason })
    }

    await afterAssigned({
      workspaceId,
      conversation,
      userId: picked.value.userId,
      userName: picked.value.name ?? null,
      mode,
    })
    return ok({ assigned: true, userId: picked.value.userId })
  },

  /**
   * Hands the waiting conversations (oldest in the queue first) to the
   * agents that can take them now — called when an agent turns Disponível
   * and by the tick, so a queue held by business hours or by full agents
   * drains by itself. Bounded by `limit`.
   */
  async drainQueue(
    workspaceId: string,
    options: { limit?: number; now?: Date } = {},
  ): Promise<Result<{ assigned: number; examined: number }>> {
    const row = await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    const settings = toWhatsAppSettingsDTO(workspaceId, row.value)
    if (settings.distributionMode === 'OFF') {
      return ok({ assigned: 0, examined: 0 })
    }

    const queue = await WhatsAppConversationRepository.listAwaitingDistribution(
      workspaceId,
      options.limit ?? WHATSAPP_DISTRIBUTION_DRAIN_LIMIT,
    )
    if (!queue.ok) return queue

    let assigned = 0
    for (const conversation of queue.value) {
      const outcome = await this.distributeConversation(
        workspaceId,
        conversation.id,
        { now: options.now, settings },
      )
      if (!outcome.ok) {
        logger.warn('whatsapp.distribution.drain_item_failed', {
          component: 'WhatsAppDistributionService',
          workspaceId,
          conversationId: conversation.id,
          reason: outcome.error.code,
        })
        continue
      }
      if (outcome.value.assigned) {
        assigned += 1
      } else if (outcome.value.reason === 'outside_business_hours') {
        break
      }
    }
    return ok({ assigned, examined: queue.value.length })
  },

  /**
   * Tick: drains the queue of every workspace that turned the distribution
   * on and still has the Comunicação module. One workspace failing does not
   * stop the others.
   */
  async drainEnabledWorkspaces(
    now: Date = new Date(),
  ): Promise<Result<{ assigned: number; workspaces: number }>> {
    const ids = await WhatsAppDistributionRepository.listEnabledWorkspaceIds()
    if (!ids.ok) return ids

    let assigned = 0
    let workspaces = 0
    for (const workspaceId of ids.value) {
      const access = await WorkspaceModuleAccessRepository.isEnabled(
        workspaceId,
        'COMMUNICATION',
      )
      if (!access.ok || !access.value) continue
      workspaces += 1
      const drained = await this.drainQueue(workspaceId, { now })
      if (!drained.ok) {
        logger.warn('whatsapp.distribution.tick_workspace_failed', {
          component: 'WhatsAppDistributionService',
          workspaceId,
          reason: drained.error.code,
        })
        continue
      }
      assigned += drained.value.assigned
    }
    return ok({ assigned, workspaces })
  },
}

async function readPointer(
  workspaceId: string,
  teamId: string | null,
): Promise<Result<string | null>> {
  if (teamId) return WhatsAppDistributionRepository.getTeamPointer(teamId)
  const row = await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
  if (!row.ok) return row
  return ok(row.value?.distributionLastAssignedUserId ?? null)
}

/** Timeline, audit, realtime and the assignee's notice. Never fails the flow. */
async function afterAssigned(input: {
  workspaceId: string
  conversation: WhatsAppConversation & {
    contact: { name: string | null; waId: string }
  }
  userId: string
  userName: string | null
  mode: string
}): Promise<void> {
  const { workspaceId, conversation, userId } = input
  const event = await WhatsAppConversationEventRepository.create({
    workspaceId,
    conversationId: conversation.id,
    kind: 'ASSIGNED',
    source: 'DISTRIBUTION',
    actorUserId: null,
    reason: input.userName,
  })
  if (!event.ok) {
    logger.error('whatsapp.distribution.event_failed', {
      component: 'WhatsAppDistributionService',
      workspaceId,
      conversationId: conversation.id,
      reason: event.error.code,
    })
  }

  auditMutation({
    entity: 'whatsapp_conversation',
    action: 'assign',
    actorId: null,
    targetId: conversation.id,
    meta: {
      workspaceId,
      assignedUserId: userId,
      via: 'distribution',
      mode: input.mode,
      actor: 'system',
    },
  })

  const fresh = await WhatsAppConversationRepository.findById(
    conversation.id,
    workspaceId,
  )
  if (fresh.ok && fresh.value) {
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: toWhatsAppConversationDTO(fresh.value),
    })
  }

  const label = conversation.contact.name ?? conversation.contact.waId
  await notifyWhatsAppUsers({
    workspaceId,
    kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
    userIds: [userId],
    title: 'Nova conversa para você',
    body: `A conversa com ${label} foi encaminhada para você pela distribuição automática.`,
    path: whatsAppConversationPath(conversation.id),
    meta: { conversationId: conversation.id, via: 'distribution' },
  })
}
