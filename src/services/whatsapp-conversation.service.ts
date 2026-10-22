import type {
  Prisma,
  WhatsAppConversation,
  WhatsAppConversationEventSource,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  badRequest,
  forbidden,
  whatsappConnectionNotFound,
  whatsappContactNotFound,
  whatsappConversationAlreadyClosed,
  whatsappConversationNotClosed,
  whatsappConversationNotFound,
  whatsappTeamNotFound,
} from '@/src/errors'
import type { PermissionAction } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  buildWhatsAppConversationExport,
  WHATSAPP_CONVERSATION_EXPORT_MAX_MESSAGES,
  type WhatsAppConversationExportFile,
  type WhatsAppConversationExportFormat,
} from '@/src/lib/whatsapp/conversation-export'
import {
  canAssignConversation,
  canChangeConversationTeam,
  canSeeConversation,
  scopeVisibility,
  type WhatsAppConversationScope,
} from '@/src/lib/whatsapp/conversation-scope'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppConversationEventDTO } from '@/src/mappers/whatsapp-conversation-event.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationStatusFilter,
  type WhatsAppConversationWithPreview,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import type {
  CloseWhatsAppConversationDTO,
  StartWhatsAppConversationDTO,
} from '@/src/schemas/whatsapp-conversation.schema'
import type {
  WhatsAppAssignableMemberDTO,
  WhatsAppConversationDTO,
  WhatsAppConversationEventDTO,
} from '@/types/whatsapp-conversation'
import {
  assertMember,
  assertModuleMember,
  type MembershipContext,
} from './authz'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'
import {
  type WhatsAppCloseClassification,
  WhatsAppCloseStatusService,
} from './whatsapp-close-status.service'
import {
  loadVisibleConversation,
  resolveConversationScope,
  whatsAppTeamMemberIds,
} from './whatsapp-conversation-scope.service'
import { emitWhatsAppConversationWaiting } from './whatsapp-conversation-waiting'
import {
  notifyWhatsAppUsers,
  whatsAppConversationPath,
} from './whatsapp-notify'
import { WhatsAppSettingsService } from './whatsapp-settings.service'
import { WhatsAppUsageService } from './whatsapp-usage.service'

/** Máximo de conversas fechadas por inatividade a cada tick do job. */
const AUTO_CLOSE_BATCH = 500
const HOUR_MS = 60 * 60 * 1000

interface ViewerAccess {
  membership: MembershipContext
  scope: WhatsAppConversationScope
}

/**
 * Module member with the permission + the conversation visibility scope
 * (Equipes) — the gate of every method below.
 */
async function authorizeViewer(
  actorId: string,
  workspaceId: string,
  action: PermissionAction,
): Promise<Result<ViewerAccess>> {
  const membership = await assertModuleMember(
    actorId,
    workspaceId,
    'COMMUNICATION',
    { resource: 'conversations', action },
  )
  if (!membership.ok) return membership

  const scope = await resolveConversationScope(
    actorId,
    workspaceId,
    membership.value.role,
  )
  if (!scope.ok) return scope
  return ok({ membership: membership.value, scope: scope.value })
}

/** `authorizeViewer` + a conversation the viewer can see (else 404). */
async function authorizeConversation(
  actorId: string,
  workspaceId: string,
  id: string,
  action: PermissionAction,
): Promise<
  Result<ViewerAccess & { conversation: WhatsAppConversationWithPreview }>
> {
  const access = await authorizeViewer(actorId, workspaceId, action)
  if (!access.ok) return access

  const conversation = await loadVisibleConversation(
    access.value.scope,
    workspaceId,
    id,
  )
  if (!conversation.ok) return conversation
  return ok({ ...access.value, conversation: conversation.value })
}

