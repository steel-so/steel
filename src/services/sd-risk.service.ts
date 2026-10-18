import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  sdIncidentClusterClosed,
  sdIncidentClusterNotFound,
  sdRiskPredictionNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  SD_CLUSTER_MIN_TICKETS,
  SD_CLUSTER_WINDOW_DAYS,
  type SdIncidentGroup,
  sdClusterProblemDescription,
  sdGroupIncidents,
  sdIncidentsSince,
} from '@/src/lib/servicedesk/incident-cluster'
import { sdNotifyTicketOf } from '@/src/lib/servicedesk/notify'
import {
  computeSdRiskPrediction,
  type SdRiskPredictionResult,
  type SdRiskTicketInput,
  type SdRiskWorkspaceStats,
  sdRiskEmptyStats,
} from '@/src/lib/servicedesk/risk-compute'
import { parseSdCalendar } from '@/src/lib/servicedesk/sla'
import { formatSdTicketCode } from '@/src/lib/servicedesk/ticket-code'
import {
  toSdIncidentClusterDTO,
  toSdTicketRiskDTO,
} from '@/src/mappers/sd-risk.mapper'
import { toSdTicketDTO } from '@/src/mappers/sd-ticket.mapper'
import {
  type SdClusterTicketRow,
  type SdIncidentClusterWithActor,
  SdRiskRepository,
} from '@/src/repositories/sd-risk.repository'
import {
  SdTicketRepository,
  type SdTicketWithRelations,
} from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import type {
  ListSdIncidentClustersDTO,
  ListSdRiskTicketsDTO,
  OpenSdClusterProblemDTO,
} from '@/src/schemas/sd-risk.schema'
import type { SdIncidentClusterDTO, SdTicketRiskDTO } from '@/types/sd-risk'
import type { SdTicketDTO } from '@/types/sd-ticket'
import { SdAccess, type SdAccessContext } from './sd-access'
import { runSdAutomations } from './sd-automation-engine'
import { notifySdEvent } from './sd-notification.service'
import {
  type SdEngineConfig,
  SdTicketEngine,
  sdTicketCode,
  sdUserActor,
} from './sd-ticket-engine'

/**
 * Risco preditivo e incidentes repetidos (ADR 0016).
 *
 * O cálculo é **heurística explicável** em código versionado
 * (`src/lib/servicedesk/risk-compute.ts`): nada passa por LLM. Este service
 * só carrega as linhas, chama a lib pura, grava uma previsão por chamado
 * aberto e avisa quando um chamado **entra** na faixa de risco alto — nunca
 * a cada tick, para não virar tempestade de notificação.
 *
 * O agrupamento de incidentes (`scanClusters`) grava **sugestões**: abrir o
 * problema é sempre ação de um agente (`openProblem`), e descartar também.
 */

const BATCH = 200
const DAY_MS = 24 * 60 * 60 * 1000
const INCIDENT_LIMIT = 1000

export interface SdRiskTickResult {
  workspaces: number
  tickets: number
  high: number
  medium: number
  low: number
  /** Chamados que entraram na faixa de risco alto neste tick. */
  notified: number
  /** Previsões apagadas (chamado encerrado ou excluído). */
  removed: number
  errors: number
}

export interface SdClusterScanResult {
  workspaces: number
  incidents: number
  /** Grupos que passaram do corte. */
  clusters: number
  created: number
  reopened: number
  removed: number
  errors: number
}

/* ------------------------------------------------------------------ */
/* Recorte do chamado para a heurística                                 */
/* ------------------------------------------------------------------ */

/**
 * `lastTeamActivityAt` vem dos eventos de agente
 * (`SdRiskRepository.lastTeamActivityByTicketIds`), não de
 * `t.lastActivityAt`: este também anda com mensagem do cliente, e o fator
 * "sem interação da equipe" zeraria justo quando o cliente cobra.
 */
