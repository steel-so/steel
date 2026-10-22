import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { forbidden } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { toWhatsAppPresenceDTO } from '@/src/mappers/whatsapp-presence.mapper'
import { WhatsAppAgentPresenceRepository } from '@/src/repositories/whatsapp-agent-presence.repository'
import type {
  WhatsAppPresenceDTO,
  WhatsAppPresenceStatusDTO,
} from '@/types/whatsapp-presence'
import { assertModuleMember } from './authz'
import {
  loadWhatsAppTeamSnapshot,
  resolveConversationScope,
} from './whatsapp-conversation-scope.service'
import { WhatsAppDistributionService } from './whatsapp-distribution.service'

const MODULE = 'COMMUNICATION' as const

/**
 * Manual presence of the agents (ADR 0047): Disponível / Ausente. It only
 * matters to the automatic distribution; nothing flips it by itself.
 */
export const WhatsAppPresenceService = {
  async getMine(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPresenceDTO>> {
    const access = await assertModuleMember(actorId, workspaceId, MODULE, {
      resource: 'conversations',
      action: 'VIEW',
    })
    if (!access.ok) return access

    const row = await WhatsAppAgentPresenceRepository.find(workspaceId, actorId)
    if (!row.ok) return row
    return ok(toWhatsAppPresenceDTO(actorId, row.value))
  },

  async setMine(
    actorId: string,
    workspaceId: string,
    status: WhatsAppPresenceStatusDTO,
  ): Promise<Result<WhatsAppPresenceDTO>> {
    const access = await assertModuleMember(actorId, workspaceId, MODULE, {
      resource: 'conversations',
      action: 'EDIT',
    })
    if (!access.ok) return access

    const previous = await WhatsAppAgentPresenceRepository.find(
      workspaceId,
      actorId,
    )
    if (!previous.ok) return previous

    const saved = await WhatsAppAgentPresenceRepository.setStatus(
      workspaceId,
      actorId,
      status,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_agent_presence',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, status },
    })

    // Back from away with people waiting: the queue drains to the agents who
    // can take it now (bounded, in the background — the toggle answers fast).
    const wasAway = previous.value?.status === 'AWAY'
    if (status === 'AVAILABLE' && wasAway) {
      void WhatsAppDistributionService.drainQueue(workspaceId).then((drain) => {
        if (!drain.ok) {
          logger.warn('whatsapp.presence.drain_failed', {
            component: 'WhatsAppPresenceService',
            workspaceId,
            reason: drain.error.code,
          })
        }
      })
    }

    return ok(toWhatsAppPresenceDTO(actorId, saved.value))
  },

  /**
   * Presence of the people in teams, for who manages them: OWNER/ADMIN see
   * every team member, a team leader sees the members of the teams they lead.
   */
  async listTeamMembers(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPresenceDTO[]>> {
    const access = await assertModuleMember(actorId, workspaceId, MODULE, {
      resource: 'conversations',
      action: 'VIEW',
    })
    if (!access.ok) return access

    const scope = await resolveConversationScope(
      actorId,
      workspaceId,
      access.value.role,
    )
    if (!scope.ok) return scope
    if (!access.value.isPrivileged && scope.value.leadsTeamIds.length === 0) {
      return err(forbidden())
    }

    const snapshot = await loadWhatsAppTeamSnapshot(workspaceId)
    if (!snapshot.ok) return snapshot
    const userIds = new Set<string>()
    for (const team of snapshot.value) {
      if (
        !access.value.isPrivileged &&
        !scope.value.leadsTeamIds.includes(team.id)
      ) {
        continue
      }
      for (const member of team.members) userIds.add(member.userId)
    }
    const ids = [...userIds]
    if (ids.length === 0) return ok([])

    const rows = await WhatsAppAgentPresenceRepository.list(workspaceId, ids)
    if (!rows.ok) return rows
    const byUser = new Map(rows.value.map((row) => [row.userId, row]))
    return ok(ids.map((id) => toWhatsAppPresenceDTO(id, byUser.get(id))))
  },
}
