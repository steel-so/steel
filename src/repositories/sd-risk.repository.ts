import type {
  Prisma,
  SdIncidentCluster,
  SdRiskLevelPrediction,
  SdTicketRiskPrediction,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import {
  SD_CLOSED_PHASE_CATEGORIES,
  SD_TICKET_INCLUDE,
  SD_USER_SUMMARY_SELECT,
  type SdTicketWithRelations,
} from './sd-ticket.repository'

/**
 * Acesso às duas tabelas da análise preditiva do ServiceDesk
 * (`SdTicketRiskPrediction`, uma linha por chamado aberto, e
 * `SdIncidentCluster`, os grupos de incidentes parecidos), mais as
 * estatísticas que a heurística usa como régua do workspace (filas, carga e
 * histórico de violação). Sem regra de negócio: quem calcula é
 * `src/lib/servicedesk/risk-compute.ts` e quem decide é `SdRiskService`.
 */

export type SdRiskPredictionWithTicket = SdTicketRiskPrediction & {
  ticket: SdTicketWithRelations
}

export const SD_CLUSTER_INCLUDE = {
  dismissedBy: { select: SD_USER_SUMMARY_SELECT },
} as const satisfies Prisma.SdIncidentClusterInclude

export type SdIncidentClusterWithActor = Prisma.SdIncidentClusterGetPayload<{
  include: typeof SD_CLUSTER_INCLUDE
}>

const CLUSTER_TICKET_SELECT = {
  id: true,
  number: true,
  type: true,
  title: true,
  createdAt: true,
  phase: { select: { name: true, color: true, category: true } },
  priority: { select: { id: true, name: true, color: true } },
} as const satisfies Prisma.SdTicketSelect

export type SdClusterTicketRow = Prisma.SdTicketGetPayload<{
  select: typeof CLUSTER_TICKET_SELECT
}>

const OPEN_WHERE = {
  deletedAt: null,
  phase: { category: { notIn: SD_CLOSED_PHASE_CATEGORIES } },
} as const satisfies Prisma.SdTicketWhereInput

export interface SdRiskPredictionData {
  level: SdRiskLevelPrediction
  score: number
  factors: Prisma.InputJsonValue
  breachEtaAt: Date | null
  computedAt: Date
}

export interface SdRiskTicketQuery {
  level: SdRiskLevelPrediction
  minScore?: number
  departmentId?: string
  assigneeId?: string
  limit: number
}

export interface SdClusterData {
  title: string
  ticketIds: string[]
  ticketCount: number
  firstSeenAt: Date
  lastSeenAt: Date
}

export const SdRiskRepository = {
  /* ---------------------------------------------------------------- */
  /* Previsões                                                         */
  /* ---------------------------------------------------------------- */

  /** Uma linha por chamado: recalcular sobrescreve a previsão anterior. */
  async upsertPrediction(
    workspaceId: string,
    ticketId: string,
    data: SdRiskPredictionData,
  ): Promise<Result<SdTicketRiskPrediction>> {
    try {
      const row = await prisma.sdTicketRiskPrediction.upsert({
        where: { ticketId },
        create: { workspaceId, ticketId, ...data },
        update: data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to upsert ServiceDesk risk prediction', error))
    }
  },

  /** Faixa gravada de cada chamado — é o "antes" do aviso de risco alto. */
  async levelsByTicketIds(
    workspaceId: string,
    ticketIds: string[],
  ): Promise<Result<Map<string, SdRiskLevelPrediction>>> {
    if (ticketIds.length === 0) return ok(new Map())
    try {
      const rows = await prisma.sdTicketRiskPrediction.findMany({
        where: { workspaceId, ticketId: { in: ticketIds } },
        select: { ticketId: true, level: true },
      })
      return ok(new Map(rows.map((r) => [r.ticketId, r.level])))
    } catch (error) {
      return err(dbError('Failed to list ServiceDesk risk levels', error))
    }
  },

  async findByTicket(
    workspaceId: string,
    ticketId: string,
  ): Promise<Result<SdTicketRiskPrediction | null>> {
    try {
      const row = await prisma.sdTicketRiskPrediction.findFirst({
        where: { workspaceId, ticketId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load ServiceDesk risk prediction', error))
    }
  },

  /** Fila por risco: nota maior primeiro, com o chamado completo. */
  async listRanked(
    workspaceId: string,
    query: SdRiskTicketQuery,
  ): Promise<Result<SdRiskPredictionWithTicket[]>> {
    try {
      const rows = await prisma.sdTicketRiskPrediction.findMany({
        where: {
          workspaceId,
          level: query.level,
          ...(query.minScore === undefined
            ? {}
            : { score: { gte: query.minScore } }),
          ticket: {
            ...OPEN_WHERE,
            ...(query.departmentId ? { departmentId: query.departmentId } : {}),
            ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
          },
        },
        include: { ticket: { include: SD_TICKET_INCLUDE } },
        orderBy: [{ score: 'desc' }, { computedAt: 'desc' }],
        take: query.limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list ServiceDesk risk queue', error))
    }
  },

  /** Chamado encerrado (ou excluído) não tem previsão: a linha sai. */
  async deleteClosedPredictions(workspaceId: string): Promise<Result<number>> {
    try {
      const { count } = await prisma.sdTicketRiskPrediction.deleteMany({
        where: {
          workspaceId,
          OR: [
            { ticket: { deletedAt: { not: null } } },
            {
              ticket: {
                phase: { category: { in: SD_CLOSED_PHASE_CATEGORIES } },
              },
            },
          ],
        },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to prune ServiceDesk risk predictions', error))
    }
  },

  /* ---------------------------------------------------------------- */
  /* Estatísticas do workspace (régua dos fatores de pressão)          */
  /* ---------------------------------------------------------------- */

  /** Chamados abertos por departamento (só os que têm time definido). */
  async openCountsByDepartment(
    workspaceId: string,
  ): Promise<Result<Record<string, number>>> {
    try {
      const rows = await prisma.sdTicket.groupBy({
        by: ['departmentId'],
        where: { workspaceId, ...OPEN_WHERE, departmentId: { not: null } },
        _count: { _all: true },
      })
      // `departmentId` nunca é nulo aqui (a consulta filtra `not: null`).
      const out: Record<string, number> = {}
      for (const row of rows) out[String(row.departmentId)] = row._count._all
      return ok(out)
    } catch (error) {
      return err(
        dbError('Failed to count ServiceDesk department queues', error),
      )
    }
  },

  /** Chamados abertos por responsável (só os atribuídos). */
  async openCountsByAssignee(
    workspaceId: string,
  ): Promise<Result<Record<string, number>>> {
    try {
      const rows = await prisma.sdTicket.groupBy({
        by: ['assigneeId'],
        where: { workspaceId, ...OPEN_WHERE, assigneeId: { not: null } },
        _count: { _all: true },
      })
      // `assigneeId` nunca é nulo aqui (a consulta filtra `not: null`).
      const out: Record<string, number> = {}
      for (const row of rows) out[String(row.assigneeId)] = row._count._all
      return ok(out)
    } catch (error) {
      return err(dbError('Failed to count ServiceDesk assignee load', error))
    }
  },

  /**
   * Último evento **de agente** de cada chamado — a régua do fator "sem
   * interação da equipe". `lastActivityAt` do chamado não serve: mensagem
   * do cliente (portal, e-mail, WhatsApp) também o atualiza. Chamado sem
   * nenhum evento de agente fica fora do mapa.
   */
  async lastTeamActivityByTicketIds(
    workspaceId: string,
    ticketIds: string[],
  ): Promise<Result<Map<string, Date>>> {
    if (ticketIds.length === 0) return ok(new Map())
    try {
      const rows = await prisma.sdTicketEvent.groupBy({
        by: ['ticketId'],
        where: {
          workspaceId,
          ticketId: { in: ticketIds },
          actorKind: 'AGENT',
        },
        _max: { createdAt: true },
      })
      const out = new Map<string, Date>()
      for (const row of rows) {
        if (row._max.createdAt) out.set(row.ticketId, row._max.createdAt)
      }
      return ok(out)
    } catch (error) {
      return err(
        dbError('Failed to read ServiceDesk team activity for risk', error),
      )
    }
  },

  /**
   * Topo das escalas do workspace — sem isso não há como dizer se
   * "prioridade 3" é alta ou média neste cliente.
   */
  async maxScaleLevels(
    workspaceId: string,
  ): Promise<Result<{ priority: number; severity: number }>> {
    try {
      const [priority, severity] = await Promise.all([
        prisma.sdPriority.aggregate({
          where: { workspaceId },
          _max: { level: true },
        }),
        prisma.sdSeverity.aggregate({
          where: { workspaceId },
          _max: { level: true },
        }),
      ])
      return ok({
        priority: priority._max.level ?? 0,
        severity: severity._max.level ?? 0,
      })
    } catch (error) {
      return err(dbError('Failed to read ServiceDesk scales', error))
    }
  },

  /** Clientes/empresas e serviços que já tiveram prazo violado. */
  async breachHistory(
    workspaceId: string,
    take = 5000,
  ): Promise<Result<{ customerIds: string[]; serviceIds: string[] }>> {
    try {
      const rows = await prisma.sdTicket.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          OR: [{ firstResponseBreached: true }, { resolutionBreached: true }],
        },
        select: { customerId: true, companyId: true, serviceId: true },
        orderBy: { createdAt: 'desc' },
        take,
      })
      const customers = new Set<string>()
      const services = new Set<string>()
      for (const row of rows) {
        if (row.customerId) customers.add(row.customerId)
        if (row.companyId) customers.add(row.companyId)
        if (row.serviceId) services.add(row.serviceId)
      }
      return ok({
        customerIds: [...customers],
        serviceIds: [...services],
      })
    } catch (error) {
      return err(dbError('Failed to read ServiceDesk breach history', error))
    }
  },

  /* ---------------------------------------------------------------- */
  /* Agrupamentos de incidentes                                        */
  /* ---------------------------------------------------------------- */

  /** Incidentes da janela de observação (os mais recentes primeiro). */
  async listRecentIncidents(
    workspaceId: string,
    since: Date,
    take = 1000,
  ): Promise<
    Result<
      {
        id: string
        title: string
        categoryId: string | null
        subcategoryId: string | null
        serviceId: string | null
        createdAt: Date
      }[]
    >
  > {
    try {
      const rows = await prisma.sdTicket.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          type: 'INCIDENT',
          createdAt: { gte: since },
        },
        select: {
          id: true,
          title: true,
          categoryId: true,
          subcategoryId: true,
          serviceId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list ServiceDesk incidents', error))
    }
  },

  async findClusterBySignature(
    workspaceId: string,
    signature: string,
  ): Promise<Result<SdIncidentCluster | null>> {
    try {
      const row = await prisma.sdIncidentCluster.findUnique({
        where: { workspaceId_signature: { workspaceId, signature } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load ServiceDesk incident cluster', error))
    }
  },

  /** Grava o grupo; `clearDismissal` ressuscita uma sugestão descartada. */
  async upsertCluster(
    workspaceId: string,
    signature: string,
    data: SdClusterData,
    clearDismissal = false,
  ): Promise<Result<SdIncidentCluster>> {
    try {
      const row = await prisma.sdIncidentCluster.upsert({
        where: { workspaceId_signature: { workspaceId, signature } },
        create: { workspaceId, signature, ...data },
        update: {
          ...data,
          ...(clearDismissal ? { dismissedAt: null, dismissedById: null } : {}),
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save ServiceDesk incident cluster', error))
    }
  },

  /**
   * Apaga as sugestões que a janela deixou de confirmar — só as vivas (sem
   * problema aberto e sem descarte), para o descarte não ser recriado e
   * reavisado no tick seguinte.
   */
  async deleteStaleClusters(
    workspaceId: string,
    keepSignatures: string[],
  ): Promise<Result<number>> {
    try {
      const { count } = await prisma.sdIncidentCluster.deleteMany({
        where: {
          workspaceId,
          problemTicketId: null,
          dismissedAt: null,
          ...(keepSignatures.length > 0
            ? { signature: { notIn: keepSignatures } }
            : {}),
        },
      })
      return ok(count)
    } catch (error) {
      return err(
        dbError('Failed to prune ServiceDesk incident clusters', error),
      )
    }
  },

  async listClusters(
    workspaceId: string,
    status: 'open' | 'handled' | 'all',
    limit: number,
  ): Promise<Result<SdIncidentClusterWithActor[]>> {
    try {
      const rows = await prisma.sdIncidentCluster.findMany({
        where: {
          workspaceId,
          ...(status === 'open'
            ? { problemTicketId: null, dismissedAt: null }
            : {}),
          ...(status === 'handled'
            ? {
                OR: [
                  { problemTicketId: { not: null } },
                  { dismissedAt: { not: null } },
                ],
              }
            : {}),
        },
        include: SD_CLUSTER_INCLUDE,
        orderBy: [{ lastSeenAt: 'desc' }],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list ServiceDesk incident clusters', error))
    }
  },

  async findCluster(
    workspaceId: string,
    clusterId: string,
  ): Promise<Result<SdIncidentClusterWithActor | null>> {
    try {
      const row = await prisma.sdIncidentCluster.findFirst({
        where: { id: clusterId, workspaceId },
        include: SD_CLUSTER_INCLUDE,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load ServiceDesk incident cluster', error))
    }
  },

  async setClusterProblem(
    clusterId: string,
    problemTicketId: string,
  ): Promise<Result<SdIncidentClusterWithActor>> {
    try {
      const row = await prisma.sdIncidentCluster.update({
        where: { id: clusterId },
        data: { problemTicketId },
        include: SD_CLUSTER_INCLUDE,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to link ServiceDesk problem', error))
    }
  },

  async dismissCluster(
    clusterId: string,
    userId: string,
    at: Date,
  ): Promise<Result<SdIncidentClusterWithActor>> {
    try {
      const row = await prisma.sdIncidentCluster.update({
        where: { id: clusterId },
        data: { dismissedAt: at, dismissedById: userId },
        include: SD_CLUSTER_INCLUDE,
      })
      return ok(row)
    } catch (error) {
      return err(
        dbError('Failed to dismiss ServiceDesk incident cluster', error),
      )
    }
  },

  /** Recorte dos chamados de um grupo (incidentes e o problema aberto). */
  async listTicketRefs(
    workspaceId: string,
    ticketIds: string[],
  ): Promise<Result<SdClusterTicketRow[]>> {
    if (ticketIds.length === 0) return ok([])
    try {
      const rows = await prisma.sdTicket.findMany({
        where: { workspaceId, id: { in: ticketIds }, deletedAt: null },
        select: CLUSTER_TICKET_SELECT,
        orderBy: { createdAt: 'desc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list ServiceDesk cluster tickets', error))
    }
  },
}
