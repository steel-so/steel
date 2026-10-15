import type { WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  whatsappButtonsUnsupported,
  whatsappConnectionNotFound,
  whatsappConversationAiHandling,
  whatsappQuickReplyNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { resolveBroadcastMediaKind } from '@/src/lib/whatsapp/broadcast-media'
import { buildButtonPayload } from '@/src/lib/whatsapp/button-payload'
import {
  parseStoredButtons,
  toMessageButtons,
} from '@/src/lib/whatsapp/buttons'
import {
  buildMetaInteractive,
  META_INTERACTIVE_BODY_MAX,
} from '@/src/lib/whatsapp/meta-client'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { renderQuickReplyBody } from '@/src/lib/whatsapp/template-variables'
import type {
  WhatsAppOutboundButton,
  WhatsAppSendResult,
} from '@/src/lib/whatsapp/types'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { toWhatsAppQuickReplyDTO } from '@/src/mappers/whatsapp-quick-reply.mapper'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppQuickReplyRepository } from '@/src/repositories/whatsapp-quick-reply.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type { SendWhatsAppQuickReplyMessageDTO } from '@/src/schemas/whatsapp-message.schema'
import type {
  CreateWhatsAppQuickReplyDTO,
  UpdateWhatsAppQuickReplyDTO,
} from '@/src/schemas/whatsapp-quick-reply.schema'
import type { WhatsAppMessageButtonDTO } from '@/types/whatsapp-button'
import type {
  WhatsAppMessageDTO,
  WhatsAppMessageTypeDTO,
} from '@/types/whatsapp-message'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'
import { assertModuleMember } from './authz'
import { loadConversationForViewer } from './whatsapp-conversation-scope.service'

const TOKEN_PATTERN = /\{(\w+)\}/g

type MediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT'
type ProviderMediaType = 'image' | 'video' | 'audio' | 'document'

interface OutboundPart {
  type: WhatsAppMessageTypeDTO
  text?: string
  mediaUrl?: string
  buttons?: WhatsAppMessageButtonDTO[]
  providerMessageId: string
}

/** `{token}` values typed by the agent win over the server-side ones. */
function applyVariables(
  body: string,
  variables: Record<string, string> | undefined,
): string {
  if (!variables) return body
  return body.replace(TOKEN_PATTERN, (match, token: string) =>
    Object.hasOwn(variables, token) ? variables[token] : match,
  )
}

function providerType(kind: MediaKind): ProviderMediaType {
  return kind.toLowerCase() as ProviderMediaType
}

/** Without buttons: media with caption (audio has none, so text follows). */
async function sendPlain(input: {
  connection: WhatsAppConnection
  to: string
  text: string
  mediaUrl: string | null
  kind: MediaKind | null
}): Promise<Result<OutboundPart[]>> {
  const { connection, to, text, mediaUrl, kind } = input
  const parts: OutboundPart[] = []
  if (mediaUrl && kind) {
    const caption = kind === 'AUDIO' ? undefined : text
    const media = await WhatsAppSend.media(connection, {
      to,
      mediaUrl,
      type: providerType(kind),
      caption,
    })
    if (!media.ok) return media
    parts.push({
      type: kind,
      text: caption,
      mediaUrl,
      providerMessageId: media.value.providerMessageId,
    })
    if (caption) return ok(parts)
  }
  const sent: Result<WhatsAppSendResult> = await WhatsAppSend.text(connection, {
    to,
    text,
  })
  if (!sent.ok) return sent
  parts.push({
    type: 'TEXT',
    text,
    providerMessageId: sent.value.providerMessageId,
  })
  return ok(parts)
}

/**
 * Sends the quick reply as one or two provider messages. With buttons, the
 * media rides in the button message when the provider allows it (Meta:
 * image/video/document header; Z-API: image); otherwise it goes first, on
 * its own.
 */
async function sendQuickReplyParts(input: {
  connection: WhatsAppConnection
  to: string
  text: string
  mediaUrl: string | null
  quickReplyId: string
  buttons: ReturnType<typeof parseStoredButtons>
}): Promise<Result<OutboundPart[]>> {
  const { connection, to, text, mediaUrl } = input
  const kind: MediaKind | null = mediaUrl
    ? (resolveBroadcastMediaKind({ url: mediaUrl }) ?? 'IMAGE')
    : null

  if (input.buttons.length === 0) {
    return sendPlain({ connection, to, text, mediaUrl, kind })
  }

  const outbound: WhatsAppOutboundButton[] = input.buttons.map((button) =>
    button.type === 'URL'
      ? { type: 'URL', id: button.id, label: button.label, url: button.url }
      : {
          type: 'REPLY',
          id: buildButtonPayload({
            sourceType: 'QUICK_REPLY',
            sourceId: input.quickReplyId,
            buttonId: button.id,
          }),
          label: button.label,
        },
  )

  if (connection.provider === 'META') {
    const { body } = buildMetaInteractive({ to, text, buttons: outbound })
    if (body.length > META_INTERACTIVE_BODY_MAX) {
      return err(
        whatsappButtonsUnsupported(
          `Na Meta, mensagens com botões aceitam até ${META_INTERACTIVE_BODY_MAX} caracteres`,
        ),
      )
    }
  }

  const inlineKind =
    kind &&
    kind !== 'AUDIO' &&
    (connection.provider === 'META' || kind === 'IMAGE')
      ? kind
      : null
  const parts: OutboundPart[] = []

  if (mediaUrl && kind && !inlineKind) {
    const media = await WhatsAppSend.media(connection, {
      to,
      mediaUrl,
      type: providerType(kind),
    })
    if (!media.ok) return media
    parts.push({
      type: kind,
      mediaUrl,
      providerMessageId: media.value.providerMessageId,
    })
  }

  const sent = await WhatsAppSend.buttons(connection, {
    to,
    text,
    buttons: outbound,
    ...(inlineKind && mediaUrl
      ? {
          media: {
            url: mediaUrl,
            type: providerType(inlineKind) as 'image' | 'video' | 'document',
          },
        }
      : {}),
  })
  if (!sent.ok) return sent
  parts.push({
    type: inlineKind ?? 'TEXT',
    text,
    mediaUrl: inlineKind && mediaUrl ? mediaUrl : undefined,
    buttons: toMessageButtons(input.buttons),
    providerMessageId: sent.value.providerMessageId,
  })
  return ok(parts)
}

