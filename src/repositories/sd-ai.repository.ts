import type {
  Prisma,
  SdAiConversation,
  SdMessageAuthorKind,
  SdMessageVisibility,
  SdTicketType,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import type { SdAiCatalog } from '@/src/lib/servicedesk/ai-prompts'
import { sdDb } from './sd-config-db'

export type SdAiMode = 'COPILOT' | 'PRE_SERVICE'

export interface SdAiTicketMessageRow {
  authorKind: SdMessageAuthorKind
  visibility: SdMessageVisibility
  body: string
  createdAt: Date
}

/** Mensagens do chamado lidas como contexto da IA (as mais recentes). */
const CONTEXT_MESSAGES = 40

export const SdAiRepository = {
  async findConversation(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdAiConversation | null>> {
    return sdDb('Failed to find ServiceDesk AI conversation', () =>
      prisma.sdAiConversation.findFirst({ where: { id, workspaceId } }),
    )
  },

  /** Conversa do copiloto do agente naquele chamado (uma por agente). */
  async findCopilotConversation(
    workspaceId: string,
    ticketId: string,
    userId: string,
  ): Promise<Result<SdAiConversation | null>> {
    return sdDb('Failed to find ServiceDesk copilot conversation', () =>
      prisma.sdAiConversation.findFirst({
        where: { workspaceId, ticketId, userId, mode: 'COPILOT' },
        orderBy: { createdAt: 'desc' },
      }),
    )
  },

  /** Pré-atendimento em curso (sem desfecho) numa conversa do WhatsApp. */
  async findActiveWhatsappConversation(
    whatsappConversationId: string,
  ): Promise<Result<SdAiConversation | null>> {
    return sdDb('Failed to find ServiceDesk WhatsApp pre-service', () =>
      prisma.sdAiConversation.findFirst({
        where: { whatsappConversationId, mode: 'PRE_SERVICE', outcome: null },
        orderBy: { createdAt: 'desc' },
      }),
    )
  },

  async createConversation(data: {
    workspaceId: string
    mode: SdAiMode
    userId?: string | null
    ticketId?: string | null
    whatsappConversationId?: string | null
    messages?: Prisma.InputJsonValue
  }): Promise<Result<SdAiConversation>> {
    return sdDb('Failed to create ServiceDesk AI conversation', () =>
      prisma.sdAiConversation.create({
        data: {
          workspaceId: data.workspaceId,
          mode: data.mode,
          userId: data.userId ?? null,
          ticketId: data.ticketId ?? null,
          whatsappConversationId: data.whatsappConversationId ?? null,
          messages: data.messages ?? [],
        },
      }),
    )
  },

  async updateConversation(
    id: string,
    data: {
      messages?: Prisma.InputJsonValue
      outcome?: string | null
      ticketId?: string | null
    },
  ): Promise<Result<SdAiConversation>> {
    return sdDb('Failed to update ServiceDesk AI conversation', () =>
      prisma.sdAiConversation.update({ where: { id }, data }),
    )
  },

  async deleteConversation(id: string): Promise<Result<void>> {
    return sdDb('Failed to delete ServiceDesk AI conversation', async () => {
      await prisma.sdAiConversation.delete({ where: { id } })
    })
  },

  /**
   * Valores permitidos para a IA escolher: catálogo ativo do tipo (só o
   * visível no portal quando `portalOnly`), impacto, urgência, prioridade e
   * departamentos ativos.
   */
  async loadCatalog(
    workspaceId: string,
    options: { type?: SdTicketType | null; portalOnly?: boolean } = {},
  ): Promise<Result<SdAiCatalog>> {
    return sdDb('Failed to load ServiceDesk AI catalog', async () => {
      const [categories, impacts, urgencies, priorities, departments] =
        await Promise.all([
          prisma.sdCategory.findMany({
            where: {
              workspaceId,
              active: true,
              ...(options.portalOnly ? { portalVisible: true } : {}),
              ...(options.type
                ? {
                    OR: [
                      { ticketTypes: { isEmpty: true } },
                      { ticketTypes: { has: options.type } },
                    ],
                  }
                : {}),
            },
            select: { id: true, name: true, level: true, parentId: true },
            orderBy: [{ level: 'asc' }, { position: 'asc' }],
            take: 300,
          }),
          prisma.sdImpact.findMany({
            where: { workspaceId },
            select: { id: true, name: true, level: true },
            orderBy: { level: 'asc' },
          }),
          prisma.sdUrgency.findMany({
            where: { workspaceId },
            select: { id: true, name: true, level: true },
            orderBy: { level: 'asc' },
          }),
          prisma.sdPriority.findMany({
            where: { workspaceId },
            select: { id: true, name: true, level: true },
            orderBy: { level: 'asc' },
          }),
          prisma.sdDepartment.findMany({
            where: { workspaceId, active: true, deletedAt: null },
            select: { id: true, name: true },
            orderBy: { position: 'asc' },
          }),
        ])
      return { categories, impacts, urgencies, priorities, departments }
    })
  },

  /** Últimas mensagens do chamado (ordem cronológica). */
  async listTicketMessages(
    ticketId: string,
    options: { publicOnly?: boolean } = {},
  ): Promise<Result<SdAiTicketMessageRow[]>> {
    return sdDb('Failed to list ServiceDesk ticket messages', async () => {
      const rows = await prisma.sdTicketMessage.findMany({
        where: {
          ticketId,
          deletedAt: null,
          ...(options.publicOnly ? { visibility: 'PUBLIC' as const } : {}),
        },
        select: {
          authorKind: true,
          visibility: true,
          body: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: CONTEXT_MESSAGES,
      })
      return rows.reverse()
    })
  },

  /** Grava o resumo e/ou a triagem da IA no chamado (sem mexer em `updatedAt` de negócio). */
  async setTicketAi(
    ticketId: string,
    data: { aiSummary?: string | null; aiTriage?: Prisma.InputJsonValue },
  ): Promise<Result<void>> {
    return sdDb('Failed to store ServiceDesk ticket AI fields', async () => {
      await prisma.sdTicket.update({ where: { id: ticketId }, data })
    })
  },

  /**
   * Guarda um rascunho do copiloto (resposta, solução ou classificação) para
   * o painel "IA vs. técnico" comparar com o que o técnico fez depois.
   */
  async recordSuggestion(input: {
    workspaceId: string
    ticketId: string
    userId: string
    kind: 'REPLY' | 'SOLUTION' | 'CLASSIFICATION'
    text?: string
    payload?: Prisma.InputJsonValue
  }): Promise<Result<void>> {
    return sdDb('Failed to store ServiceDesk AI suggestion', async () => {
      await prisma.sdAiSuggestion.create({ data: input })
    })
  },
}