export function sdRiskTicketInput(
  t: SdTicketWithRelations,
  lastTeamActivityAt: Date | null,
): SdRiskTicketInput {
  return {
    createdAt: t.createdAt,
    firstResponseDueAt: t.firstResponseDueAt,
    resolutionDueAt: t.resolutionDueAt,
    firstRespondedAt: t.firstRespondedAt,
    resolvedAt: t.resolvedAt,
    slaPausedAt: t.slaPausedAt,
    slaPausedMinutes: t.slaPausedMinutes,
    firstResponseBreached: t.firstResponseBreached,
    resolutionBreached: t.resolutionBreached,
    assigneeId: t.assigneeId,
    departmentId: t.departmentId,
    customerId: t.customerId,
    companyId: t.companyId,
    serviceId: t.serviceId,
    reopenCount: t.reopenCount,
    lastTeamActivityAt,
    priority: t.priority
      ? { name: t.priority.name, level: t.priority.level }
      : null,
    severity: t.severity
      ? { name: t.severity.name, level: t.severity.level }
      : null,
    phase: {
      name: t.phase.name,
      category: t.phase.category,
      pausesSla: t.phase.pausesSla,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Autorização                                                          */
/* ------------------------------------------------------------------ */

interface Loaded {
  ctx: SdAccessContext
  config: SdEngineConfig
}

/**
 * O risco é informação de quem atende: mesma permissão do chamado
 * (`sd-tickets`) e só agentes (o evento é `agentOnly` no catálogo).
 */
async function access(
  actorId: string,
  workspaceId: string,
  action: 'VIEW' | 'EDIT' | 'CREATE',
): Promise<Result<Loaded>> {
  const ctx = await SdAccess.requireAgent(actorId, workspaceId, {
    resource: 'sd-tickets',
    action,
  })
  if (!ctx.ok) return ctx
  const config = await SdTicketEngine.loadConfig(workspaceId)
  if (!config.ok) return config
  return ok({ ctx: ctx.value, config: config.value })
}

/* ------------------------------------------------------------------ */
/* Notificações                                                         */
/* ------------------------------------------------------------------ */

/** Frase curta do porquê — a notificação leva o motivo, não só a nota. */
function reasonOf(prediction: SdRiskPredictionResult): string {
  return prediction.factors
    .slice(0, 3)
    .map((f) => f.detail)
    .join(' · ')
}

async function notifyBreachPredicted(
  ticket: SdTicketWithRelations,
  prediction: SdRiskPredictionResult,
  config: SdEngineConfig,
): Promise<void> {
  const code = sdTicketCode(ticket, config.prefixes)
  const sent = await notifySdEvent({
    workspaceId: ticket.workspaceId,
    event: 'sla.breach_predicted',
    ticket: sdNotifyTicketOf(ticket, code),
    payload: {
      title: `Risco alto de violar o SLA: ${code} (${prediction.score}/100)`,
      body: reasonOf(prediction) || ticket.title,
      meta: {
        score: prediction.score,
        factors: prediction.factors.map((f) => f.key),
      },
    },
  })
  if (!sent.ok) {
    logger.warn('servicedesk.risk.notify_failed', {
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      reason: sent.error.code,
    })
  }
}

async function notifyClusterDetected(
  workspaceId: string,
  cluster: { id: string; signature: string; title: string },
  group: SdIncidentGroup,
  config: SdEngineConfig,
): Promise<void> {
  const newest = group.ticketIds[group.ticketIds.length - 1]
  const ticket = await SdTicketRepository.findById(newest, workspaceId)
  if (!ticket.ok) return
  const code = sdTicketCode(ticket.value, config.prefixes)
  const sent = await notifySdEvent({
    workspaceId,
    event: 'problem.cluster_detected',
    ticket: sdNotifyTicketOf(ticket.value, code),
    payload: {
      title: `Incidentes repetidos: ${group.ticketIds.length} chamados parecidos`,
      body: `${cluster.title} — avalie abrir um problema.`,
      meta: { clusterId: cluster.id, signature: cluster.signature },
    },
  })
  if (!sent.ok) {
    logger.warn('servicedesk.risk.cluster_notify_failed', {
      workspaceId,
      clusterId: cluster.id,
      reason: sent.error.code,
    })
  }
}

/* ------------------------------------------------------------------ */
/* Tick: recálculo do risco                                             */
/* ------------------------------------------------------------------ */

async function loadStats(
  workspaceId: string,
  result: { errors: number },
): Promise<SdRiskWorkspaceStats> {
  const stats = sdRiskEmptyStats()
  const [departments, assignees, scales, history] = await Promise.all([
    SdRiskRepository.openCountsByDepartment(workspaceId),
    SdRiskRepository.openCountsByAssignee(workspaceId),
    SdRiskRepository.maxScaleLevels(workspaceId),
    SdRiskRepository.breachHistory(workspaceId),
  ])
  if (departments.ok) stats.openByDepartment = departments.value
  else result.errors++
  if (assignees.ok) stats.openByAssignee = assignees.value
  else result.errors++
  if (scales.ok) {
    stats.maxPriorityLevel = scales.value.priority
    stats.maxSeverityLevel = scales.value.severity
  } else result.errors++
  if (history.ok) {
    stats.breachedCustomerIds = new Set(history.value.customerIds)
    stats.breachedServiceIds = new Set(history.value.serviceIds)
  } else result.errors++
  return stats
}

async function recomputeWorkspace(
  workspaceId: string,
  now: Date,
  result: SdRiskTickResult,
): Promise<void> {
  const config = await SdTicketEngine.loadConfig(workspaceId)
  if (!config.ok) {
    result.errors++
    return
  }
  const stats = await loadStats(workspaceId, result)
  const atRiskPercent = config.value.settings.slaAtRiskPercent

  let afterId: string | null = null
  for (;;) {
    const batch = await SdTicketRepository.listOpenForSla(
      workspaceId,
      afterId,
      BATCH,
    )
    if (!batch.ok) {
      result.errors++
      break
    }
    const ids = batch.value.map((t) => t.id)
    const [previous, activity] = await Promise.all([
      SdRiskRepository.levelsByTicketIds(workspaceId, ids),
      SdRiskRepository.lastTeamActivityByTicketIds(workspaceId, ids),
    ])
    if (!previous.ok) result.errors++
    if (!activity.ok) result.errors++
    const before = previous.ok ? previous.value : new Map()
    // Sem os eventos, a melhor aproximação é a última atividade do chamado
    // (o comportamento antigo) — melhor que tratar todos como silenciosos.
    const teamActivityOf = (t: SdTicketWithRelations): Date | null =>
      activity.ok ? (activity.value.get(t.id) ?? null) : t.lastActivityAt

    for (const ticket of batch.value) {
      result.tickets++
      const prediction = computeSdRiskPrediction(
        sdRiskTicketInput(ticket, teamActivityOf(ticket)),
        stats,
        now,
        {
          atRiskPercent,
          calendar: parseSdCalendar(ticket.slaPolicy?.calendar ?? null),
        },
      )
      const saved = await SdRiskRepository.upsertPrediction(
        workspaceId,
        ticket.id,
        {
          level: prediction.level,
          score: prediction.score,
          factors: prediction.factors as unknown as Prisma.InputJsonValue,
          breachEtaAt: prediction.breachEtaAt,
          computedAt: now,
        },
      )
      if (!saved.ok) {
        result.errors++
        continue
      }
      if (prediction.level === 'HIGH') result.high++
      else if (prediction.level === 'MEDIUM') result.medium++
      else result.low++

      // Avisa só na **entrada** na faixa alta (antes era outra faixa, ou
      // não havia previsão) — repetir a cada 10 min seria spam.
      if (prediction.level === 'HIGH' && before.get(ticket.id) !== 'HIGH') {
        result.notified++
        await notifyBreachPredicted(ticket, prediction, config.value)
      }
    }
    if (batch.value.length < BATCH) break
    afterId = batch.value[batch.value.length - 1].id
  }

  const pruned = await SdRiskRepository.deleteClosedPredictions(workspaceId)
  if (pruned.ok) result.removed += pruned.value
  else result.errors++
}

/* ------------------------------------------------------------------ */
/* Tick: agrupamento de incidentes                                      */
/* ------------------------------------------------------------------ */

async function scanWorkspaceClusters(
  workspaceId: string,
  now: Date,
  result: SdClusterScanResult,
): Promise<void> {
  const config = await SdTicketEngine.loadConfig(workspaceId)
  if (!config.ok) {
    result.errors++
    return
  }
  const since = new Date(now.getTime() - SD_CLUSTER_WINDOW_DAYS * DAY_MS)
  const incidents = await SdRiskRepository.listRecentIncidents(
    workspaceId,
    since,
    INCIDENT_LIMIT,
  )
  if (!incidents.ok) {
    result.errors++
    return
  }
  result.incidents += incidents.value.length

  const groups = sdGroupIncidents(incidents.value)
  const keep: string[] = []
  for (const group of groups) {
    result.clusters++
    const existing = await SdRiskRepository.findClusterBySignature(
      workspaceId,
      group.signature,
    )
    if (!existing.ok) {
      result.errors++
      continue
    }
    const current = existing.value
    keep.push(group.signature)

    // Descartado volta a sugerir só quando repetiu de novo o bastante
    // depois do descarte — senão o agente que disse "não" é ignorado.
    const reopened =
      current?.dismissedAt != null &&
      sdIncidentsSince(group, current.dismissedAt) >= SD_CLUSTER_MIN_TICKETS
    if (current?.dismissedAt && !reopened) continue

    const saved = await SdRiskRepository.upsertCluster(
      workspaceId,
      group.signature,
      {
        title: group.title,
        ticketIds: group.ticketIds,
        ticketCount: group.ticketIds.length,
        firstSeenAt: group.firstSeenAt,
        lastSeenAt: group.lastSeenAt,
      },
      reopened,
    )
    if (!saved.ok) {
      result.errors++
      continue
    }
    if (!current) result.created++
    if (reopened) result.reopened++
    if (!current || reopened) {
      await notifyClusterDetected(workspaceId, saved.value, group, config.value)
    }
  }

  const pruned = await SdRiskRepository.deleteStaleClusters(workspaceId, keep)
  if (pruned.ok) result.removed += pruned.value
  else result.errors++
}

/* ------------------------------------------------------------------ */
/* Leitura e composição dos DTOs                                        */
/* ------------------------------------------------------------------ */

async function clusterDtos(
  workspaceId: string,
  clusters: SdIncidentClusterWithActor[],
  config: SdEngineConfig,
): Promise<Result<SdIncidentClusterDTO[]>> {
  const ids = new Set<string>()
  for (const cluster of clusters) {
    for (const id of cluster.ticketIds) ids.add(id)
    if (cluster.problemTicketId) ids.add(cluster.problemTicketId)
  }
  const refs = await SdRiskRepository.listTicketRefs(workspaceId, [...ids])
  if (!refs.ok) return refs
  return ok(
    clusters.map((cluster) =>
      toSdIncidentClusterDTO(cluster, {
        prefixes: config.prefixes,
        tickets: refs.value,
      }),
    ),
  )
}

/** Um agrupamento só (as mutações devolvem o grupo atualizado). */
async function single(
  workspaceId: string,
  cluster: SdIncidentClusterWithActor,
  config: SdEngineConfig,
): Promise<Result<SdIncidentClusterDTO>> {
  const list = await clusterDtos(workspaceId, [cluster], config)
  if (!list.ok) return list
  return ok(list.value[0])
}

async function loadCluster(
  workspaceId: string,
  clusterId: string,
): Promise<Result<SdIncidentClusterWithActor>> {
  const cluster = await SdRiskRepository.findCluster(workspaceId, clusterId)
  if (!cluster.ok) return cluster
  if (!cluster.value) return err(sdIncidentClusterNotFound())
  return ok(cluster.value)
}

function codesOf(
  refs: SdClusterTicketRow[],
  ticketIds: string[],
  config: SdEngineConfig,
): string[] {
  const byId = new Map(refs.map((r) => [r.id, r]))
  return ticketIds
    .map((id) => byId.get(id))
    .filter((r): r is SdClusterTicketRow => r !== undefined)
    .map((r) => formatSdTicketCode(r.type, r.number, config.prefixes))
}

/* ------------------------------------------------------------------ */
/* Service                                                              */
/* ------------------------------------------------------------------ */

export const SdRiskService = {
  /**
   * Recalcula o risco dos chamados abertos. Sem `workspaceId`, varre todo
   * workspace com o módulo habilitado; com ele, só aquele.
   */
  async recomputeTick(
    input: { workspaceId?: string } = {},
    now: Date = new Date(),
  ): Promise<Result<SdRiskTickResult>> {
    const result: SdRiskTickResult = {
      workspaces: 0,
      tickets: 0,
      high: 0,
      medium: 0,
      low: 0,
      notified: 0,
      removed: 0,
      errors: 0,
    }
    const workspaces = input.workspaceId
      ? ok([input.workspaceId])
      : await SdTicketContextRepository.listEnabledWorkspaceIds()
    if (!workspaces.ok) return workspaces

    for (const workspaceId of workspaces.value) {
      result.workspaces++
      try {
        await recomputeWorkspace(workspaceId, now, result)
      } catch (error) {
        result.errors++
        logger.error('servicedesk.risk.workspace_failed', {
          workspaceId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return ok(result)
  },

  /** Agrupa os incidentes recentes e grava as sugestões de problema. */
  async scanClusters(
    input: { workspaceId?: string } = {},
    now: Date = new Date(),
  ): Promise<Result<SdClusterScanResult>> {
    const result: SdClusterScanResult = {
      workspaces: 0,
      incidents: 0,
      clusters: 0,
      created: 0,
      reopened: 0,
      removed: 0,
      errors: 0,
    }
    const workspaces = input.workspaceId
      ? ok([input.workspaceId])
      : await SdTicketContextRepository.listEnabledWorkspaceIds()
    if (!workspaces.ok) return workspaces

    for (const workspaceId of workspaces.value) {
      result.workspaces++
      try {
        await scanWorkspaceClusters(workspaceId, now, result)
      } catch (error) {
        result.errors++
        logger.error('servicedesk.risk.cluster_scan_failed', {
          workspaceId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return ok(result)
  },

  /** Fila por risco: os chamados da faixa, nota maior primeiro. */
  async listTickets(
    actorId: string,
    workspaceId: string,
    query: ListSdRiskTicketsDTO,
  ): Promise<Result<SdTicketDTO[]>> {
    const loaded = await access(actorId, workspaceId, 'VIEW')
    if (!loaded.ok) return loaded
    const rows = await SdRiskRepository.listRanked(workspaceId, {
      level: query.level,
      minScore: query.minScore,
      departmentId: query.departmentId,
      assigneeId: query.assigneeId,
      limit: query.limit,
    })
    if (!rows.ok) return rows
    return ok(
      rows.value.map((row) =>
        toSdTicketDTO(row.ticket, {
          prefixes: loaded.value.config.prefixes,
          atRiskPercent: loaded.value.config.settings.slaAtRiskPercent,
          audience: 'agent',
        }),
      ),
    )
  },

  /** Previsão de um chamado (id, número ou código), com os fatores. */
  async getTicketRisk(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdTicketRiskDTO>> {
    const loaded = await access(actorId, workspaceId, 'VIEW')
    if (!loaded.ok) return loaded
    const ticket = await SdTicketEngine.resolveRef(
      workspaceId,
      ticketRef,
      loaded.value.config.prefixes,
    )
    if (!ticket.ok) return ticket
    // Agente vê todos os chamados do workspace (README, "Papéis"), e
    // `access` já recusou solicitante — não há recorte extra aqui.
    const row = await SdRiskRepository.findByTicket(
      workspaceId,
      ticket.value.id,
    )
    if (!row.ok) return row
    const dto = toSdTicketRiskDTO(row.value)
    if (!dto) return err(sdRiskPredictionNotFound())
    return ok(dto)
  },

  /** Sugestões de problema (grupos de incidentes parecidos). */
  async listClusters(
    actorId: string,
    workspaceId: string,
    query: ListSdIncidentClustersDTO,
  ): Promise<Result<SdIncidentClusterDTO[]>> {
    const loaded = await access(actorId, workspaceId, 'VIEW')
    if (!loaded.ok) return loaded
    const clusters = await SdRiskRepository.listClusters(
      workspaceId,
      query.status,
      query.limit,
    )
    if (!clusters.ok) return clusters
    return clusterDtos(workspaceId, clusters.value, loaded.value.config)
  },

  /**
   * Abre o problema a partir do grupo e vincula os incidentes como filhos.
   * Ação humana: o worker nunca faz isso sozinho (ADR 0016).
   */
  async openProblem(
    actorId: string,
    workspaceId: string,
    clusterId: string,
    input: OpenSdClusterProblemDTO,
  ): Promise<Result<SdIncidentClusterDTO>> {
    const loaded = await access(actorId, workspaceId, 'CREATE')
    if (!loaded.ok) return loaded
    const { ctx, config } = loaded.value

    const cluster = await loadCluster(workspaceId, clusterId)
    if (!cluster.ok) return cluster
    if (cluster.value.problemTicketId) {
      return err(
        sdIncidentClusterClosed('Este agrupamento já virou um problema'),
      )
    }
    if (cluster.value.dismissedAt) {
      return err(sdIncidentClusterClosed('Este agrupamento foi descartado'))
    }

    const refs = await SdRiskRepository.listTicketRefs(
      workspaceId,
      cluster.value.ticketIds,
    )
    if (!refs.ok) return refs

    const created = await SdTicketEngine.create(
      workspaceId,
      {
        type: 'PROBLEM',
        title: input.title ?? cluster.value.title,
        description: sdClusterProblemDescription(
          cluster.value,
          codesOf(refs.value, cluster.value.ticketIds, config),
        ),
        channel: 'AGENT',
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        ...(input.priorityId ? { priorityId: input.priorityId } : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      },
      sdUserActor(ctx),
      config,
    )
    if (!created.ok) {
      auditMutation({
        entity: 'sd_ticket',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
        meta: { workspaceId, clusterId, from: 'incident_cluster' },
      })
      return created
    }

    let linked = 0
    if (input.linkIncidents) {
      for (const incidentId of cluster.value.ticketIds) {
        const incident = await SdTicketRepository.findById(
          incidentId,
          workspaceId,
        )
        if (!incident.ok) continue
        if (incident.value.parentId) continue
        const moved = await SdTicketEngine.update(
          incident.value,
          { parentId: created.value.id },
          sdUserActor(ctx),
          config,
          { allowClosed: true, touchActivity: false },
        )
        if (moved.ok) linked++
      }
    }

    const saved = await SdRiskRepository.setClusterProblem(
      cluster.value.id,
      created.value.id,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'sd_ticket',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        clusterId,
        signature: cluster.value.signature,
        incidents: cluster.value.ticketIds.length,
        linked,
        from: 'incident_cluster',
      },
    })
    await runSdAutomations('TICKET_CREATED', created.value.id, { actorId })
    logger.info('servicedesk.risk.problem_opened', {
      workspaceId,
      clusterId,
      ticketId: created.value.id,
      linked,
    })

    return single(workspaceId, saved.value, config)
  },

  /** Descarta a sugestão (não é problema, ou já foi tratada). */
  async dismissCluster(
    actorId: string,
    workspaceId: string,
    clusterId: string,
    now: Date = new Date(),
  ): Promise<Result<SdIncidentClusterDTO>> {
    const loaded = await access(actorId, workspaceId, 'EDIT')
    if (!loaded.ok) return loaded

    const cluster = await loadCluster(workspaceId, clusterId)
    if (!cluster.ok) return cluster
    if (cluster.value.problemTicketId) {
      return err(
        sdIncidentClusterClosed('Este agrupamento já virou um problema'),
      )
    }
    if (cluster.value.dismissedAt) {
      return err(sdIncidentClusterClosed('Este agrupamento já foi descartado'))
    }

    const saved = await SdRiskRepository.dismissCluster(
      cluster.value.id,
      actorId,
      now,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'sd_incident_cluster',
      action: 'update',
      actorId,
      targetId: clusterId,
      meta: {
        workspaceId,
        signature: cluster.value.signature,
        action: 'dismiss',
      },
    })
    return single(workspaceId, saved.value, loaded.value.config)
  },
}