async function publishConversation(
  workspaceId: string,
  id: string,
): Promise<Result<WhatsAppConversationDTO>> {
  const fresh = await WhatsAppConversationRepository.findById(id, workspaceId)
  if (!fresh.ok) return fresh
  if (!fresh.value) return err(whatsappConversationNotFound())

  const dto = toWhatsAppConversationDTO(fresh.value)
  await publishWhatsAppEvent(workspaceId, {
    type: 'conversation.updated',
    conversation: dto,
  })
  return ok(dto)
}

/**
 * Fecha uma conversa: status CLOSED + data/motivo, evento na linha do tempo
 * e auditoria. `actorUserId` nulo = sistema (inatividade).
 */
async function applyClose(
  conversation: WhatsAppConversation,
  input: {
    actorUserId: string | null
    source: WhatsAppConversationEventSource
    reason?: string
    classification?: WhatsAppCloseClassification | null
  },
): Promise<Result<void>> {
  const classification = input.classification ?? null
  const updated = await WhatsAppConversationRepository.update(conversation.id, {
    status: 'CLOSED',
    closedAt: new Date(),
    closeReason: input.reason ?? null,
    closeOutcome: classification?.outcome ?? null,
    closeStatusIds: classification?.statusIds ?? [],
    closeStatusLabels: classification?.labels ?? [],
  })
  if (!updated.ok) return updated

  const event = await WhatsAppConversationEventRepository.create({
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    kind: 'CLOSED',
    source: input.source,
    actorUserId: input.actorUserId,
    reason: input.reason ?? null,
    closeOutcome: classification?.outcome ?? null,
    closeStatusLabels: classification?.labels ?? [],
  })
  if (!event.ok) return event

  auditMutation({
    entity: 'whatsapp_conversation',
    action: 'close',
    actorId: input.actorUserId,
    targetId: conversation.id,
    meta: {
      workspaceId: conversation.workspaceId,
      source: input.source,
      hasReason: Boolean(input.reason),
      outcome: classification?.outcome ?? null,
      statuses: classification?.statusIds.length ?? 0,
      ...(input.actorUserId ? {} : { actor: 'system' }),
    },
  })
  return ok(undefined)
}

/**
 * Closes a conversation on behalf of the system (an AI campaign action),
 * with an optional classification, and publishes it.
 */
export async function closeWhatsAppConversationBySystem(
  conversation: WhatsAppConversation,
  input: {
    source: WhatsAppConversationEventSource
    reason?: string
    classification?: WhatsAppCloseClassification | null
  },
): Promise<Result<void>> {
  if (conversation.status === 'CLOSED') {
    return err(whatsappConversationAlreadyClosed())
  }
  const closed = await applyClose(conversation, {
    actorUserId: null,
    source: input.source,
    reason: input.reason,
    classification: input.classification,
  })
  if (!closed.ok) return closed
  void indexSearchDocument(
    'zap-conversation',
    conversation.workspaceId,
    conversation.id,
  )
  const published = await publishConversation(
    conversation.workspaceId,
    conversation.id,
  )
  if (!published.ok) return published
  return ok(undefined)
}

/**
 * Reabre uma conversa fechada. Volta para IN_PROGRESS se já tem atendente,
 * senão NEW; `extra` permite ajustar outros campos na mesma escrita (ex.: o
 * webhook reativa a IA e soma a mensagem não lida).
 */
export async function reopenWhatsAppConversation(
  conversation: WhatsAppConversation,
  input: {
    actorUserId: string | null
    source: WhatsAppConversationEventSource
    extra?: Prisma.WhatsAppConversationUncheckedUpdateInput
  },
): Promise<Result<WhatsAppConversation>> {
  const updated = await WhatsAppConversationRepository.update(conversation.id, {
    ...input.extra,
    status: conversation.assignedUserId ? 'IN_PROGRESS' : 'NEW',
    closedAt: null,
    closeReason: null,
    closeOutcome: null,
    closeStatusIds: [],
    closeStatusLabels: [],
  })
  if (!updated.ok) return updated

  const event = await WhatsAppConversationEventRepository.create({
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    kind: 'REOPENED',
    source: input.source,
    actorUserId: input.actorUserId,
  })
  if (!event.ok) return event

  auditMutation({
    entity: 'whatsapp_conversation',
    action: 'reopen',
    actorId: input.actorUserId,
    targetId: conversation.id,
    meta: {
      workspaceId: conversation.workspaceId,
      source: input.source,
      ...(input.actorUserId ? {} : { actor: 'system' }),
    },
  })
  return ok(updated.value)
}

