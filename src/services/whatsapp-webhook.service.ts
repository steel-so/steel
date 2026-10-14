import type {
  ModuleKind,
  WhatsAppConnection,
  WhatsAppContact,
  WhatsAppMessage,
  WhatsAppMessageStatus,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  WhatsappAiReplyJob,
  WhatsappMediaJob,
  WhatsappSentimentJob,
} from '@/src/lib/queue/jobs'
import {
  getWhatsappAiReplyQueue,
  getWhatsappMediaQueue,
  getWhatsappSentimentQueue,
} from '@/src/lib/queue/queues'
import { ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  isWhatsAppOptOutKeyword,
  WHATSAPP_OPT_OUT_CONFIRMATION,
} from '@/src/lib/whatsapp/opt-out'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationScope,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppGroupRepository } from '@/src/repositories/whatsapp-group.repository'
import { WhatsAppGroupMessageRepository } from '@/src/repositories/whatsapp-group-message.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import type { WhatsAppMessageTypeDTO } from '@/types/whatsapp-message'
import { CrmCampaignTrackingService } from './crm-campaign-tracking.service'
import { SdWhatsappInboundService } from './sd-whatsapp-inbound.service'
import { reopenWhatsAppConversation } from './whatsapp-conversation.service'
import { WhatsAppUsageService } from './whatsapp-usage.service'

export interface InboundWhatsAppMessage {
  connection: WhatsAppConnection
  waId: string
  contactName?: string
  contactAvatarUrl?: string
  providerMessageId: string
  type: WhatsAppMessageTypeDTO
  text?: string
  rawMediaUrl?: string
  quotedProviderMessageId?: string
  contactPayload?: { name: string; waId: string }
}

/**
 * Conexões do ServiceDesk (`module = SERVICE_DESK`) passam pelo mesmo
 * pipeline (contato, conversa, mensagem, mídia), mas com conversas separadas
 * por conexão, sem IA/sentimento/opt-out do zap, sem eventos no tempo real do
 * zap (essas conversas não existem para o módulo Comunicação) e, no fim,
 * roteadas para os chamados (`SdWhatsappInboundService`).
 */
function isServiceDesk(connection: Pick<WhatsAppConnection, 'module'>) {
  return connection.module === 'SERVICE_DESK'
}

function conversationScope(
  connection: WhatsAppConnection,
): WhatsAppConversationScope {
  return isServiceDesk(connection)
    ? { connectionId: connection.id }
    : { module: 'COMMUNICATION' }
}

/** Repassa ao ServiceDesk a mudança de uma mensagem de conexão dele. */
async function notifyServiceDesk(
  module: ModuleKind | undefined,
  message: WhatsAppMessage,
): Promise<boolean> {
  if (module !== 'SERVICE_DESK') return false
  await SdWhatsappInboundService.onMessageUpdated(message)
  return true
}

async function resolveReplyToMessageId(
  quotedProviderMessageId: string | undefined,
): Promise<string | undefined> {
  if (!quotedProviderMessageId) return undefined
  const quoted = await WhatsAppMessageRepository.findByProviderMessageId(
    quotedProviderMessageId,
  )
  return quoted.ok ? quoted.value?.id : undefined
}

async function publishConversationSnapshot(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const fresh = await WhatsAppConversationRepository.findById(
    conversationId,
    workspaceId,
  )
  if (!fresh.ok || !fresh.value) return

  await publishWhatsAppEvent(workspaceId, {
    type: 'conversation.updated',
    conversation: toWhatsAppConversationDTO(fresh.value),
  })
}

/**
 * Opt-out LGPD por palavra-chave (SAIR/PARAR/STOP/DESCADASTRAR): marca o contato
 * como descadastrado de transmissões (só na primeira vez — preserva quando e
 * como aconteceu) e confirma na própria conversa. Falha no envio da
 * confirmação não desfaz o descadastro.
 */
