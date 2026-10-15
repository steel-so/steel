import { auditMutation } from '@/lib/axiom/audit'
import {
  whatsappConnectionNotFound,
  whatsappContactNotFound,
  whatsappConversationAiHandling,
  whatsappMessageNotFound,
} from '@/src/errors'
import type { PermissionAction } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import type { WhatsAppConversationScope } from '@/src/lib/whatsapp/conversation-scope'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationWithPreview,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import type {
  ListWhatsAppMessagesDTO,
  ReactToWhatsAppMessageDTO,
  SendWhatsAppContactMessageDTO,
  SendWhatsAppMediaMessageDTO,
  SendWhatsAppTemplateMessageDTO,
  SendWhatsAppTextMessageDTO,
} from '@/src/schemas/whatsapp-message.schema'
import type { WhatsAppMessageButtonDTO } from '@/types/whatsapp-button'
import type {
  WhatsAppMessageDTO,
  WhatsAppMessageTypeDTO,
} from '@/types/whatsapp-message'
import { assertModuleMember } from './authz'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from './whatsapp-conversation-scope.service'

/**
 * Module member with the permission + their conversation visibility
 * (Equipes): messages of a conversation the actor cannot see answer 404.
 */
async function authorizeMessages(
  actorId: string,
  workspaceId: string,
  action: PermissionAction,
): Promise<Result<WhatsAppConversationScope>> {
  const membership = await assertModuleMember(
    actorId,
    workspaceId,
    'COMMUNICATION',
    { resource: 'conversations', action },
  )
  if (!membership.ok) return membership
  return resolveConversationScope(actorId, workspaceId, membership.value.role)
}

async function loadSendableConversation(
  scope: WhatsAppConversationScope,
  workspaceId: string,
  conversationId: string,
) {
  const conversation = await loadVisibleConversation(
    scope,
    workspaceId,
    conversationId,
  )
  if (!conversation.ok) return conversation
  if (conversation.value.aiActive) return err(whatsappConversationAiHandling())

  const connection = await WhatsAppConnectionRepository.findById(
    conversation.value.connectionId,
    workspaceId,
  )
  if (!connection.ok) return connection
  if (!connection.value) return err(whatsappConnectionNotFound())

  return ok({
    conversation: conversation.value as WhatsAppConversationWithPreview,
    connection: connection.value,
  })
}

async function resolveQuotedProviderMessageId(
  replyToMessageId: string | undefined,
): Promise<string | undefined> {
  if (!replyToMessageId) return undefined
  const quoted = await WhatsAppMessageRepository.findById(replyToMessageId)
  return quoted.ok ? (quoted.value?.providerMessageId ?? undefined) : undefined
}

async function finalizeOutboundMessage(input: {
  workspaceId: string
  conversationId: string
  actorId: string
  type: WhatsAppMessageTypeDTO
  text?: string
  mediaUrl?: string
  providerMessageId: string
  replyToMessageId?: string
  contactPayload?: { name: string; waId: string }
  buttons?: WhatsAppMessageButtonDTO[]
}): Promise<Result<WhatsAppMessageDTO>> {
  const message = await WhatsAppMessageRepository.create({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    direction: 'OUT',
    type: input.type,
    text: input.text,
    mediaUrl: input.mediaUrl,
    providerMessageId: input.providerMessageId,
    status: 'SENT',
    senderUserId: input.actorId,
    replyToMessageId: input.replyToMessageId,
    contactPayload: input.contactPayload,
    ...(input.buttons?.length ? { buttons: input.buttons } : {}),
  })
  if (!message.ok) return message
  void indexSearchDocument(
    'zap-conversation',
    input.workspaceId,
    input.conversationId,
  )

  await WhatsAppConversationRepository.update(input.conversationId, {
    lastMessageAt: new Date(),
    status: 'IN_PROGRESS',
  })

  const dto = toWhatsAppMessageDTO(message.value)
  await publishWhatsAppEvent(input.workspaceId, {
    type: 'message.created',
    conversationId: input.conversationId,
    message: dto,
  })

  const freshConversation = await WhatsAppConversationRepository.findById(
    input.conversationId,
    input.workspaceId,
  )
  if (freshConversation.ok && freshConversation.value) {
    await publishWhatsAppEvent(input.workspaceId, {
      type: 'conversation.updated',
      conversation: toWhatsAppConversationDTO(freshConversation.value),
    })
  }

  auditMutation({
    entity: 'whatsapp_message',
    action: 'send',
    actorId: input.actorId,
    targetId: message.value.id,
    meta: { conversationId: input.conversationId, type: input.type },
  })

  return ok(dto)
}

