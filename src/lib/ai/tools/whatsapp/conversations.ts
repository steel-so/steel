import { z } from 'zod'
import {
  validationError,
  whatsappConversationAlreadyClosed,
  whatsappConversationNotClosed,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { WhatsAppMessageService } from '@/src/services/whatsapp-message.service'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { AiToolContext, SteelAiTool } from '../types'
import {
  compactConversation,
  compactMessage,
  contactLabel,
  conversationHref,
  idSchema,
  limitParameter,
  limitSchema,
  matches,
  NEGATIVE_SENTIMENT_THRESHOLD,
  offsetParameter,
  offsetSchema,
  paginate,
  STATUS_LABELS,
  zapBasePath,
  zodParser,
} from './shared'

/** Conversation tools: list/get/summary context and the agent's writes. */

const MODULE = 'COMMUNICATION' as const

async function memberNames(
  ctx: AiToolContext,
): Promise<Result<Map<string, string>>> {
  const members = await WhatsAppConversationService.listAssignableMembers(
    ctx.actorId,
    ctx.workspaceId,
  )
  if (!members.ok) return members
  return ok(new Map(members.value.map((m) => [m.id, m.name])))
}

function conversationTarget(
  conversation: WhatsAppConversationDTO,
  base: string,
) {
  return {
    type: 'whatsapp_conversation',
    id: conversation.id,
    label: contactLabel(conversation),
    href: conversationHref(base, conversation.id),
  }
}

/** Loads the conversation (service enforces module + VIEW) and the base path. */
async function loadConversation(ctx: AiToolContext, id: string) {
  const conversation = await WhatsAppConversationService.get(
    ctx.actorId,
    ctx.workspaceId,
    id,
  )
  if (!conversation.ok) return conversation
  const base = await zapBasePath(ctx.workspaceId)
  if (!base.ok) return base
  return ok({ conversation: conversation.value, base: base.value })
}

/* ---------------------------------- list ---------------------------------- */

const ListArgs = z.object({
  status: z
    .enum(['OPEN', 'NEW', 'IN_PROGRESS', 'CLOSED', 'ALL'])
    .default('OPEN'),
  assignedTo: z.string().trim().min(1).max(64).optional(),
  connectionId: idSchema.optional(),
  unreadOnly: z.boolean().default(false),
  negativeSentiment: z.boolean().default(false),
  lastMessageAfter: z.coerce.date().optional(),
  lastMessageBefore: z.coerce.date().optional(),
  archived: z.boolean().default(false),
  query: z.string().trim().min(1).max(100).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})
type ListArgs = z.infer<typeof ListArgs>

function filterConversations(
  items: WhatsAppConversationDTO[],
  args: ListArgs,
  actorId: string,
): WhatsAppConversationDTO[] {
  const assignee =
    args.assignedTo === 'me' ? actorId : (args.assignedTo ?? null)
  const after = args.lastMessageAfter?.getTime()
  const before = args.lastMessageBefore?.getTime()
  return items.filter((c) => {
    if (assignee === 'unassigned' && c.assignedUserId) return false
    if (assignee && assignee !== 'unassigned' && c.assignedUserId !== assignee)
      return false
    if (args.unreadOnly && c.unreadCount === 0) return false
    if (
      args.negativeSentiment &&
      (c.avgSentimentScore === null ||
        c.avgSentimentScore > NEGATIVE_SENTIMENT_THRESHOLD)
    )
      return false
    const last = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : null
    if (after !== undefined && (last === null || last < after)) return false
    if (before !== undefined && (last === null || last > before)) return false
    if (
      args.query &&
      !matches(c.contactName, args.query) &&
      !c.contactWaId.includes(args.query) &&
      !matches(c.lastMessagePreview, args.query)
    )
      return false
    return true
  })
}

export const zapConversationsListTool: SteelAiTool<ListArgs> = {
  name: 'zap_conversations_list',
  label: 'Consultando conversas do WhatsApp',
  module: MODULE,
  kind: 'READ',
  description:
    'Lista conversas do WhatsApp (mais recentes primeiro, fixadas no topo). Filtros: `status` (OPEN = novas + em atendimento, padrão; NEW, IN_PROGRESS, CLOSED, ALL), `assignedTo` ("me", "unassigned" ou o id de um usuário), `connectionId`, `unreadOnly`, `negativeSentiment` (média de sentimento ≤ -0,3), `lastMessageAfter`/`lastMessageBefore` (data ISO), `archived` (padrão false) e `query` (nome/número do contato ou trecho da última mensagem). Pagina com `limit`/`offset`.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['OPEN', 'NEW', 'IN_PROGRESS', 'CLOSED', 'ALL'],
      },
      assignedTo: {
        type: 'string',
        description: '"me", "unassigned" ou o id do usuário responsável.',
      },
      connectionId: {
        type: 'string',
        description: 'Id da conexão (de zap_connections_status).',
      },
      unreadOnly: { type: 'boolean' },
      negativeSentiment: { type: 'boolean' },
      lastMessageAfter: {
        type: 'string',
        description: 'Data/hora ISO 8601 (inclusive).',
      },
      lastMessageBefore: {
        type: 'string',
        description: 'Data/hora ISO 8601 (inclusive).',
      },
      archived: { type: 'boolean' },
      query: { type: 'string' },
      limit: limitParameter,
      offset: offsetParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'VIEW' },
  parse: zodParser(ListArgs),
  async execute(ctx, args) {
    const list = await WhatsAppConversationService.list(
      ctx.actorId,
      ctx.workspaceId,
      {
        status: args.status === 'ALL' ? undefined : args.status,
        archived: args.archived,
        connectionId: args.connectionId,
      },
    )
    if (!list.ok) return list
    const [names, base] = await Promise.all([
      memberNames(ctx),
      zapBasePath(ctx.workspaceId),
    ])
    if (!names.ok) return names
    if (!base.ok) return base

    const page = paginate(
      filterConversations(list.value, args, ctx.actorId),
      args.offset,
      args.limit,
    )
    return ok({
      data: {
        ...page,
        items: page.items.map((c) =>
          compactConversation(c, base.value, names.value),
        ),
      },
      summary: `${page.total} conversa(s) encontrada(s)`,
    })
  },
}