export const WhatsAppQuickReplyService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppQuickReplyDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'quick-replies', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result =
      await WhatsAppQuickReplyRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppQuickReplyDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppQuickReplyDTO,
  ): Promise<Result<WhatsAppQuickReplyDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'quick-replies', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    const result = await WhatsAppQuickReplyRepository.create({
      workspaceId,
      shortcut: dto.shortcut,
      title: dto.title,
      body: dto.body,
      mediaUrl: dto.mediaUrl,
      ...(dto.buttons?.length ? { buttons: dto.buttons } : {}),
    })
    if (!result.ok) {
      auditMutation({
        entity: 'whatsapp_quick_reply',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'whatsapp_quick_reply',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    return ok(toWhatsAppQuickReplyDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppQuickReplyDTO,
  ): Promise<Result<WhatsAppQuickReplyDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'quick-replies', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppQuickReplyRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappQuickReplyNotFound())

    const { buttons, ...fields } = dto
    const result = await WhatsAppQuickReplyRepository.update(id, {
      ...fields,
      // An empty list clears the buttons, like `null`.
      ...(buttons === undefined
        ? {}
        : { buttons: buttons && buttons.length > 0 ? buttons : null }),
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'whatsapp_quick_reply',
      action: 'update',
      actorId,
      targetId: id,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toWhatsAppQuickReplyDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'quick-replies', action: 'DELETE' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppQuickReplyRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappQuickReplyNotFound())

    const result = await WhatsAppQuickReplyRepository.delete(id)
    if (!result.ok) return result

    auditMutation({
      entity: 'whatsapp_quick_reply',
      action: 'delete',
      actorId,
      targetId: id,
    })

    return ok(undefined)
  },

  /**
   * Sends a quick reply into a conversation with its media and buttons
   * (reply buttons carry `stl:q:<quickReplyId>:<buttonId>`, so a click runs
   * the configured actions). Returns the last message stored.
   */
  async send(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    dto: SendWhatsAppQuickReplyMessageDTO,
  ): Promise<Result<WhatsAppMessageDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    // Equipes: a conversation the actor cannot see answers 404.
    const visible = await loadConversationForViewer(
      { userId: actorId, role: membership.value.role },
      workspaceId,
      conversationId,
    )
    if (!visible.ok) return visible
    const conversation = { value: visible.value.conversation }
    if (conversation.value.aiActive) {
      return err(whatsappConversationAiHandling())
    }

    const quickReply = await WhatsAppQuickReplyRepository.findById(
      dto.quickReplyId,
      workspaceId,
    )
    if (!quickReply.ok) return quickReply
    if (!quickReply.value) return err(whatsappQuickReplyNotFound())

    const connection = await WhatsAppConnectionRepository.findById(
      conversation.value.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())

    const [user, workspace] = await Promise.all([
      UserRepository.findById(actorId),
      WorkspaceRepository.findById(workspaceId),
    ])
    const text = renderQuickReplyBody(
      applyVariables(quickReply.value.body, dto.variables),
      {
        contactName: conversation.value.contact.name,
        userName: user.ok ? user.value.name : null,
        workspaceName: workspace.ok ? workspace.value.name : null,
      },
    )

    const buttons = parseStoredButtons(quickReply.value.buttons)
    const sent = await sendQuickReplyParts({
      connection: connection.value,
      to: conversation.value.contact.waId,
      text,
      mediaUrl: quickReply.value.mediaUrl,
      quickReplyId: quickReply.value.id,
      buttons,
    })
    if (!sent.ok) return sent

    const stored: WhatsAppMessageDTO[] = []
    for (const part of sent.value) {
      const message = await WhatsAppMessageRepository.create({
        workspaceId,
        conversationId,
        direction: 'OUT',
        type: part.type,
        text: part.text,
        mediaUrl: part.mediaUrl,
        providerMessageId: part.providerMessageId,
        status: 'SENT',
        senderUserId: actorId,
        ...(part.buttons ? { buttons: part.buttons } : {}),
      })
      if (!message.ok) return message
      const dto = toWhatsAppMessageDTO(message.value)
      stored.push(dto)
      await publishWhatsAppEvent(workspaceId, {
        type: 'message.created',
        conversationId,
        message: dto,
      })
    }

    await WhatsAppConversationRepository.update(conversationId, {
      lastMessageAt: new Date(),
      status: 'IN_PROGRESS',
    })
    const fresh = await WhatsAppConversationRepository.findById(
      conversationId,
      workspaceId,
    )
    if (fresh.ok && fresh.value) {
      await publishWhatsAppEvent(workspaceId, {
        type: 'conversation.updated',
        conversation: toWhatsAppConversationDTO(fresh.value),
      })
    }
    void indexSearchDocument('zap-conversation', workspaceId, conversationId)

    const last = stored[stored.length - 1]
    auditMutation({
      entity: 'whatsapp_message',
      action: 'send',
      actorId,
      targetId: last.id,
      meta: {
        conversationId,
        type: 'QUICK_REPLY',
        quickReplyId: quickReply.value.id,
        buttons: buttons.length,
      },
    })

    return ok(last)
  },
}