async function handleOptOutKeyword(input: {
  connection: WhatsAppConnection
  contact: WhatsAppContact
  conversationId: string
}): Promise<void> {
  const { connection, contact, conversationId } = input
  const workspaceId = connection.workspaceId

  if (!contact.broadcastOptedOutAt) {
    const updated = await WhatsAppContactRepository.setBroadcastOptOut(
      contact.id,
      { at: new Date(), source: 'KEYWORD' },
    )
    auditMutation({
      entity: 'whatsapp_contact',
      action: 'opt_out',
      actorId: null,
      targetId: contact.id,
      outcome: updated.ok ? 'success' : 'failure',
      reason: updated.ok ? undefined : updated.error.code,
      meta: { workspaceId, channel: 'whatsapp', source: 'KEYWORD' },
    })
  }

  // Compliance reply: goes out even past the monthly message limit.
  const sent = await WhatsAppSend.text(
    connection,
    { to: contact.waId, text: WHATSAPP_OPT_OUT_CONFIRMATION },
    { unmetered: true },
  )
  if (!sent.ok) {
    logger.warn('whatsapp.opt_out.confirmation_failed', {
      workspaceId,
      contactId: contact.id,
      reason: sent.error.code,
    })
    return
  }

  const confirmation = await WhatsAppMessageRepository.create({
    workspaceId,
    conversationId,
    direction: 'OUT',
    type: 'TEXT',
    text: WHATSAPP_OPT_OUT_CONFIRMATION,
    providerMessageId: sent.value.providerMessageId,
    status: 'SENT',
  })
  if (confirmation.ok) {
    await publishWhatsAppEvent(workspaceId, {
      type: 'message.created',
      conversationId,
      message: toWhatsAppMessageDTO(confirmation.value),
    })
  }
}