/* ----------------------------------- get ---------------------------------- */

const GetArgs = z.object({
  conversationId: idSchema,
  messages: limitSchema,
})
type GetArgs = z.infer<typeof GetArgs>

export const zapConversationGetTool: SteelAiTool<GetArgs> = {
  name: 'zap_conversation_get',
  label: 'Abrindo conversa do WhatsApp',
  module: MODULE,
  kind: 'READ',
  description:
    'Detalhes de uma conversa do WhatsApp e as últimas `messages` mensagens (padrão 20, máximo 50), da mais antiga para a mais nova. Só texto: mídia aparece como tipo + legenda. `author` é cliente, atendente ou ia.',
  parameters: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'Id da conversa (de zap_conversations_list).',
      },
      messages: { ...limitParameter, description: 'Mensagens (padrão 20).' },
    },
    required: ['conversationId'],
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'VIEW' },
  parse: zodParser(GetArgs),
  async execute(ctx, args) {
    const loaded = await loadConversation(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const [messages, names] = await Promise.all([
      WhatsAppMessageService.list(
        ctx.actorId,
        ctx.workspaceId,
        args.conversationId,
        { limit: args.messages },
      ),
      memberNames(ctx),
    ])
    if (!messages.ok) return messages
    if (!names.ok) return names

    const { conversation, base } = loaded.value
    return ok({
      data: {
        conversation: {
          ...compactConversation(conversation, base, names.value),
          closeReason: conversation.closeReason,
          contactSince: conversation.contactSince,
        },
        messages: messages.value.map(compactMessage),
      },
      summary: `Conversa com ${contactLabel(conversation)}: ${messages.value.length} mensagem(ns)`,
      target: conversationTarget(conversation, base),
    })
  },
}

/* ----------------------------- summary context ---------------------------- */

