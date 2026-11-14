import type {
  Prisma,
  SdAttachmentKind,
  SdMessageAuthorKind,
  SdMessageChannel,
  SdMessageVisibility,
  WhatsAppTemplate,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb } from './sd-config-db'

/**
 * Acesso a dados do WhatsApp do ServiceDesk: conversas das conexões com
 * `module = SERVICE_DESK`, o vínculo conversa ↔ chamado e o espelho das
 * mensagens no histórico do chamado (`SdTicketMessage` com `channel =
 * WHATSAPP`). As tabelas `whatsapp_*` são do zap; as de mensagem/anexo do
 * chamado, da fatia ticket-tabs — aqui só as linhas que o WhatsApp cria.
 */

const SD_CONNECTION = { module: 'SERVICE_DESK' as const }

export const SD_WA_CONVERSATION_INCLUDE = {
  contact: true,
  connection: true,
  messages: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.WhatsAppConversationInclude

export type SdWaConversation = Prisma.WhatsAppConversationGetPayload<{
  include: typeof SD_WA_CONVERSATION_INCLUDE
}>

/** Fases que encerram o chamado (a conversa volta a abrir chamado novo). */
const CLOSED_PHASES = ['CLOSED', 'CANCELED'] as const

const OPEN_TICKET_WHERE = {
  deletedAt: null,
  phase: { category: { notIn: [...CLOSED_PHASES] } },
} satisfies Prisma.SdTicketWhereInput

export interface SdOpenTicketRef {
  id: string
  number: number
  type: 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE' | 'PROBLEM'
}

export type SdWaConversationListRow = SdWaConversation & {
  sdTickets: SdOpenTicketRef[]
}

export interface SdTicketMessageInput {
  workspaceId: string
  ticketId: string
  authorKind: SdMessageAuthorKind
  authorUserId?: string | null
  authorContactId?: string | null
  visibility?: SdMessageVisibility
  channel: SdMessageChannel
  body: string
  whatsappMessageId?: string | null
  attachment?: {
    kind: SdAttachmentKind
    fileName: string
    mimeType: string
    size: number
    storageKey: string
    uploadedById?: string | null
  } | null
}

export const SdWhatsappRepository = {
  /**
   * Conversa de uma conexão do ServiceDesk na workspace (`null` = não é).
   *
   * Com `linkedTicketId`, vale também a conversa do zap (conexão
   * `COMMUNICATION`) que esse chamado já tem vinculada: foi vinculada por quem
   * abriu o chamado a partir dela (`SdTicketSourceService`), então quem vê o
   * chamado vê a conversa. Sem o id, só as conversas do ServiceDesk.
   */
  async findConversation(
    workspaceId: string,
    conversationId: string,
    linkedTicketId?: string,
  ): Promise<Result<SdWaConversation | null>> {
    return sdDb('Failed to find ServiceDesk WhatsApp conversation', () =>
      prisma.whatsAppConversation.findFirst({
        where: {
          id: conversationId,
          workspaceId,
          deletedAt: null,
          ...(linkedTicketId
            ? {
                OR: [
                  { connection: SD_CONNECTION },
                  {
                    connection: { module: 'COMMUNICATION' as const },
                    sdTickets: { some: { id: linkedTicketId } },
                  },
                ],
              }
            : { connection: SD_CONNECTION }),
        },
        include: SD_WA_CONVERSATION_INCLUDE,
      }),
    )
  },

  /** Sem escopo de workspace: jobs em background recebem só o id. */
  async findConversationUnscoped(
    conversationId: string,
  ): Promise<Result<SdWaConversation | null>> {
    return sdDb('Failed to find ServiceDesk WhatsApp conversation', () =>
      prisma.whatsAppConversation.findFirst({
        where: { id: conversationId, connection: SD_CONNECTION },
        include: SD_WA_CONVERSATION_INCLUDE,
      }),
    )
  },

  /** Conversas do ServiceDesk (vincular ao chamado), mais recentes primeiro. */
  async listConversations(
    workspaceId: string,
    query: { q?: string; limit: number },
  ): Promise<Result<SdWaConversationListRow[]>> {
    const q = query.q?.trim()
    const digits = q?.replace(/\D/g, '')
    return sdDb('Failed to list ServiceDesk WhatsApp conversations', () =>
      prisma.whatsAppConversation.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          connection: SD_CONNECTION,
          ...(q
            ? {
                contact: {
                  OR: [
                    { name: { contains: q, mode: 'insensitive' as const } },
                    ...(digits ? [{ waId: { contains: digits } }] : []),
                  ],
                },
              }
            : {}),
        },
        include: {
          ...SD_WA_CONVERSATION_INCLUDE,
          sdTickets: {
            where: OPEN_TICKET_WHERE,
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, number: true, type: true },
          },
        },
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }],
        take: query.limit,
      }),
    )
  },

  /** Conversa ativa do contato numa conexão (NEW/IN_PROGRESS, não excluída). */
  async findActiveConversation(
    connectionId: string,
    contactId: string,
  ): Promise<Result<{ id: string } | null>> {
    return sdDb('Failed to find ServiceDesk WhatsApp conversation', () =>
      prisma.whatsAppConversation.findFirst({
        where: {
          connectionId,
          contactId,
          deletedAt: null,
          status: { in: ['NEW', 'IN_PROGRESS'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    )
  },

  /** Chamado em aberto (não CLOSED/CANCELED) mais recente da conversa. */
  async findOpenTicket(
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<SdOpenTicketRef | null>> {
    return sdDb('Failed to find ServiceDesk ticket of conversation', () =>
      prisma.sdTicket.findFirst({
        where: {
          workspaceId,
          whatsappConversationId: conversationId,
          ...OPEN_TICKET_WHERE,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true, type: true },
      }),
    )
  },

  /** Chamados (não excluídos) vinculados à conversa — tempo real. */
  async listLinkedTicketIds(conversationId: string): Promise<Result<string[]>> {
    return sdDb(
      'Failed to list ServiceDesk tickets of conversation',
      async () => {
        const rows = await prisma.sdTicket.findMany({
          where: { whatsappConversationId: conversationId, deletedAt: null },
          select: { id: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
        return rows.map((r) => r.id)
      },
    )
  },

  async setTicketConversation(
    ticketId: string,
    conversationId: string | null,
  ): Promise<Result<void>> {
    return sdDb('Failed to link ServiceDesk ticket conversation', async () => {
      await prisma.sdTicket.update({
        where: { id: ticketId },
        data: { whatsappConversationId: conversationId },
      })
    })
  },

  /** Última mensagem recebida do contato (janela de 24 h da Meta). */
  async lastInboundAt(conversationId: string): Promise<Result<Date | null>> {
    return sdDb('Failed to read last inbound WhatsApp message', async () => {
      const row = await prisma.whatsAppMessage.findFirst({
        where: { conversationId, direction: 'IN', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      return row?.createdAt ?? null
    })
  },

  /** Espelho já gravado desta mensagem do WhatsApp no chamado? */
  async hasMirror(
    ticketId: string,
    whatsappMessageId: string,
  ): Promise<Result<boolean>> {
    return sdDb('Failed to check mirrored WhatsApp message', async () => {
      const count = await prisma.sdTicketMessage.count({
        where: { ticketId, whatsappMessageId },
      })
      return count > 0
    })
  },

  /** Mensagem no histórico do chamado (+ anexo espelhado, numa transação). */
  async createTicketMessage(
    input: SdTicketMessageInput,
  ): Promise<Result<{ id: string }>> {
    return sdDb('Failed to create ServiceDesk ticket message', () =>
      prisma.$transaction(async (tx) => {
        const message = await tx.sdTicketMessage.create({
          data: {
            workspaceId: input.workspaceId,
            ticketId: input.ticketId,
            authorKind: input.authorKind,
            authorUserId: input.authorUserId ?? null,
            authorContactId: input.authorContactId ?? null,
            visibility: input.visibility ?? 'PUBLIC',
            channel: input.channel,
            body: input.body,
            whatsappMessageId: input.whatsappMessageId ?? null,
          },
          select: { id: true },
        })
        if (input.attachment) {
          await tx.sdTicketAttachment.create({
            data: {
              workspaceId: input.workspaceId,
              ticketId: input.ticketId,
              messageId: message.id,
              uploadedById: input.attachment.uploadedById ?? null,
              kind: input.attachment.kind,
              fileName: input.attachment.fileName,
              mimeType: input.attachment.mimeType,
              size: input.attachment.size,
              storageKey: input.attachment.storageKey,
            },
          })
        }
        return message
      }),
    )
  },

  /** Modelos aprovados de uma conexão (envio fora da janela de 24 h). */
  async listApprovedTemplates(
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<WhatsAppTemplate[]>> {
    return sdDb('Failed to list ServiceDesk WhatsApp templates', () =>
      prisma.whatsAppTemplate.findMany({
        where: { workspaceId, connectionId, status: 'APPROVED' },
        orderBy: [{ name: 'asc' }, { language: 'asc' }],
      }),
    )
  },
}