export const WhatsAppMessageService = {
  async list(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    options: ListWhatsAppMessagesDTO,
  ): Promise<Result<WhatsAppMessageDTO[]>> {
    const scope = await authorizeMessages(actorId, workspaceId, 'VIEW')
    if (!scope.ok) return scope

    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const result = await WhatsAppMessageRepository.listByConversation(
      conversationId,
      {
        cursor: options.cursor,
        limit: options.limit,
        after: conversation.value.clearedAt,
      },
    )
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppMessageDTO))
  },

  async sendText(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: SendWhatsAppTextMessageDTO,
  ): Promise<Result<WhatsAppMessageDTO>> {
    const scope = await authorizeMessages(actorId, workspaceId, 'CREATE')
    if (!scope.ok) return scope

    const loaded = await loadSendableConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!loaded.ok) return loaded

    const quotedProviderMessageId = await resolveQuotedProviderMessageId(
      dto.replyToMessageId,
    )

    const sendResult = await WhatsAppSend.text(loaded.value.connection, {
      to: loaded.value.conversation.contact.waId,
      text: dto.text,
      quotedProviderMessageId,
    })
    if (!sendResult.ok) return sendResult

    return finalizeOutboundMessage({
      workspaceId,
      conversationId,
      actorId,
      type: 'TEXT',
      text: dto.text,
      providerMessageId: sendResult.value.providerMessageId,
      replyToMessageId: dto.replyToMessageId,
    })
  },

  async sendMedia(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: SendWhatsAppMediaMessageDTO,
  ): Promise<Result<WhatsAppMessageDTO>> {
    const scope = await authorizeMessages(actorId, workspaceId, 'CREATE')
    if (!scope.ok) return scope

    const loaded = await loadSendableConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!loaded.ok) return loaded

    const mediaType = dto.type.toLowerCase() as
      | 'image'
      | 'audio'
      | 'video'
      | 'document'

    const quotedProviderMessageId = await resolveQuotedProviderMessageId(
      dto.replyToMessageId,
    )

    const sendResult = await WhatsAppSend.media(loaded.value.connection, {
      to: loaded.value.conversation.contact.waId,
      mediaUrl: dto.mediaUrl,
      type: mediaType,
      caption: dto.caption,
      fileName: dto.fileName,
      quotedProviderMessageId,
    })
    if (!sendResult.ok) return sendResult

    return finalizeOutboundMessage({
      workspaceId,
      conversationId,
      actorId,
      type: dto.type,
      text: dto.caption,
      mediaUrl: dto.mediaUrl,
      providerMessageId: sendResult.value.providerMessageId,
      replyToMessageId: dto.replyToMessageId,
    })
  },

  async sendTemplate(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: SendWhatsAppTemplateMessageDTO,
  ): Promise<Result<WhatsAppMessageDTO>> {
    const scope = await authorizeMessages(actorId, workspaceId, 'CREATE')
    if (!scope.ok) return scope

    const loaded = await loadSendableConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!loaded.ok) return loaded

    // Media header + reply-button payloads come from the stored template;
    // an unknown template (not synced yet) goes out as the agent built it.
    const template = await WhatsAppTemplateRepository.findByConnectionAndName(
      loaded.value.connection.id,
      dto.templateName,
      dto.language,
    )
    const extras =
      template.ok && template.value
        ? applyTemplateSendExtras(template.value, dto.components)
        : { components: dto.components, buttons: [] }

    const sendResult = await WhatsAppSend.template(loaded.value.connection, {
      to: loaded.value.conversation.contact.waId,
      templateName: dto.templateName,
      language: dto.language,
      components: extras.components,
    })
    if (!sendResult.ok) return sendResult

    return finalizeOutboundMessage({
      workspaceId,
      conversationId,
      actorId,
      type: 'TEMPLATE',
      text: dto.templateName,
      providerMessageId: sendResult.value.providerMessageId,
      buttons: extras.buttons,
    })
  },

  async sendContact(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: SendWhatsAppContactMessageDTO,
  ): Promise<Result<WhatsAppMessageDTO>> {
    const scope = await authorizeMessages(actorId, workspaceId, 'CREATE')
    if (!scope.ok) return scope

    const loaded = await loadSendableConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!loaded.ok) return loaded

    const sharedContact = await WhatsAppContactRepository.findById(
      dto.contactId,
      workspaceId,
    )
    if (!sharedContact.ok) return sharedContact
    if (!sharedContact.value) return err(whatsappContactNotFound())

    const contactPayload = {
      name: sharedContact.value.name ?? sharedContact.value.waId,
      waId: sharedContact.value.waId,
    }

    const sendResult = await WhatsAppSend.contact(loaded.value.connection, {
      to: loaded.value.conversation.contact.waId,
      name: contactPayload.name,
      waId: contactPayload.waId,
    })
    if (!sendResult.ok) return sendResult

    return finalizeOutboundMessage({
      workspaceId,
      conversationId,
      actorId,
      type: 'CONTACT',
      providerMessageId: sendResult.value.providerMessageId,
      contactPayload,
    })
  },

  async remove(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<Result<{ id: string }>> {
    const scope = await authorizeMessages(actorId, workspaceId, 'EDIT')
    if (!scope.ok) return scope

    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const target = await WhatsAppMessageRepository.findById(messageId)
    if (!target.ok) return target
    if (!target.value || target.value.conversationId !== conversationId) {
      return err(whatsappMessageNotFound())
    }

    const updated = await WhatsAppMessageRepository.update(messageId, {
      deletedAt: new Date(),
    })
    if (!updated.ok) return updated

    await publishWhatsAppEvent(workspaceId, {
      type: 'message.deleted',
      conversationId,
      messageId,
    })

    auditMutation({
      entity: 'whatsapp_message',
      action: 'delete',
      actorId,
      targetId: messageId,
    })

    return ok({ id: messageId })
  },

  async react(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
    dto: ReactToWhatsAppMessageDTO,
  ): Promise<Result<WhatsAppMessageDTO>> {
    const scope = await authorizeMessages(actorId, workspaceId, 'CREATE')
    if (!scope.ok) return scope

    const loaded = await loadSendableConversation(
      scope.value,
      workspaceId,
      conversationId,
    )
    if (!loaded.ok) return loaded

    const target = await WhatsAppMessageRepository.findById(messageId)
    if (!target.ok) return target
    if (!target.value || target.value.conversationId !== conversationId) {
      return err(whatsappMessageNotFound())
    }
    if (!target.value.providerMessageId) {
      return err(whatsappMessageNotFound())
    }

    const sendResult = await WhatsAppSend.reaction(loaded.value.connection, {
      to: loaded.value.conversation.contact.waId,
      providerMessageId: target.value.providerMessageId,
      emoji: dto.emoji,
    })
    if (!sendResult.ok) return sendResult

    const updated = await WhatsAppMessageRepository.update(messageId, {
      reactionEmoji: dto.emoji || null,
      reactedByContact: dto.emoji ? false : null,
    })
    if (!updated.ok) return updated

    const messageDto = toWhatsAppMessageDTO(updated.value)
    await publishWhatsAppEvent(workspaceId, {
      type: 'message.updated',
      conversationId,
      message: messageDto,
    })

    return ok(messageDto)
  },
}
