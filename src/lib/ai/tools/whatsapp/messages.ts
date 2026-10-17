import { z } from 'zod'
import {
  whatsappConnectionNotFound,
  whatsappContactNotFound,
  whatsappConversationAiHandling,
} from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { sdWhatsappWindow } from '@/src/lib/servicedesk/whatsapp'
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConnectionService } from '@/src/services/whatsapp-connection.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { WhatsAppMessageService } from '@/src/services/whatsapp-message.service'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { AiToolContext, SteelAiTool } from '../types'
import {
  contactLabel,
  conversationHref,
  idSchema,
  zapBasePath,
  zodParser,
} from './shared'

/**
 * Sending a text reply to a customer (ACTION). Guards run in preview AND
 * again at execution (the state may change while the action is pending):
 * open conversation, not under AI auto-reply, contact not opted out (LGPD)
 * and, on the Meta Cloud API, inside the 24 h customer-service window. The
 * message service then sends and its errors (provider, rate limit) surface
 * as they are.
 */

export const whatsappContactOptedOut = () =>
  appError(
    'WHATSAPP_CONTACT_OPTED_OUT',
    'Este contato pediu para não receber mensagens (LGPD): mensagens automáticas não são enviadas a ele. Se for o caso, responda manualmente pela conversa no Steel.',
  )

export const whatsappSessionWindowClosed = () =>
  appError(
    'WHATSAPP_SESSION_WINDOW_CLOSED',
    'Fora da janela de 24 h do WhatsApp (API oficial da Meta): texto livre não é permitido. Envie um modelo aprovado pela tela de conversas do Steel.',
  )

const closedConversation = () =>
  appError(
    'WHATSAPP_CONVERSATION_ALREADY_CLOSED',
    'A conversa está encerrada: reabra-a antes de responder.',
  )

interface Sendable {
  conversation: WhatsAppConversationDTO
  connection: WhatsAppConnectionDTO
  base: string
}

async function loadSendable(
  ctx: AiToolContext,
  conversationId: string,
  now: Date = new Date(),
): Promise<Result<Sendable>> {
  const conversation = await WhatsAppConversationService.get(
    ctx.actorId,
    ctx.workspaceId,
    conversationId,
  )
  if (!conversation.ok) return conversation
  const c = conversation.value
  if (c.status === 'CLOSED') return err(closedConversation())
  if (c.aiActive) return err(whatsappConversationAiHandling())

  const contact = await WhatsAppContactRepository.findById(
    c.contactId,
    ctx.workspaceId,
  )
  if (!contact.ok) return contact
  if (!contact.value) return err(whatsappContactNotFound())
  if (contact.value.broadcastOptedOutAt) return err(whatsappContactOptedOut())

  const connections = await WhatsAppConnectionService.list(
    ctx.actorId,
    ctx.workspaceId,
  )
  if (!connections.ok) return connections
  const connection = connections.value.find((x) => x.id === c.connectionId)
  if (!connection) return err(whatsappConnectionNotFound())

  if (connection.provider === 'META') {
    const lastInbound = await SdWhatsappRepository.lastInboundAt(c.id)
    if (!lastInbound.ok) return lastInbound
    if (!sdWhatsappWindow('META', lastInbound.value, now).open) {
      return err(whatsappSessionWindowClosed())
    }
  }

  const base = await zapBasePath(ctx.workspaceId)
  if (!base.ok) return base
  return ok({ conversation: c, connection, base: base.value })
}

const SendTextArgs = z.object({
  conversationId: idSchema,
  text: z.string().trim().min(1).max(4096),
})
type SendTextArgs = z.infer<typeof SendTextArgs>

export const zapMessageSendTextTool: SteelAiTool<SendTextArgs> = {
  name: 'zap_message_send_text',
  label: 'Enviando mensagem no WhatsApp',
  module: 'COMMUNICATION',
  kind: 'ACTION',
  annotations: { destructiveHint: false, openWorldHint: true },
  customerFacing: true,
  description:
    'Envia uma mensagem de TEXTO ao cliente numa conversa aberta do WhatsApp (até 4096 caracteres). A mensagem vai ao cliente de verdade e não pode ser desfeita. Recusa conversas encerradas, conversas sob resposta automática da IA, contatos descadastrados (LGPD) e, na API oficial da Meta, conversas fora da janela de 24 h (aí só um modelo aprovado, enviado por uma pessoa no app do Steel). Escreva o texto final exatamente como deve chegar ao cliente.',
  parameters: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'Id da conversa (de zap_conversations_list).',
      },
      text: {
        type: 'string',
        description: 'Texto exato que o cliente vai receber.',
      },
    },
    required: ['conversationId', 'text'],
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'CREATE' },
  parse: zodParser(SendTextArgs),
  async preview(ctx, args) {
    const loaded = await loadSendable(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const { conversation, connection, base } = loaded.value
    const recipient = contactLabel(conversation)
    return ok({
      title: `Enviar mensagem no WhatsApp para ${recipient}`,
      summary:
        'Atenção: a mensagem será entregue ao cliente pelo WhatsApp e não pode ser desfeita.',
      fields: [
        { label: 'Destinatário', after: recipient },
        {
          label: 'Conexão',
          after: `${connection.label} (${connection.phoneNumber})`,
        },
        { label: 'Mensagem', after: args.text },
      ],
      target: {
        type: 'whatsapp_conversation',
        id: conversation.id,
        label: recipient,
        href: conversationHref(base, conversation.id),
      },
    })
  },
  async execute(ctx, args) {
    const loaded = await loadSendable(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const sent = await WhatsAppMessageService.sendText(
      ctx.actorId,
      ctx.workspaceId,
      args.conversationId,
      { text: args.text },
    )
    if (!sent.ok) return sent
    const { conversation, base } = loaded.value
    const recipient = contactLabel(conversation)
    return ok({
      data: {
        messageId: sent.value.id,
        conversationId: conversation.id,
        status: sent.value.status,
      },
      summary: `Mensagem enviada para ${recipient}`,
      target: {
        type: 'whatsapp_conversation',
        id: conversation.id,
        label: recipient,
        href: conversationHref(base, conversation.id),
      },
    })
  },
}