const SummaryArgs = z.object({
  conversationId: idSchema,
  messages: z.coerce.number().int().min(1).max(50).default(30),
})
type SummaryArgs = z.infer<typeof SummaryArgs>

export const zapConversationSummaryContextTool: SteelAiTool<SummaryArgs> = {
  name: 'zap_conversation_summary_context',
  label: 'Lendo a conversa para resumir',
  module: MODULE,
  kind: 'READ',
  description:
    'Devolve as últimas `messages` mensagens (padrão 30, máximo 50) de uma conversa do WhatsApp como transcrição, para VOCÊ resumir na resposta (não chama outro modelo). Use quando pedirem um resumo da conversa.',
  parameters: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'Id da conversa (de zap_conversations_list).',
      },
      messages: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Mensagens (padrão 30).',
      },
    },
    required: ['conversationId'],
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'VIEW' },
  parse: zodParser(SummaryArgs),
  async execute(ctx, args) {
    const loaded = await loadConversation(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const messages = await WhatsAppMessageService.list(
      ctx.actorId,
      ctx.workspaceId,
      args.conversationId,
      { limit: args.messages },
    )
    if (!messages.ok) return messages

    const authors = { cliente: 'Cliente', atendente: 'Atendente', ia: 'IA' }
    const transcript = messages.value.map((m) => {
      const c = compactMessage(m)
      const body =
        'text' in c
          ? (c.text ?? '')
          : `[${c.type.toLowerCase()}]${c.caption ? ` ${c.caption}` : ''}`
      return `[${c.at}] ${authors[c.author as keyof typeof authors]}: ${body}`
    })

    const { conversation, base } = loaded.value
    return ok({
      data: {
        contact: contactLabel(conversation),
        status: STATUS_LABELS[conversation.status],
        messageCount: transcript.length,
        transcript,
      },
      summary: `${transcript.length} mensagem(ns) para resumir`,
      target: conversationTarget(conversation, base),
    })
  },
}

/* --------------------------------- assign --------------------------------- */

const AssignArgs = z.object({
  conversationId: idSchema,
  userId: z.string().trim().min(1).max(64),
})
type AssignArgs = z.infer<typeof AssignArgs>

export const zapConversationAssignTool: SteelAiTool<AssignArgs> = {
  name: 'zap_conversation_assign',
  label: 'Atribuindo conversa',
  module: MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Atribui (ou transfere, se já tiver responsável) uma conversa do WhatsApp a um membro. `userId` = id do usuário ou "me". Descubra o id com ws_members.',
  parameters: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'Id da conversa (de zap_conversations_list).',
      },
      userId: { type: 'string', description: 'Id do usuário ou "me".' },
    },
    required: ['conversationId', 'userId'],
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'EDIT' },
  parse: zodParser(AssignArgs),
  async preview(ctx, args) {
    const loaded = await loadConversation(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const names = await memberNames(ctx)
    if (!names.ok) return names

    const userId = args.userId === 'me' ? ctx.actorId : args.userId
    const target = names.value.get(userId)
    if (!target) {
      return err(validationError('Usuário não é membro deste workspace'))
    }
    const { conversation, base } = loaded.value
    if (conversation.assignedUserId === userId) {
      return err(validationError(`A conversa já está com ${target}`))
    }
    const current = conversation.assignedUserId
      ? (names.value.get(conversation.assignedUserId) ?? 'Membro removido')
      : null
    const verb = current ? 'Transferir' : 'Atribuir'
    return ok({
      title: `${verb} a conversa com ${contactLabel(conversation)}`,
      summary: `${verb} para ${target}.`,
      fields: [{ label: 'Responsável', before: current, after: target }],
      target: conversationTarget(conversation, base),
    })
  },
  async execute(ctx, args) {
    const userId = args.userId === 'me' ? ctx.actorId : args.userId
    const updated = await WhatsAppConversationService.assign(
      ctx.actorId,
      ctx.workspaceId,
      args.conversationId,
      userId,
    )
    if (!updated.ok) return updated
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: { id: updated.value.id, assignedUserId: userId },
      summary: `Conversa com ${contactLabel(updated.value)} atribuída`,
      target: conversationTarget(updated.value, base.value),
    })
  },
}