export const WhatsAppWebhookService = {
  async ingestInboundMessage(
    input: InboundWhatsAppMessage,
  ): Promise<Result<void>> {
    const { connection } = input
    const workspaceId = connection.workspaceId

    const dedupe = await WhatsAppMessageRepository.findByProviderMessageId(
      input.providerMessageId,
    )
    if (!dedupe.ok) return dedupe
    if (dedupe.value) return ok(undefined)

    const contact = await WhatsAppContactRepository.upsertByWaId({
      workspaceId,
      waId: input.waId,
      name: input.contactName,
      avatarUrl: input.contactAvatarUrl,
    })
    if (!contact.ok) return contact

    const serviceDesk = isServiceDesk(connection)
    const scope = conversationScope(connection)
    let aiConfigActive = false
    if (!serviceDesk) {
      const aiConfig =
        await WhatsAppAiConfigRepository.findByWorkspace(workspaceId)
      if (!aiConfig.ok) return aiConfig
      aiConfigActive = aiConfig.value?.active ?? false
    }

    const existingConversation =
      await WhatsAppConversationRepository.findActiveByContact(
        workspaceId,
        contact.value.id,
        scope,
      )
    if (!existingConversation.ok) return existingConversation

    let conversationId: string
    let aiActive: boolean

    if (existingConversation.value) {
      const conversation = existingConversation.value
      // No ServiceDesk a IA do zap nunca responde (o pré-atendimento é do
      // ServiceDesk e usa as próprias colunas `aiActive`/`aiHandoff`).
      aiActive = serviceDesk ? false : conversation.aiActive
      if (!aiActive && !conversation.aiHandoff && aiConfigActive) {
        aiActive = true
      }

      const updated = await WhatsAppConversationRepository.update(
        conversation.id,
        {
          unreadCount: { increment: 1 },
          lastMessageAt: new Date(),
          ...(serviceDesk ? {} : { aiActive }),
        },
      )
      if (!updated.ok) return updated
      conversationId = updated.value.id
    } else {
      // Contato voltou a escrever numa conversa fechada: reabre a mesma
      // conversa (histórico junto) em vez de abrir outra. A IA volta ao
      // padrão do workspace, como numa conversa nova.
      const closed =
        await WhatsAppConversationRepository.findLatestClosedByContact(
          workspaceId,
          contact.value.id,
          scope,
        )
      if (!closed.ok) return closed

      if (closed.value) {
        const reopened = await reopenWhatsAppConversation(closed.value, {
          actorUserId: null,
          source: 'CONTACT',
          extra: {
            unreadCount: { increment: 1 },
            lastMessageAt: new Date(),
            aiActive: aiConfigActive,
            aiHandoff: false,
          },
        })
        if (!reopened.ok) return reopened
        conversationId = reopened.value.id
        aiActive = aiConfigActive
        if (!serviceDesk) {
          await WhatsAppUsageService.record(workspaceId, 'conversations')
        }
      } else {
        const created = await WhatsAppConversationRepository.create({
          workspaceId,
          connectionId: connection.id,
          contactId: contact.value.id,
          status: 'NEW',
          aiActive: aiConfigActive,
          aiHandoff: false,
          unreadCount: 1,
          lastMessageAt: new Date(),
        })
        if (!created.ok) return created
        conversationId = created.value.id
        aiActive = aiConfigActive
        // Inbound is counted toward the monthly limit but never blocked.
        if (!serviceDesk) {
          await WhatsAppUsageService.record(workspaceId, 'conversations')
        }
      }
    }

    const replyToMessageId = await resolveReplyToMessageId(
      input.quotedProviderMessageId,
    )

    const message = await WhatsAppMessageRepository.create({
      workspaceId,
      conversationId,
      direction: 'IN',
      type: input.type,
      text: input.text,
      mediaUrl: input.rawMediaUrl,
      providerMessageId: input.providerMessageId,
      status: 'DELIVERED',
      replyToMessageId,
      contactPayload: input.contactPayload,
    })
    if (!message.ok) return message
    void indexSearchDocument('zap-conversation', workspaceId, conversationId)
    void indexSearchDocument('zap-contact', workspaceId, contact.value.id)

    if (input.rawMediaUrl) {
      await getWhatsappMediaQueue().add(WhatsappMediaJob.DownloadInboundMedia, {
        messageId: message.value.id,
      })
    }

    if (serviceDesk) {
      await SdWhatsappInboundService.routeInbound({
        connection,
        conversationId,
        contact: contact.value,
        message: message.value,
      })
      return ok(undefined)
    }

    await publishWhatsAppEvent(workspaceId, {
      type: 'message.created',
      conversationId,
      message: toWhatsAppMessageDTO(message.value),
    })
    await publishConversationSnapshot(workspaceId, conversationId)

    // Reply to a CRM campaign: links this conversation to the contact.
    await CrmCampaignTrackingService.onWhatsAppInbound(
      { workspaceId, waId: input.waId, conversationId },
      new Date(),
    )

    const isOptOut =
      input.type === 'TEXT' && isWhatsAppOptOutKeyword(input.text)
    if (isOptOut) {
      await handleOptOutKeyword({
        connection,
        contact: contact.value,
        conversationId,
      })
    }

    // A confirmação do descadastro já é a resposta — a IA não responde.
    if (aiActive && !isOptOut) {
      await getWhatsappAiReplyQueue().add(WhatsappAiReplyJob.GenerateAiReply, {
        conversationId,
        messageId: message.value.id,
      })
    }

    // Independente da IA estar respondendo — alimenta dashboards/relatórios
    // de humor mesmo em conversas atendidas só por humanos.
    if (input.text?.trim()) {
      await getWhatsappSentimentQueue().add(
        WhatsappSentimentJob.AnalyzeMessage,
        { messageId: message.value.id },
      )
    }

    return ok(undefined)
  },

  // A message the agent sent directly from the linked phone (outside the
  // platform) — Z-API reports these with fromMe=true. Persisted as an
  // outbound message so it shows up in the conversation, and hands off from
  // AI (a human already replied), unlike a genuine inbound message.
  async ingestOutboundDeviceMessage(
    input: InboundWhatsAppMessage,
  ): Promise<Result<void>> {
    const { connection } = input
    const workspaceId = connection.workspaceId

    const dedupe = await WhatsAppMessageRepository.findByProviderMessageId(
      input.providerMessageId,
    )
    if (!dedupe.ok) return dedupe
    if (dedupe.value) return ok(undefined)

    const contact = await WhatsAppContactRepository.upsertByWaId({
      workspaceId,
      waId: input.waId,
      name: input.contactName,
      avatarUrl: input.contactAvatarUrl,
    })
    if (!contact.ok) return contact

    const scope = conversationScope(connection)
    const existingConversation =
      await WhatsAppConversationRepository.findActiveByContact(
        workspaceId,
        contact.value.id,
        scope,
      )
    if (!existingConversation.ok) return existingConversation

    let conversationId: string

    if (existingConversation.value) {
      const conversation = existingConversation.value
      const updated = await WhatsAppConversationRepository.update(
        conversation.id,
        {
          lastMessageAt: new Date(),
          aiActive: false,
          aiHandoff: true,
        },
      )
      if (!updated.ok) return updated
      conversationId = updated.value.id
    } else {
      // Atendente escreveu pelo celular para um contato com conversa
      // fechada: reabre a mesma conversa, já em atendimento humano.
      const closed =
        await WhatsAppConversationRepository.findLatestClosedByContact(
          workspaceId,
          contact.value.id,
          scope,
        )
      if (!closed.ok) return closed

      if (closed.value) {
        const reopened = await reopenWhatsAppConversation(closed.value, {
          actorUserId: null,
          source: 'AGENT',
          extra: {
            lastMessageAt: new Date(),
            aiActive: false,
            aiHandoff: true,
          },
        })
        if (!reopened.ok) return reopened
        conversationId = reopened.value.id
        if (!isServiceDesk(connection)) {
          await WhatsAppUsageService.record(workspaceId, 'conversations')
        }
      } else {
        const created = await WhatsAppConversationRepository.create({
          workspaceId,
          connectionId: connection.id,
          contactId: contact.value.id,
          status: 'IN_PROGRESS',
          aiActive: false,
          aiHandoff: true,
          unreadCount: 0,
          lastMessageAt: new Date(),
        })
        if (!created.ok) return created
        conversationId = created.value.id
        if (!isServiceDesk(connection)) {
          await WhatsAppUsageService.record(workspaceId, 'conversations')
        }
      }
    }

    const replyToMessageId = await resolveReplyToMessageId(
      input.quotedProviderMessageId,
    )

    const message = await WhatsAppMessageRepository.create({
      workspaceId,
      conversationId,
      direction: 'OUT',
      type: input.type,
      text: input.text,
      mediaUrl: input.rawMediaUrl,
      providerMessageId: input.providerMessageId,
      status: 'SENT',
      replyToMessageId,
      contactPayload: input.contactPayload,
    })
    if (!message.ok) return message
    void indexSearchDocument('zap-conversation', workspaceId, conversationId)
    void indexSearchDocument('zap-contact', workspaceId, contact.value.id)

    if (input.rawMediaUrl) {
      await getWhatsappMediaQueue().add(WhatsappMediaJob.DownloadInboundMedia, {
        messageId: message.value.id,
      })
    }

    if (isServiceDesk(connection)) {
      await SdWhatsappInboundService.routeOutboundDevice({
        conversationId,
        message: message.value,
      })
      return ok(undefined)
    }

    await publishWhatsAppEvent(workspaceId, {
      type: 'message.created',
      conversationId,
      message: toWhatsAppMessageDTO(message.value),
    })
    await publishConversationSnapshot(workspaceId, conversationId)

    return ok(undefined)
  },

  async ingestInboundGroupMessage(input: {
    connection: WhatsAppConnection
    groupJid: string
    groupName?: string
    senderWaId: string
    senderName?: string
    providerMessageId: string
    type: WhatsAppMessageTypeDTO
    text?: string
    rawMediaUrl?: string
  }): Promise<Result<void>> {
    const workspaceId = input.connection.workspaceId

    const dedupe = await WhatsAppGroupMessageRepository.findByProviderMessageId(
      input.providerMessageId,
    )
    if (!dedupe.ok) return dedupe
    if (dedupe.value) return ok(undefined)

    const existingGroup = await WhatsAppGroupRepository.findByGroupJid(
      workspaceId,
      input.groupJid,
    )
    if (!existingGroup.ok) return existingGroup

    let group = existingGroup.value
    if (!group) {
      // The group exists on WhatsApp but isn't in our DB yet — most likely
      // it predates this workspace's connection, or was created from the
      // linked phone directly rather than through our "Criar grupo" flow.
      // Auto-create a minimal record instead of silently dropping the
      // message; participants/admins/invite link get filled in the first
      // time someone opens the group's settings and syncs from the provider.
      const created = await WhatsAppGroupRepository.create({
        workspaceId,
        connectionId: input.connection.id,
        groupJid: input.groupJid,
        name: input.groupName?.trim() || 'Grupo sem nome',
      })
      if (!created.ok) return created
      group = created.value

      logger.info('whatsapp.group.auto_created_from_inbound_message', {
        workspaceId,
        groupId: group.id,
        groupJid: input.groupJid,
      })
    }

    // Z-API's group metadata never carries participant names, only phone
    // numbers — this is the only place a name for a group member ever shows
    // up, so feed it both into the workspace's contact book (used the next
    // time participants get synced) and directly onto this participant row
    // (so the name shows up immediately, without waiting for a sync).
    if (input.senderName && input.senderWaId) {
      await WhatsAppContactRepository.upsertByWaId({
        workspaceId,
        waId: input.senderWaId,
        name: input.senderName,
      })
      await WhatsAppGroupRepository.upsertParticipantName(
        group.id,
        input.senderWaId,
        input.senderName,
      )
    }

    const message = await WhatsAppGroupMessageRepository.create({
      workspaceId,
      groupId: group.id,
      direction: 'IN',
      type: input.type,
      text: input.text,
      mediaUrl: input.rawMediaUrl,
      providerMessageId: input.providerMessageId,
      status: 'DELIVERED',
      senderWaId: input.senderWaId,
      senderName: input.senderName,
    })
    if (!message.ok) return message

    await WhatsAppGroupRepository.update(group.id, {
      lastMessageAt: new Date(),
    })

    await publishWhatsAppEvent(workspaceId, {
      type: 'group-message.created',
      groupId: group.id,
    })

    return ok(undefined)
  },

  /** `module` = módulo da conexão que recebeu o webhook (padrão: zap). */
  async ingestInboundReaction(input: {
    providerMessageId: string
    emoji: string
    module?: ModuleKind
  }): Promise<Result<void>> {
    const result =
      await WhatsAppMessageRepository.updateReactionByProviderMessageId(
        input.providerMessageId,
        { emoji: input.emoji || null, reactedByContact: true },
      )
    if (!result.ok) return result
    if (!result.value) return ok(undefined)
    if (await notifyServiceDesk(input.module, result.value)) {
      return ok(undefined)
    }

    await publishWhatsAppEvent(result.value.workspaceId, {
      type: 'message.updated',
      conversationId: result.value.conversationId,
      message: toWhatsAppMessageDTO(result.value),
    })

    return ok(undefined)
  },

  /** `module` = módulo da conexão que recebeu o webhook (padrão: zap). */
  async ingestStatusUpdate(input: {
    providerMessageId: string
    status: WhatsAppMessageStatus
    module?: ModuleKind
  }): Promise<Result<void>> {
    const result =
      await WhatsAppMessageRepository.updateStatusByProviderMessageId(
        input.providerMessageId,
        input.status,
      )
    if (!result.ok) return result
    // CRM campaign messages are not chat messages: track them by provider id.
    await CrmCampaignTrackingService.onWhatsAppStatus(
      input.providerMessageId,
      input.status,
      new Date(),
    )
    if (!result.value) return ok(undefined)
    if (await notifyServiceDesk(input.module, result.value)) {
      return ok(undefined)
    }

    await publishWhatsAppEvent(result.value.workspaceId, {
      type: 'message.updated',
      conversationId: result.value.conversationId,
      message: toWhatsAppMessageDTO(result.value),
    })

    return ok(undefined)
  },
}
