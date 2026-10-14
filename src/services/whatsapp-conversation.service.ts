import type {
  Prisma,
  WhatsAppConversation,
  WhatsAppConversationEventSource,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  badRequest,
  whatsappConnectionNotFound,
  whatsappContactNotFound,
  whatsappConversationAlreadyClosed,
  whatsappConversationNotClosed,
  whatsappConversationNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppConversationEventDTO } from '@/src/mappers/whatsapp-conversation-event.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationStatusFilter,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import type {
  CloseWhatsAppConversationDTO,
  StartWhatsAppConversationDTO,
} from '@/src/schemas/whatsapp-conversation.schema'
import type {
  WhatsAppAssignableMemberDTO,
  WhatsAppConversationDTO,
  WhatsAppConversationEventDTO,
} from '@/types/whatsapp-conversation'
import { assertMember, assertModuleMember } from './authz'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'
import {
  notifyWhatsAppUsers,
  whatsAppConversationPath,
} from './whatsapp-notify'
import { WhatsAppSettingsService } from './whatsapp-settings.service'
import { WhatsAppUsageService } from './whatsapp-usage.service'

/** Máximo de conversas fechadas por inatividade a cada tick do job. */
const AUTO_CLOSE_BATCH = 500
const HOUR_MS = 60 * 60 * 1000

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
  },
): Promise<Result<void>> {
  const updated = await WhatsAppConversationRepository.update(conversation.id, {
    status: 'CLOSED',
    closedAt: new Date(),
    closeReason: input.reason ?? null,
  })
  if (!updated.ok) return updated

  const event = await WhatsAppConversationEventRepository.create({
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    kind: 'CLOSED',
    source: input.source,
    actorUserId: input.actorUserId,
    reason: input.reason ?? null,
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
      ...(input.actorUserId ? {} : { actor: 'system' }),
    },
  })
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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result = await WhatsAppConversationRepository.listByWorkspace(
      workspaceId,
      filters,
    )
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppConversationDTO))
  },

  async start(
    actorId: string,
    workspaceId: string,
    dto: StartWhatsAppConversationDTO,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'CREATE' },
    )
    if (!membership.ok) return membership

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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!result.ok) return result
    if (!result.value) return err(whatsappConversationNotFound())

    return ok(toWhatsAppConversationDTO(result.value))
  },

  async markRead(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConversationNotFound())

    if (existing.value.unreadCount === 0) {
      return ok(toWhatsAppConversationDTO(existing.value))
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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConversationNotFound())

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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConversationNotFound())

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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConversationNotFound())

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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConversationNotFound())

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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'DELETE' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConversationNotFound())

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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'DELETE' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConversationNotFound())

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

  async assign(
    actorId: string,
    workspaceId: string,
    id: string,
    assignedUserId: string | null,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConversationNotFound())

    if (assignedUserId) {
      const targetMembership = await assertMember(assignedUserId, workspaceId)
      if (!targetMembership.ok) {
        return err(
          badRequest('Usuário informado não pertence a este workspace'),
        )
      }
    }

    const updated = await WhatsAppConversationRepository.update(id, {
      assignedUserId,
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
      action: 'assign',
      actorId,
      targetId: id,
      meta: { assignedUserId },
    })

    // The new assignee hears about it — not on self-assign (the actor is
    // filtered out) nor when nothing changed.
    if (assignedUserId && assignedUserId !== existing.value.assignedUserId) {
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
  /** Fecha a conversa (atendente/admin), com motivo opcional. */
  async close(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: CloseWhatsAppConversationDTO,
  ): Promise<Result<WhatsAppConversationDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value || existing.value.deletedAt) {
      return err(whatsappConversationNotFound())
    }
    if (existing.value.status === 'CLOSED') {
      return err(whatsappConversationAlreadyClosed())
    }

    const closed = await applyClose(existing.value, {
      actorUserId: actorId,
      source: 'AGENT',
      reason: dto.reason,
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
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppConversationRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value || existing.value.deletedAt) {
      return err(whatsappConversationNotFound())
    }
    if (existing.value.status !== 'CLOSED') {
      return err(whatsappConversationNotClosed())
    }

    // A reopened conversation is a new attendance: limited and counted.
    const allowed = await WhatsAppUsageService.assertCanSend(
      workspaceId,
      'conversations',
    )
    if (!allowed.ok) return allowed

    const reopened = await reopenWhatsAppConversation(existing.value, {
      actorUserId: actorId,
      source: 'AGENT',
    })
    if (!reopened.ok) return reopened
    await WhatsAppUsageService.record(workspaceId, 'conversations')

    void indexSearchDocument('zap-conversation', workspaceId, id)
    return publishConversation(workspaceId, id)
  },

  /** Linha do tempo (fechada/reaberta...) da conversa. */
  async listEvents(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConversationEventDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const events = await WhatsAppConversationEventRepository.listByConversation(
      id,
      workspaceId,
    )
    if (!events.ok) return events
    return ok(events.value.map(toWhatsAppConversationEventDTO))
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
