import {
  type AiUsageFeature,
  Prisma,
  type SdPhaseCategory,
  type SdTicketType,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { ok, type Result } from '@/src/lib/result'
import { sdDb } from './sd-config-db'

/**
 * Leituras do painel "IA vs. técnico": só consultas (a gravação das
 * sugestões do copiloto fica em `SdAiRepository.recordSuggestion`). Tudo
 * escopado por workspace.
 */

const REF = { select: { id: true, name: true } } as const

const TICKET_SELECT = {
  id: true,
  number: true,
  type: true,
  title: true,
  solution: true,
  tags: true,
  createdAt: true,
  aiTriage: true,
  phase: { select: { category: true } },
  category: REF,
  subcategory: REF,
  service: REF,
  impact: REF,
  urgency: REF,
  priority: REF,
  department: REF,
} satisfies Prisma.SdTicketSelect

type TicketRaw = Prisma.SdTicketGetPayload<{ select: typeof TICKET_SELECT }>

/** Chamado com os campos que a IA classifica e o desfecho dele. */
export interface SdAiComparisonTicketRow {
  id: string
  number: number
  type: SdTicketType
  title: string
  solution: string | null
  tags: string[]
  createdAt: Date
  aiTriage: Prisma.JsonValue | null
  phaseCategory: SdPhaseCategory
  category: { id: string; name: string } | null
  subcategory: { id: string; name: string } | null
  service: { id: string; name: string } | null
  impact: { id: string; name: string } | null
  urgency: { id: string; name: string } | null
  priority: { id: string; name: string } | null
  department: { id: string; name: string } | null
}

function toRow(raw: TicketRaw): SdAiComparisonTicketRow {
  const { phase, ...rest } = raw
  return { ...rest, phaseCategory: phase.category }
}

export interface SdAiSuggestionRow {
  id: string
  ticketId: string
  userId: string | null
  kind: string
  text: string | null
  payload: Prisma.JsonValue | null
  createdAt: Date
}

export interface SdAiAgentMessageRow {
  ticketId: string
  authorUserId: string | null
  body: string
  createdAt: Date
}

export interface SdAiUsageRow {
  feature: AiUsageFeature
  calls: number
  costUsd: number
}

export interface SdAiPreServiceRow {
  outcome: string | null
  total: number
}

const SD_AI_FEATURES: AiUsageFeature[] = [
  'SERVICEDESK_COPILOT',
  'SERVICEDESK_PRE_SERVICE',
  'SERVICEDESK_TRIAGE',
]

/** Teto de linhas por leitura: o painel é uma amostra, não um export. */
const LIMIT = 5000

export const SdAiComparisonRepository = {
  /** Chamados criados desde `from` que a triagem automática classificou. */
  async listTriaged(
    workspaceId: string,
    from: Date,
  ): Promise<Result<SdAiComparisonTicketRow[]>> {
    return sdDb('Failed to list AI-triaged ServiceDesk tickets', async () => {
      const rows = await prisma.sdTicket.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          createdAt: { gte: from },
          aiTriage: { not: Prisma.DbNull },
        },
        select: TICKET_SELECT,
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
      })
      return rows.map(toRow)
    })
  },

  /** Sugestões do copiloto entregues desde `from`. */
  async listSuggestions(
    workspaceId: string,
    from: Date,
  ): Promise<Result<SdAiSuggestionRow[]>> {
    return sdDb('Failed to list ServiceDesk AI suggestions', () =>
      prisma.sdAiSuggestion.findMany({
        where: { workspaceId, createdAt: { gte: from } },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
      }),
    )
  },

  /** Estado atual de chamados (dos que as sugestões do copiloto citam). */
  async listTicketsByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<SdAiComparisonTicketRow[]>> {
    if (ids.length === 0) return ok([])
    return sdDb('Failed to load tickets of AI suggestions', async () => {
      const rows = await prisma.sdTicket.findMany({
        where: { workspaceId, deletedAt: null, id: { in: ids } },
        select: TICKET_SELECT,
      })
      return rows.map(toRow)
    })
  },

  /** Respostas públicas dos agentes nos chamados (para casar com a IA). */
  async listAgentMessages(
    workspaceId: string,
    ticketIds: string[],
  ): Promise<Result<SdAiAgentMessageRow[]>> {
    if (ticketIds.length === 0) return ok([])
    return sdDb('Failed to list agent replies of AI suggestions', () =>
      prisma.sdTicketMessage.findMany({
        where: {
          workspaceId,
          ticketId: { in: ticketIds },
          authorKind: 'AGENT',
          visibility: 'PUBLIC',
          deletedAt: null,
          authorUserId: { not: null },
        },
        select: {
          ticketId: true,
          authorUserId: true,
          body: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    )
  },

  /** Consumo de IA do ServiceDesk por função (cota). */
  async usageByFeature(
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<Result<SdAiUsageRow[]>> {
    return sdDb('Failed to aggregate ServiceDesk AI usage', async () => {
      const groups = await prisma.aiUsage.groupBy({
        by: ['feature'],
        where: {
          workspaceId,
          feature: { in: SD_AI_FEATURES },
          createdAt: { gte: from, lt: to },
        },
        _sum: { costUsd: true },
        _count: { _all: true },
      })
      return groups.map((g) => ({
        feature: g.feature,
        calls: g._count._all,
        costUsd: Number(g._sum.costUsd),
      }))
    })
  },

  /** Desfechos do pré-atendimento por IA (portal e WhatsApp). */
  async preServiceOutcomes(
    workspaceId: string,
    from: Date,
  ): Promise<Result<SdAiPreServiceRow[]>> {
    return sdDb('Failed to aggregate ServiceDesk pre-service', async () => {
      const groups = await prisma.sdAiConversation.groupBy({
        by: ['outcome'],
        where: { workspaceId, mode: 'PRE_SERVICE', createdAt: { gte: from } },
        _count: { _all: true },
      })
      return groups.map((g) => ({ outcome: g.outcome, total: g._count._all }))
    })
  },

  async userNames(
    userIds: string[],
  ): Promise<Result<Array<{ id: string; name: string }>>> {
    if (userIds.length === 0) return ok([])
    return sdDb('Failed to load AI suggestion authors', () =>
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      }),
    )
  },
}
