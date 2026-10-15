import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { badRequest, validationError, whatsappTeamNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { toWhatsAppConversationScopeDTO } from '@/src/lib/whatsapp/conversation-scope'
import { toWhatsAppTeamDTO } from '@/src/mappers/whatsapp-team.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import {
  type WhatsAppTeamMemberInput,
  WhatsAppTeamRepository,
} from '@/src/repositories/whatsapp-team.repository'
import type {
  CreateWhatsAppTeamInput,
  UpdateWhatsAppTeamInput,
} from '@/src/schemas/whatsapp-team.schema'
import type {
  WhatsAppConversationScopeDTO,
  WhatsAppTeamDTO,
} from '@/types/whatsapp-team'
import { assertModuleMember, assertModulePrivileged } from './authz'
import {
  invalidateWhatsAppTeamSnapshot,
  resolveConversationScope,
  whatsAppTeamMemberIds,
} from './whatsapp-conversation-scope.service'
import {
  notifyWhatsAppUsers,
  whatsAppConversationPath,
} from './whatsapp-notify'

const MODULE = 'COMMUNICATION' as const

/**
 * Members must be workspace members and appear once. Returns the list as
 * stored (role defaulted by the schema).
 */
async function validateMembers(
  workspaceId: string,
  members: WhatsAppTeamMemberInput[],
): Promise<Result<WhatsAppTeamMemberInput[]>> {
  const ids = members.map((member) => member.userId)
  if (new Set(ids).size !== ids.length) {
    return err(validationError('Um membro aparece mais de uma vez na equipe'))
  }
  if (members.length === 0) return ok(members)

  const workspaceMembers =
    await MembershipRepository.listWithUserByWorkspace(workspaceId)
  if (!workspaceMembers.ok) return workspaceMembers
  const known = new Set(workspaceMembers.value.map((m) => m.userId))
  if (ids.some((id) => !known.has(id))) {
    return err(badRequest('Usuário informado não pertence a este workspace'))
  }
  return ok(members)
}

export const WhatsAppTeamService = {
  /** Every module member reads the teams (filters, badges, pickers). */
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppTeamDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, MODULE, {
      resource: 'conversations',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const teams = await WhatsAppTeamRepository.listByWorkspace(workspaceId)
    if (!teams.ok) return teams
    return ok(teams.value.map(toWhatsAppTeamDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    teamId: string,
  ): Promise<Result<WhatsAppTeamDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, MODULE, {
      resource: 'conversations',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const team = await WhatsAppTeamRepository.findById(teamId, workspaceId)
    if (!team.ok) return team
    if (!team.value) return err(whatsappTeamNotFound())
    return ok(toWhatsAppTeamDTO(team.value))
  },

  /** How the actor sees conversations (`GET .../teams/me`). */
  async me(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppConversationScopeDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, MODULE, {
      resource: 'conversations',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const scope = await resolveConversationScope(
      actorId,
      workspaceId,
      membership.value.role,
    )
    if (!scope.ok) return scope
    return ok(toWhatsAppConversationScopeDTO(scope.value))
  },

  /** Only OWNER/ADMIN manage teams — leaders cannot edit membership. */
  async create(
    actorId: string,
    workspaceId: string,
    input: CreateWhatsAppTeamInput,
  ): Promise<Result<WhatsAppTeamDTO>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      MODULE,
    )
    if (!membership.ok) return membership

    const members = await validateMembers(workspaceId, input.members)
    if (!members.ok) return members

    const created = await WhatsAppTeamRepository.create({
      workspaceId,
      name: input.name,
      description: input.description ?? null,
      members: members.value,
    })
    if (!created.ok) return created
    await invalidateWhatsAppTeamSnapshot(workspaceId)

    auditMutation({
      entity: 'whatsapp_team',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, members: members.value.length },
    })
    logger.info('whatsapp.team.created', {
      component: 'WhatsAppTeamService',
      workspaceId,
      teamId: created.value.id,
      members: members.value.length,
    })
    return ok(toWhatsAppTeamDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    teamId: string,
    input: UpdateWhatsAppTeamInput,
  ): Promise<Result<WhatsAppTeamDTO>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      MODULE,
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppTeamRepository.findById(teamId, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappTeamNotFound())

    let members: WhatsAppTeamMemberInput[] | undefined
    if (input.members) {
      const validated = await validateMembers(workspaceId, input.members)
      if (!validated.ok) return validated
      members = validated.value
    }

    const updated = await WhatsAppTeamRepository.update(teamId, {
      name: input.name,
      description: input.description,
      members,
    })
    if (!updated.ok) return updated
    await invalidateWhatsAppTeamSnapshot(workspaceId)

    auditMutation({
      entity: 'whatsapp_team',
      action: 'update',
      actorId,
      targetId: teamId,
      meta: {
        workspaceId,
        fields: Object.keys(input),
        ...(members ? { members: members.length } : {}),
      },
    })
    return ok(toWhatsAppTeamDTO(updated.value))
  },

  /** The team's conversations stay, without a team (back to the queue). */
  async remove(
    actorId: string,
    workspaceId: string,
    teamId: string,
  ): Promise<Result<{ id: string }>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      MODULE,
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppTeamRepository.findById(teamId, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappTeamNotFound())

    const removed = await WhatsAppTeamRepository.delete(teamId)
    if (!removed.ok) return removed
    await invalidateWhatsAppTeamSnapshot(workspaceId)

    auditMutation({
      entity: 'whatsapp_team',
      action: 'delete',
      actorId,
      targetId: teamId,
      meta: { workspaceId },
    })
    return ok({ id: teamId })
  },

  /**
   * An inbound message landed on an unassigned conversation of a team (and
   * the AI is not answering it): the team hears about it — once per unread
   * streak (first unread message), never per message. System flow; never
   * fails the webhook.
   */
  async notifyQueueOnInbound(
    workspaceId: string,
    conversationId: string,
  ): Promise<void> {
    const found = await WhatsAppConversationRepository.findById(
      conversationId,
      workspaceId,
    )
    if (!found.ok || !found.value) return
    const conversation = found.value
    if (
      !conversation.teamId ||
      conversation.assignedUserId ||
      conversation.aiActive ||
      conversation.status === 'CLOSED' ||
      conversation.unreadCount !== 1
    ) {
      return
    }

    const userIds = await whatsAppTeamMemberIds(
      workspaceId,
      conversation.teamId,
    )
    const contact = conversation.contact
    await notifyWhatsAppUsers({
      workspaceId,
      kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
      userIds,
      title:
        `Nova mensagem na fila da equipe ${conversation.team?.name ?? ''}`.trim(),
      body: `${contact.name ?? contact.waId} aguarda atendimento.`,
      path: whatsAppConversationPath(conversationId),
      meta: { conversationId, teamId: conversation.teamId, via: 'team_queue' },
    })
  },
}
