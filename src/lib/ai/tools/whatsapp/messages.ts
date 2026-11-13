import { z } from 'zod'
import {
  whatsappConnectionNotFound,
  whatsappContactNotFound,
  whatsappConversationAiHandling,
} from '@/src/errors'
import { appError, validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { sdWhatsappWindow } from '@/src/lib/servicedesk/whatsapp'
import {
  buildMetaSendComponents,
  extractTemplateFillableFields,
  parseMetaTemplateComponents,
  renderTemplateText,
} from '@/src/lib/whatsapp/template-variables'
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConnectionService } from '@/src/services/whatsapp-connection.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { WhatsAppMessageService } from '@/src/services/whatsapp-message.service'
import { WhatsAppTemplateService } from '@/src/services/whatsapp-template.service'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
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
  /** Templates are the one thing allowed outside the 24 h window. */
  enforceWindow = true,
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

  if (enforceWindow && connection.provider === 'META') {
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

/* ------------------------------ template send ------------------------------ */

const SendTemplateArgs = z.object({
  conversationId: idSchema,
  templateName: z.string().trim().min(1).max(512),
  language: z.string().trim().min(1).max(20).optional(),
  bodyVariables: z.array(z.string().trim().max(1024)).max(20).default([]),
  headerVariables: z.array(z.string().trim().max(1024)).max(5).default([]),
})
type SendTemplateArgs = z.infer<typeof SendTemplateArgs>

export const whatsappTemplateNotApproved = () =>
  appError(
    'WHATSAPP_TEMPLATE_NOT_APPROVED',
    'Este modelo ainda não foi aprovado pela Meta: só modelos aprovados podem ser enviados. Veja o status em Comunicação > Modelos.',
  )

interface ResolvedTemplate {
  template: WhatsAppTemplateDTO
  components: unknown[]
  rendered: string
}

/** Finds the approved template of the conversation's connection and fills it. */
async function resolveTemplate(
  ctx: AiToolContext,
  connectionId: string,
  args: SendTemplateArgs,
): Promise<Result<ResolvedTemplate>> {
  const templates = await WhatsAppTemplateService.list(
    ctx.actorId,
    ctx.workspaceId,
  )
  if (!templates.ok) return templates
  const candidates = templates.value.filter(
    (t) =>
      t.connectionId === connectionId &&
      t.name === args.templateName &&
      (!args.language || t.language === args.language),
  )
  const template =
    candidates.find((t) => t.status === 'APPROVED') ?? candidates[0]
  if (!template) {
    return err(
      validationError(
        `Não encontrei o modelo "${args.templateName}" nesta conexão. Confira o nome com zap_templates_list.`,
      ),
    )
  }
  if (template.status !== 'APPROVED') return err(whatsappTemplateNotApproved())

  const fields = extractTemplateFillableFields(
    parseMetaTemplateComponents(template.components),
  )
  if (fields.urlButtonVariables.length > 0) {
    return err(
      validationError(
        'Este modelo tem botão de link com variável: envie-o pela tela de conversas do Steel.',
      ),
    )
  }
  if (args.bodyVariables.length !== fields.body.variableCount) {
    return err(
      validationError(
        `O modelo pede ${fields.body.variableCount} variável(is) no corpo e vieram ${args.bodyVariables.length}.`,
      ),
    )
  }
  if (args.headerVariables.length !== fields.header.variableCount) {
    return err(
      validationError(
        `O modelo pede ${fields.header.variableCount} variável(is) no cabeçalho e vieram ${args.headerVariables.length}.`,
      ),
    )
  }
  const indexed = (list: string[]) =>
    Object.fromEntries(list.map((value, i) => [i + 1, value]))
  const values = {
    header: indexed(args.headerVariables),
    body: indexed(args.bodyVariables),
    buttons: {},
  }
  return ok({
    template,
    components: buildMetaSendComponents(fields, values),
    rendered: renderTemplateText(fields.body.text, values.body),
  })
}

export const zapTemplateSendTool: SteelAiTool<SendTemplateArgs> = {
  name: 'zap_template_send',
  label: 'Enviando modelo no WhatsApp',
  module: 'COMMUNICATION',
  kind: 'ACTION',
  annotations: { destructiveHint: false, openWorldHint: true },
  customerFacing: true,
  description:
    'Envia um MODELO de mensagem APROVADO pela Meta ao cliente numa conversa aberta do WhatsApp. É a forma de falar com o cliente fora da janela de 24 h. A mensagem vai ao cliente de verdade e não pode ser desfeita. Recusa conversas encerradas, conversas sob resposta automática da IA, contatos descadastrados (LGPD) e modelos não aprovados. Passe `templateName` (de zap_templates_list) e, se o modelo tiver variáveis {{1}}, {{2}}…, `bodyVariables` (e `headerVariables`) na ordem, com o texto final de cada uma.',
  parameters: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'Id da conversa (de zap_conversations_list).',
      },
      templateName: {
        type: 'string',
        description: 'Nome do modelo aprovado (de zap_templates_list).',
      },
      language: {
        type: 'string',
        description: 'Idioma do modelo, ex.: pt_BR (opcional).',
      },
      bodyVariables: {
        type: 'array',
        items: { type: 'string' },
        description: 'Valores de {{1}}, {{2}}… do corpo, em ordem.',
      },
      headerVariables: {
        type: 'array',
        items: { type: 'string' },
        description: 'Valores das variáveis do cabeçalho, em ordem.',
      },
    },
    required: ['conversationId', 'templateName'],
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'CREATE' },
  parse: zodParser(SendTemplateArgs),
  async preview(ctx, args) {
    const loaded = await loadSendable(
      ctx,
      args.conversationId,
      new Date(),
      false,
    )
    if (!loaded.ok) return loaded
    const { conversation, connection, base } = loaded.value
    const resolved = await resolveTemplate(ctx, connection.id, args)
    if (!resolved.ok) return resolved
    const recipient = contactLabel(conversation)
    return ok({
      title: `Enviar modelo "${resolved.value.template.name}" para ${recipient}`,
      summary:
        'Atenção: o modelo será entregue ao cliente pelo WhatsApp e não pode ser desfeito.',
      fields: [
        { label: 'Destinatário', after: recipient },
        {
          label: 'Conexão',
          after: `${connection.label} (${connection.phoneNumber})`,
        },
        { label: 'Modelo', after: resolved.value.template.name },
        { label: 'Mensagem', after: resolved.value.rendered },
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
    const loaded = await loadSendable(
      ctx,
      args.conversationId,
      new Date(),
      false,
    )
    if (!loaded.ok) return loaded
    const { conversation, connection, base } = loaded.value
    const resolved = await resolveTemplate(ctx, connection.id, args)
    if (!resolved.ok) return resolved
    const sent = await WhatsAppMessageService.sendTemplate(
      ctx.actorId,
      ctx.workspaceId,
      args.conversationId,
      {
        templateName: resolved.value.template.name,
        language: resolved.value.template.language,
        components: resolved.value.components,
      },
    )
    if (!sent.ok) return sent
    const recipient = contactLabel(conversation)
    return ok({
      data: {
        messageId: sent.value.id,
        conversationId: conversation.id,
        status: sent.value.status,
      },
      summary: `Modelo enviado para ${recipient}`,
      target: {
        type: 'whatsapp_conversation',
        id: conversation.id,
        label: recipient,
        href: conversationHref(base, conversation.id),
      },
    })
  },
}