/* -------------------------------- unassign -------------------------------- */

const ConversationArgs = z.object({ conversationId: idSchema })
type ConversationArgs = z.infer<typeof ConversationArgs>

const conversationParameters = {
  type: 'object',
  properties: {
    conversationId: {
      type: 'string',
      description: 'Id da conversa (de zap_conversations_list).',
    },
  },
  required: ['conversationId'],
  additionalProperties: false,
}

export const zapConversationUnassignTool: SteelAiTool<ConversationArgs> = {
  name: 'zap_conversation_unassign',
  label: 'Removendo responsável da conversa',
  module: MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Tira o responsável de uma conversa do WhatsApp (ela volta para a fila sem atendente).',
  parameters: conversationParameters,
  permission: { resource: 'conversations', action: 'EDIT' },
  parse: zodParser(ConversationArgs),
  async preview(ctx, args) {
    const loaded = await loadConversation(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const { conversation, base } = loaded.value
    if (!conversation.assignedUserId) {
      return err(validationError('A conversa não tem responsável'))
    }
    const names = await memberNames(ctx)
    if (!names.ok) return names
    return ok({
      title: `Remover o responsável da conversa com ${contactLabel(conversation)}`,
      summary: 'A conversa fica sem atendente.',
      fields: [
        {
          label: 'Responsável',
          before:
            names.value.get(conversation.assignedUserId) ?? 'Membro removido',
          after: null,
        },
      ],
      target: conversationTarget(conversation, base),
    })
  },
  async execute(ctx, args) {
    const updated = await WhatsAppConversationService.assign(
      ctx.actorId,
      ctx.workspaceId,
      args.conversationId,
      null,
    )
    if (!updated.ok) return updated
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: { id: updated.value.id, assignedUserId: null },
      summary: `Conversa com ${contactLabel(updated.value)} sem responsável`,
      target: conversationTarget(updated.value, base.value),
    })
  },
}

/* ---------------------------------- close --------------------------------- */

const CloseArgs = z.object({
  conversationId: idSchema,
  reason: z.string().trim().min(1).max(500).optional(),
})
type CloseArgs = z.infer<typeof CloseArgs>

export const zapConversationCloseTool: SteelAiTool<CloseArgs> = {
  name: 'zap_conversation_close',
  label: 'Encerrando conversa',
  module: MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Encerra uma conversa aberta do WhatsApp, com `reason` opcional (até 500 caracteres). Não envia nada ao cliente.',
  parameters: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'Id da conversa (de zap_conversations_list).',
      },
      reason: { type: 'string', description: 'Motivo (opcional).' },
    },
    required: ['conversationId'],
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'EDIT' },
  parse: zodParser(CloseArgs),
  async preview(ctx, args) {
    const loaded = await loadConversation(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const { conversation, base } = loaded.value
    if (conversation.status === 'CLOSED') {
      return err(whatsappConversationAlreadyClosed())
    }
    return ok({
      title: `Encerrar a conversa com ${contactLabel(conversation)}`,
      summary: 'Nenhuma mensagem é enviada ao cliente.',
      fields: [
        {
          label: 'Status',
          before: STATUS_LABELS[conversation.status],
          after: STATUS_LABELS.CLOSED,
        },
        ...(args.reason
          ? [{ label: 'Motivo', before: null, after: args.reason }]
          : []),
      ],
      target: conversationTarget(conversation, base),
    })
  },
  async execute(ctx, args) {
    const closed = await WhatsAppConversationService.close(
      ctx.actorId,
      ctx.workspaceId,
      args.conversationId,
      { reason: args.reason },
    )
    if (!closed.ok) return closed
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: { id: closed.value.id, status: closed.value.status },
      summary: `Conversa com ${contactLabel(closed.value)} encerrada`,
      target: conversationTarget(closed.value, base.value),
    })
  },
}

/* --------------------------------- reopen --------------------------------- */