export const WhatsAppConversationService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: {
      status?: WhatsAppConversationStatusFilter
      archived?: boolean
      connectionId?: string
    } = {},
  ): Promise<Result<WhatsAppConversationDTO[]>> {
    const access = await authorizeViewer(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access

    const result = await WhatsAppConversationRepository.listByWorkspace(
      workspaceId,
      filters,
      scopeVisibility(access.value.scope),
    )
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppConversationDTO))
  },

  /**
   * Conversations waiting for an agent — the inbox "Fila (sem responsável)":
   * open (NEW or IN_PROGRESS), not archived nor deleted, with no assignee,
   * as the viewer may see them (Equipes: the general queue plus the queues
   * of their teams). Oldest first (by last message, else creation), the
   * order they should be picked up in. Conversations the AI is answering
   * are included (`aiActive`), as in the inbox.
   */
  async listWaiting(
    actorId: string,
    workspaceId: string,
    filters: { connectionId?: string; teamId?: string } = {},
  ): Promise<Result<WhatsAppConversationDTO[]>> {
    const access = await authorizeViewer(actorId, workspaceId, 'VIEW')
    if (!access.ok) return access

    const result = await WhatsAppConversationRepository.listByWorkspace(
      workspaceId,
      {
        status: 'OPEN',
        archived: false,
        unassigned: true,
        connectionId: filters.connectionId,
        teamId: filters.teamId,
      },
      scopeVisibility(access.value.scope),
    )
    if (!result.ok) return result

    const waitingSince = (c: WhatsAppConversationDTO) =>
      c.lastMessageAt ?? c.createdAt
    return ok(
      result.value
        .map(toWhatsAppConversationDTO)
        .sort(
          (a, b) =>
            waitingSince(a).localeCompare(waitingSince(b)) ||
            a.id.localeCompare(b.id),
        ),
    )
  },

  async start(
    actorId: string,
    workspaceId: string,
    dto: StartWhatsAppConversationDTO,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeViewer(actorId, workspaceId, 'CREATE')
    if (!access.ok) return access

    const contact = await WhatsAppContactRepository.findById(
      dto.contactId,
      workspaceId,
    )
    if (!contact.ok) return contact
    if (!contact.value) return err(whatsappContactNotFound())

    const connection = await WhatsAppConnectionRepository.findById(
      dto.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())

    const existing = await WhatsAppConversationRepository.findActiveByContact(
      workspaceId,
      dto.contactId,
    )
    if (!existing.ok) return existing

    let conversationId: string
    if (existing.value) {
      // The contact is already being served by someone the actor cannot
      // see: say so without exposing that conversation.
      if (!canSeeConversation(access.value.scope, existing.value)) {
        return err(
          forbidden('Este contato já está em atendimento com outra pessoa'),
        )
      }
      conversationId = existing.value.id
    } else {
      const allowed = await WhatsAppUsageService.assertCanSend(
        workspaceId,
        'conversations',
      )
      if (!allowed.ok) return allowed

      const created = await WhatsAppConversationRepository.create({
        workspaceId,
        connectionId: dto.connectionId,
        contactId: dto.contactId,
        status: 'NEW',
      })
      if (!created.ok) return created
      conversationId = created.value.id
      await WhatsAppUsageService.record(workspaceId, 'conversations')

      auditMutation({
        entity: 'whatsapp_conversation',
        action: 'create',
        actorId,
        targetId: conversationId,
      })
    }

    const fresh = await WhatsAppConversationRepository.findById(
      conversationId,
      workspaceId,
    )
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappConversationNotFound())

    const conversationDto = toWhatsAppConversationDTO(fresh.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: conversationDto,
    })

    void indexSearchDocument(
      'zap-conversation',
      workspaceId,
      conversationDto.id,
    )
    return ok(conversationDto)
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'VIEW')
    if (!access.ok) return access

    return ok(toWhatsAppConversationDTO(access.value.conversation))
  },

  async markRead(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'VIEW')
    if (!access.ok) return access
    const existing = access.value.conversation

    if (existing.unreadCount === 0) {
      return ok(toWhatsAppConversationDTO(existing))
    }

    const updated = await WhatsAppConversationRepository.update(id, {
      unreadCount: 0,
    })
    if (!updated.ok) return updated

    const fresh = await WhatsAppConversationRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappConversationNotFound())

    const dto = toWhatsAppConversationDTO(fresh.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: dto,
    })

    return ok(dto)
  },

  async removeFromAi(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'EDIT')
    if (!access.ok) return access

    const updated = await WhatsAppConversationRepository.update(id, {
      aiActive: false,
      aiHandoff: true,
      status: 'IN_PROGRESS',
    })
    if (!updated.ok) return updated

    const fresh = await WhatsAppConversationRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappConversationNotFound())

    const dto = toWhatsAppConversationDTO(fresh.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: dto,
    })

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'update',
      actorId,
      targetId: id,
      meta: { aiHandoff: true },
    })

    return ok(dto)
  },

  async resumeAi(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'EDIT')
    if (!access.ok) return access

    const updated = await WhatsAppConversationRepository.update(id, {
      aiActive: true,
      aiHandoff: false,
    })
    if (!updated.ok) return updated

    const fresh = await WhatsAppConversationRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappConversationNotFound())

    const dto = toWhatsAppConversationDTO(fresh.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: dto,
    })

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'update',
      actorId,
      targetId: id,
      meta: { aiHandoff: false },
    })

    return ok(dto)
  },

  async setPinned(
    actorId: string,
    workspaceId: string,
    id: string,
    pinned: boolean,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'EDIT')
    if (!access.ok) return access

    const updated = await WhatsAppConversationRepository.update(id, {
      pinnedAt: pinned ? new Date() : null,
    })
    if (!updated.ok) return updated

    const fresh = await WhatsAppConversationRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappConversationNotFound())

    const dto = toWhatsAppConversationDTO(fresh.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: dto,
    })

    return ok(dto)
  },

  async setArchived(
    actorId: string,
    workspaceId: string,
    id: string,
    archived: boolean,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'EDIT')
    if (!access.ok) return access

    // An archived conversation leaves the active list, so it must not stay
    // open: otherwise it keeps blocking a new attendance with the contact.
    if (archived && access.value.conversation.status !== 'CLOSED') {
      const closed = await applyClose(access.value.conversation, {
        actorUserId: actorId,
        source: 'AGENT',
      })
      if (!closed.ok) return closed
    }

    const updated = await WhatsAppConversationRepository.update(id, {
      archivedAt: archived ? new Date() : null,
    })
    if (!updated.ok) return updated

    const fresh = await WhatsAppConversationRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappConversationNotFound())

    const dto = toWhatsAppConversationDTO(fresh.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: dto,
    })

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'update',
      actorId,
      targetId: id,
      meta: { archived },
    })

    void indexSearchDocument('zap-conversation', workspaceId, id)
    return ok(dto)
  },

  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<{ id: string }>> {
    const access = await authorizeConversation(
      actorId,
      workspaceId,
      id,
      'DELETE',
    )
    if (!access.ok) return access

    // Same reason as archiving: a deleted conversation cannot stay open.
    if (access.value.conversation.status !== 'CLOSED') {
      const closed = await applyClose(access.value.conversation, {
        actorUserId: actorId,
        source: 'AGENT',
      })
      if (!closed.ok) return closed
    }

    const updated = await WhatsAppConversationRepository.update(id, {
      deletedAt: new Date(),
    })
    if (!updated.ok) return updated

    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.deleted',
      conversationId: id,
    })

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'delete',
      actorId,
      targetId: id,
    })

    void indexSearchDocument('zap-conversation', workspaceId, id)
    return ok({ id })
  },

  async clear(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(
      actorId,
      workspaceId,
      id,
      'DELETE',
    )
    if (!access.ok) return access

    const updated = await WhatsAppConversationRepository.update(id, {
      clearedAt: new Date(),
      lastMessageAt: null,
    })
    if (!updated.ok) return updated

    const fresh = await WhatsAppConversationRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappConversationNotFound())

    const dto = toWhatsAppConversationDTO(fresh.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: dto,
    })

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'update',
      actorId,
      targetId: id,
      meta: { cleared: true },
    })

    void indexSearchDocument('zap-conversation', workspaceId, id)
    return ok(dto)
  },

  async listAssignableMembers(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAssignableMemberDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result =
      await MembershipRepository.listWithUserByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(
      result.value.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
      })),
    )
  },

  /**
   * Assigns (or, with `null`, returns to the queue). Unscoped viewers assign
   * freely; a team leader assigns inside the teams they lead; anyone else
   * only takes an unassigned queue item or hands their own back.
   */
  async assign(
    actorId: string,
    workspaceId: string,
    id: string,
    assignedUserId: string | null,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'EDIT')
    if (!access.ok) return access
    const existing = access.value.conversation

    if (!canAssignConversation(access.value.scope, existing, assignedUserId)) {
      return err(forbidden('Você não pode transferir esta conversa'))
    }

    if (assignedUserId) {
      const targetMembership = await assertMember(assignedUserId, workspaceId)
      if (!targetMembership.ok) {
        return err(
          badRequest('Usuário informado não pertence a este workspace'),
        )
      }
    }

    const changed = assignedUserId !== existing.assignedUserId
    const updated = await WhatsAppConversationRepository.update(id, {
      assignedUserId,
      // Back to the queue = NEW again; a closed one stays closed.
      status:
        existing.status === 'CLOSED'
          ? 'CLOSED'
          : assignedUserId
            ? 'IN_PROGRESS'
            : 'NEW',
    })
    if (!updated.ok) return updated

    if (changed) {
      const assignee = assignedUserId
        ? await UserRepository.findById(assignedUserId)
        : null
      const event = await WhatsAppConversationEventRepository.create({
        workspaceId,
        conversationId: id,
        kind: 'ASSIGNED',
        source: 'AGENT',
        actorUserId: actorId,
        reason: assignee?.ok ? assignee.value.name : null,
      })
      if (!event.ok) return event
    }

    const fresh = await WhatsAppConversationRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappConversationNotFound())

    const dto = toWhatsAppConversationDTO(fresh.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'conversation.updated',
      conversation: dto,
    })

    // Handed back to the queue: it waits for an agent again.
    if (changed && !assignedUserId && existing.status !== 'CLOSED') {
      emitWhatsAppConversationWaiting({
        conversation: fresh.value,
        contact: fresh.value.contact,
        reason: 'returned_to_queue',
        actorId,
      })
    }

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'assign',
      actorId,
      targetId: id,
      meta: { assignedUserId },
    })

    // The new assignee hears about it — not on self-assign (the actor is
    // filtered out) nor when nothing changed.
    if (assignedUserId && changed) {
      const contact = fresh.value.contact
      await notifyWhatsAppUsers({
        workspaceId,
        kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
        userIds: [assignedUserId],
        actorId,
        title: 'Conversa atribuída a você',
        body: `Conversa com ${contact.name ?? contact.waId}.`,
        path: whatsAppConversationPath(id),
        meta: { conversationId: id },
      })
      void dispatchSteelAgentEvent(workspaceId, 'zap.conversation.assigned', {
        conversationId: id,
        assignedUserId,
      })
    }

    void indexSearchDocument('zap-conversation', workspaceId, id)
    return ok(dto)
  },

  /**
   * Moves the conversation to a team (`null` removes it). Unscoped viewers
   * move freely; a leader moves between the teams they lead. An unassigned
   * conversation lands in the team queue and its members are told.
   */
  async setTeam(
    actorId: string,
    workspaceId: string,
    id: string,
    teamId: string | null,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'EDIT')
    if (!access.ok) return access
    const existing = access.value.conversation

    let teamName: string | null = null
    if (teamId) {
      const team = await WhatsAppTeamRepository.findById(teamId, workspaceId)
      if (!team.ok) return team
      if (!team.value) return err(whatsappTeamNotFound())
      teamName = team.value.name
    }

    if (!canChangeConversationTeam(access.value.scope, existing, teamId)) {
      return err(forbidden('Você não pode mover esta conversa de equipe'))
    }

    if (existing.teamId === teamId) {
      return ok(toWhatsAppConversationDTO(existing))
    }

    const updated = await WhatsAppConversationRepository.update(id, { teamId })
    if (!updated.ok) return updated

    const event = await WhatsAppConversationEventRepository.create({
      workspaceId,
      conversationId: id,
      kind: 'TEAM_CHANGED',
      source: 'AGENT',
      actorUserId: actorId,
      reason: teamName,
    })
    if (!event.ok) return event

    const published = await publishConversation(workspaceId, id)
    if (!published.ok) return published

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'update',
      actorId,
      targetId: id,
      meta: { teamId, previousTeamId: existing.teamId },
    })

    if (teamId && !existing.assignedUserId) {
      const contact = existing.contact
      await notifyWhatsAppUsers({
        workspaceId,
        kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
        userIds: await whatsAppTeamMemberIds(workspaceId, teamId),
        actorId,
        title: `Nova conversa na fila da equipe ${teamName}`,
        body: `${contact.name ?? contact.waId} aguarda atendimento.`,
        path: whatsAppConversationPath(id),
        meta: { conversationId: id, teamId, via: 'team_queue' },
      })
    }

    void indexSearchDocument('zap-conversation', workspaceId, id)
    return published
  },

  /** Fecha a conversa (atendente/admin), com motivo opcional. */
  async close(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: CloseWhatsAppConversationDTO,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'EDIT')
    if (!access.ok) return access
    const existing = access.value.conversation
    if (existing.deletedAt) return err(whatsappConversationNotFound())
    if (existing.status === 'CLOSED') {
      return err(whatsappConversationAlreadyClosed())
    }

    const classification =
      await WhatsAppCloseStatusService.resolveClassification(
        workspaceId,
        dto.statusIds ?? [],
      )
    if (!classification.ok) return classification

    const closed = await applyClose(existing, {
      actorUserId: actorId,
      source: 'AGENT',
      reason: dto.reason,
      classification: classification.value,
    })
    if (!closed.ok) return closed

    void indexSearchDocument('zap-conversation', workspaceId, id)
    return publishConversation(workspaceId, id)
  },

  /** Reabre manualmente uma conversa fechada. */
  async reopen(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'EDIT')
    if (!access.ok) return access
    const existing = access.value.conversation
    if (existing.deletedAt) return err(whatsappConversationNotFound())
    if (existing.status !== 'CLOSED') {
      return err(whatsappConversationNotClosed())
    }

    // A reopened conversation is a new attendance: limited and counted.
    const allowed = await WhatsAppUsageService.assertCanSend(
      workspaceId,
      'conversations',
    )
    if (!allowed.ok) return allowed

    const reopened = await reopenWhatsAppConversation(existing, {
      actorUserId: actorId,
      source: 'AGENT',
    })
    if (!reopened.ok) return reopened
    await WhatsAppUsageService.record(workspaceId, 'conversations')
    if (!reopened.value.assignedUserId) {
      emitWhatsAppConversationWaiting({
        conversation: reopened.value,
        contact: existing.contact,
        reason: 'reopened',
        actorId,
      })
    }

    void indexSearchDocument('zap-conversation', workspaceId, id)
    return publishConversation(workspaceId, id)
  },

  /** Linha do tempo (fechada/reaberta...) da conversa. */
  async listEvents(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationEventDTO[]>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'VIEW')
    if (!access.ok) return access

    const events = await WhatsAppConversationEventRepository.listByConversation(
      id,
      workspaceId,
    )
    if (!events.ok) return events
    return ok(events.value.map(toWhatsAppConversationEventDTO))
  },

  /**
   * Downloadable transcript of the conversation (TXT or CSV), from the last
   * "clear" on. Audited — it takes personal data out of the platform (LGPD).
   */
  async exportTranscript(
    actorId: string,
    workspaceId: string,
    id: string,
    format: WhatsAppConversationExportFormat,
  ): Promise<Result<WhatsAppConversationExportFile>> {
    const access = await authorizeConversation(actorId, workspaceId, id, 'VIEW')
    if (!access.ok) return access
    const conversation = access.value.conversation
    if (conversation.deletedAt) return err(whatsappConversationNotFound())

    const messages = await WhatsAppMessageRepository.listForExport(id, {
      limit: WHATSAPP_CONVERSATION_EXPORT_MAX_MESSAGES,
      after: conversation.clearedAt,
    })
    if (!messages.ok) return messages

    const file = buildWhatsAppConversationExport(
      {
        contactName: conversation.contact.name,
        contactWaId: conversation.contact.waId,
        messages: messages.value.map((message) => ({
          direction: message.direction,
          type: message.type,
          text: message.text,
          mediaUrl: message.mediaUrl,
          sentByAi: message.sentByAi,
          senderName: message.senderUser?.name ?? null,
          createdAt: message.createdAt,
        })),
      },
      format,
    )

    auditMutation({
      entity: 'whatsapp_conversation',
      action: 'download',
      actorId,
      targetId: id,
      meta: { workspaceId, format, messages: messages.value.length },
    })
    return ok(file)
  },

  /**
   * Fecha conversas abertas sem mensagem há mais que a janela configurada do
   * workspace (padrão 24h; 0 = desligado). Fluxo de sistema (job repetível).
   */
  async closeInactive(now: Date): Promise<Result<{ closed: number }>> {
    const windows = await WhatsAppSettingsService.listAutoCloseWindows()
    if (!windows.ok) return windows

    const batches: {
      cutoff: Date
      workspaceIds: { in: string[] } | { notIn: string[] }
    }[] = [
      // Workspaces que nunca salvaram configuração: janela padrão.
      {
        cutoff: new Date(now.getTime() - windows.value.defaultHours * HOUR_MS),
        workspaceIds: { notIn: windows.value.configuredWorkspaceIds },
      },
      ...windows.value.configured.map((window) => ({
        cutoff: new Date(now.getTime() - window.hours * HOUR_MS),
        workspaceIds: { in: [window.workspaceId] },
      })),
    ]

    let closed = 0
    for (const batch of batches) {
      if (closed >= AUTO_CLOSE_BATCH) break
      const inactive = await WhatsAppConversationRepository.listInactiveOpen({
        ...batch,
        limit: AUTO_CLOSE_BATCH - closed,
      })
      if (!inactive.ok) return inactive

      for (const conversation of inactive.value) {
        const result = await applyClose(conversation, {
          actorUserId: null,
          source: 'INACTIVITY',
        })
        if (!result.ok) {
          logger.error('whatsapp.conversation.auto_close_failed', {
            component: 'WhatsAppConversationService',
            conversationId: conversation.id,
            reason: result.error.code,
          })
          continue
        }
        closed += 1
        await publishConversation(conversation.workspaceId, conversation.id)
      }
    }

    return ok({ closed })
  },
}
