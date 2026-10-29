import type { Prisma, SdTicketType } from '@prisma/client'
import { sdMonitorAlertNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { ok, type Result } from '@/src/lib/result'
import { sdMonitorHostCandidates } from '@/src/lib/servicedesk/monitoring'
import { sdDb, sdDbFind } from './sd-config-db'

const ALERT_INCLUDE = {
  source: { select: { id: true, name: true, kind: true } },
  configItem: { select: { id: true, name: true } },
  ticket: {
    select: {
      id: true,
      number: true,
      type: true,
      title: true,
      phase: { select: { name: true } },
    },
  },
} satisfies Prisma.SdMonitorAlertInclude

export type SdMonitorAlertWithRelations = Prisma.SdMonitorAlertGetPayload<{
  include: typeof ALERT_INCLUDE
}>

export interface SdMonitorAlertCreateData {
  workspaceId: string
  sourceId: string
  externalId: string
  subject: string
  body?: string | null
  severity?: string | null
  host?: string | null
  configItemId?: string | null
  ticketId?: string | null
  payload?: Prisma.InputJsonValue
  startedAt?: Date
  correlationKey?: string | null
  correlated?: boolean
}

export interface SdMonitorAlertUpdateData {
  status?: 'OPEN' | 'RESOLVED' | 'IGNORED'
  subject?: string
  body?: string | null
  severity?: string | null
  host?: string | null
  configItemId?: string | null
  ticketId?: string | null
  payload?: Prisma.InputJsonValue
  startedAt?: Date
  resolvedAt?: Date | null
  correlationKey?: string | null
  correlated?: boolean
  /** Número absoluto ou `{ increment }` (reenvio do mesmo alerta). */
  occurrences?: number | { increment: number }
  lastSeenAt?: Date
}

export interface ListSdMonitorAlertsOptions {
  sourceId?: string
  ticketId?: string
  configItemId?: string
  /** Só alertas sem item da CMDB. */
  unmatched?: boolean
  status?: 'OPEN' | 'RESOLVED' | 'IGNORED'
  limit?: number
}

/**
 * Alertas recebidos. `(sourceId, externalId)` é único: o mesmo problema
 * reenviado cai sempre na mesma linha — é isso que impede um segundo
 * chamado e liga a normalização ao chamado certo.
 */
export const SdMonitorAlertRepository = {
  async list(
    workspaceId: string,
    options: ListSdMonitorAlertsOptions = {},
  ): Promise<Result<SdMonitorAlertWithRelations[]>> {
    return sdDb('Failed to list ServiceDesk monitor alerts', () =>
      prisma.sdMonitorAlert.findMany({
        where: {
          workspaceId,
          ...(options.sourceId ? { sourceId: options.sourceId } : {}),
          ...(options.ticketId ? { ticketId: options.ticketId } : {}),
          ...(options.configItemId
            ? { configItemId: options.configItemId }
            : {}),
          ...(options.unmatched ? { configItemId: null } : {}),
          ...(options.status ? { status: options.status } : {}),
        },
        include: ALERT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: options.limit ?? 20,
      }),
    )
  },

  /** Alerta já conhecido desta origem (chave de deduplicação). */
  async findByExternalId(
    sourceId: string,
    externalId: string,
  ): Promise<Result<SdMonitorAlertWithRelations | null>> {
    return sdDb('Failed to find ServiceDesk monitor alert', () =>
      prisma.sdMonitorAlert.findUnique({
        where: { sourceId_externalId: { sourceId, externalId } },
        include: ALERT_INCLUDE,
      }),
    )
  },

  async create(
    data: SdMonitorAlertCreateData,
  ): Promise<Result<SdMonitorAlertWithRelations>> {
    return sdDb('Failed to create ServiceDesk monitor alert', () =>
      prisma.sdMonitorAlert.create({ data, include: ALERT_INCLUDE }),
    )
  },

  async update(
    id: string,
    data: SdMonitorAlertUpdateData,
  ): Promise<Result<SdMonitorAlertWithRelations>> {
    return sdDb('Failed to update ServiceDesk monitor alert', () =>
      prisma.sdMonitorAlert.update({
        where: { id },
        data,
        include: ALERT_INCLUDE,
      }),
    )
  },

  /**
   * Primeira fase ativa do tipo nesta categoria (a `RESOLVED` do
   * encerramento automático, a inicial de uma reabertura por flapping).
   */
  async findPhaseIdByCategory(
    workspaceId: string,
    ticketType: SdTicketType,
    category: 'NEW' | 'IN_PROGRESS' | 'RESOLVED',
  ): Promise<Result<string | null>> {
    return sdDb('Failed to find ServiceDesk phase for monitoring', async () => {
      const row = await prisma.sdPhase.findFirst({
        where: { workspaceId, ticketType, category, active: true },
        select: { id: true },
        orderBy: [{ isInitial: 'desc' }, { position: 'asc' }],
      })
      return row?.id ?? null
    })
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdMonitorAlertWithRelations>> {
    return sdDbFind(
      'Failed to find ServiceDesk monitor alert',
      () =>
        prisma.sdMonitorAlert.findFirst({
          where: { id, workspaceId },
          include: ALERT_INCLUDE,
        }),
      sdMonitorAlertNotFound(),
    )
  },

  /**
   * Item de configuração que corresponde ao host do alerta. Ordem: apelido
   * guardado pelo agente (`SdMonitorHostAlias`) → nome, código ou IP
   * (sem diferenciar maiúsculas, ignorando excluídos) na ordem dos
   * candidatos → o primeiro rótulo de um FQDN (`srv-02.lan` → `srv-02`).
   */
  async findConfigItemByHosts(
    workspaceId: string,
    hosts: string[],
  ): Promise<Result<{ id: string; name: string } | null>> {
    const candidates = sdMonitorHostCandidates(hosts)
    if (candidates.length === 0) return ok(null)
    return sdDb('Failed to match ServiceDesk config item', async () => {
      const alias = await prisma.sdMonitorHostAlias.findFirst({
        where: {
          workspaceId,
          host: { in: candidates },
          configItem: { deletedAt: null },
        },
        select: { configItem: { select: { id: true, name: true } } },
      })
      if (alias) return alias.configItem

      const rows = await prisma.sdConfigItem.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          OR: candidates.flatMap((host) => {
            const match = { equals: host, mode: 'insensitive' as const }
            return [{ name: match }, { code: match }, { ipAddress: match }]
          }),
        },
        select: { id: true, name: true, code: true, ipAddress: true },
        orderBy: { createdAt: 'asc' },
      })
      for (const host of candidates) {
        const row = rows.find((r) =>
          [r.name, r.code, r.ipAddress].some((v) => v?.toLowerCase() === host),
        )
        if (row) return { id: row.id, name: row.name }
      }
      return null
    })
  },

  async configItemExists(
    workspaceId: string,
    configItemId: string,
  ): Promise<Result<boolean>> {
    return sdDb('Failed to check ServiceDesk config item', async () => {
      const row = await prisma.sdConfigItem.findFirst({
        where: { id: configItemId, workspaceId, deletedAt: null },
        select: { id: true },
      })
      return row !== null
    })
  },

  /**
   * Alerta aberto da mesma máquina (mesma chave) cujo chamado ainda não foi
   * encerrado e que recebeu atividade dentro da janela. O mais antigo vence:
   * é a raiz do grupo.
   */
  async findCorrelationTarget(
    workspaceId: string,
    correlationKey: string,
    since: Date,
  ): Promise<Result<SdMonitorAlertWithRelations | null>> {
    return sdDb('Failed to find ServiceDesk correlation target', () =>
      prisma.sdMonitorAlert.findFirst({
        where: {
          workspaceId,
          correlationKey,
          status: 'OPEN',
          ticketId: { not: null },
          lastSeenAt: { gte: since },
          ticket: {
            deletedAt: null,
            phase: { category: { notIn: ['RESOLVED', 'CLOSED', 'CANCELED'] } },
          },
        },
        include: ALERT_INCLUDE,
        orderBy: { startedAt: 'asc' },
      }),
    )
  },

  /** Alertas ainda abertos do chamado, fora o que está sendo normalizado. */
  async countOpenByTicket(
    ticketId: string,
    exceptAlertId: string,
  ): Promise<Result<number>> {
    return sdDb('Failed to count open ServiceDesk monitor alerts', () =>
      prisma.sdMonitorAlert.count({
        where: { ticketId, status: 'OPEN', id: { not: exceptAlertId } },
      }),
    )
  },

  /** Guarda host → item para os próximos alertas (idempotente por host). */
  async upsertHostAlias(
    workspaceId: string,
    host: string,
    configItemId: string,
    createdById: string,
  ): Promise<Result<void>> {
    const key = host.trim().toLowerCase()
    return sdDb('Failed to save ServiceDesk monitor host alias', async () => {
      await prisma.sdMonitorHostAlias.upsert({
        where: { workspaceId_host: { workspaceId, host: key } },
        create: { workspaceId, host: key, configItemId, createdById },
        update: { configItemId },
      })
    })
  },

  /** Liga os alertas ainda sem item que têm este host. Devolve quantos. */
  async linkUnmatchedByHost(
    workspaceId: string,
    host: string,
    configItemId: string,
  ): Promise<Result<number>> {
    return sdDb('Failed to link ServiceDesk monitor alerts', async () => {
      const result = await prisma.sdMonitorAlert.updateMany({
        where: {
          workspaceId,
          configItemId: null,
          host: { equals: host, mode: 'insensitive' },
        },
        data: { configItemId },
      })
      return result.count
    })
  },
}