export const zapConversationReopenTool: SteelAiTool<ConversationArgs> = {
  name: 'zap_conversation_reopen',
  label: 'Reabrindo conversa',
  module: MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Reabre uma conversa encerrada do WhatsApp (volta para "em atendimento" se tiver responsável, senão "nova").',
  parameters: conversationParameters,
  permission: { resource: 'conversations', action: 'EDIT' },
  parse: zodParser(ConversationArgs),
  async preview(ctx, args) {
    const loaded = await loadConversation(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const { conversation, base } = loaded.value
    if (conversation.status !== 'CLOSED') {
      return err(whatsappConversationNotClosed())
    }
    return ok({
      title: `Reabrir a conversa com ${contactLabel(conversation)}`,
      summary: 'Nenhuma mensagem é enviada ao cliente.',
      fields: [
        {
          label: 'Status',
          before: STATUS_LABELS.CLOSED,
          after:
            STATUS_LABELS[conversation.assignedUserId ? 'IN_PROGRESS' : 'NEW'],
        },
      ],
      target: conversationTarget(conversation, base),
    })
  },
  async execute(ctx, args) {
    const reopened = await WhatsAppConversationService.reopen(
      ctx.actorId,
      ctx.workspaceId,
      args.conversationId,
    )
    if (!reopened.ok) return reopened
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: { id: reopened.value.id, status: reopened.value.status },
      summary: `Conversa com ${contactLabel(reopened.value)} reaberta`,
      target: conversationTarget(reopened.value, base.value),
    })
  },
}

/* ---------------------------- AI auto-reply toggle ------------------------ */

const SetAiArgs = z.object({ conversationId: idSchema, enabled: z.boolean() })
type SetAiArgs = z.infer<typeof SetAiArgs>

const aiLabel = (on: boolean) => (on ? 'Ligada' : 'Desligada')

export const zapConversationSetAiTool: SteelAiTool<SetAiArgs> = {
  name: 'zap_conversation_set_ai',
  label: 'Alterando a resposta automática da IA',
  module: MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Liga (`enabled: true`) ou desliga (`enabled: false`) a resposta automática da IA do WhatsApp na conversa indicada. Ligada, a IA do workspace passa a responder ao cliente sozinha; desligada, a conversa fica com atendimento humano.',
  parameters: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'Id da conversa (de zap_conversations_list).',
      },
      enabled: { type: 'boolean' },
    },
    required: ['conversationId', 'enabled'],
    additionalProperties: false,
  },
  permission: { resource: 'conversations', action: 'EDIT' },
  parse: zodParser(SetAiArgs),
  async preview(ctx, args) {
    const loaded = await loadConversation(ctx, args.conversationId)
    if (!loaded.ok) return loaded
    const { conversation, base } = loaded.value
    if (conversation.aiActive === args.enabled) {
      return err(
        validationError(
          `A resposta automática da IA já está ${aiLabel(args.enabled).toLowerCase()} nesta conversa`,
        ),
      )
    }
    return ok({
      title: `${args.enabled ? 'Ligar' : 'Desligar'} a IA na conversa com ${contactLabel(conversation)}`,
      summary: args.enabled
        ? 'A IA volta a responder o cliente automaticamente.'
        : 'A IA para de responder; a conversa fica com atendimento humano.',
      fields: [
        {
          label: 'Resposta automática da IA',
          before: aiLabel(conversation.aiActive),
          after: aiLabel(args.enabled),
        },
      ],
      target: conversationTarget(conversation, base),
    })
  },
  async execute(ctx, args) {
    const updated = args.enabled
      ? await WhatsAppConversationService.resumeAi(
          ctx.actorId,
          ctx.workspaceId,
          args.conversationId,
        )
      : await WhatsAppConversationService.removeFromAi(
          ctx.actorId,
          ctx.workspaceId,
          args.conversationId,
        )
    if (!updated.ok) return updated
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: { id: updated.value.id, aiActive: updated.value.aiActive },
      summary: `IA ${aiLabel(args.enabled).toLowerCase()} na conversa com ${contactLabel(updated.value)}`,
      target: conversationTarget(updated.value, base.value),
    })
  },
}
