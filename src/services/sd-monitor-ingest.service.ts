import type { Prisma, SdMonitorSource } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sdMonitorPayloadInvalid, sdMonitorTokenInvalid } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  parseSdMonitorEvents,
  type SdMonitorEvent,
  sdMonitorCorrelationKey,
  sdMonitorPriorityId,
  sdMonitorSeverityMap,
  sdMonitorTicketBody,
} from '@/src/lib/servicedesk/monitoring'
import { sdNotifyTicketOf } from '@/src/lib/servicedesk/notify'
import { publishSdTicketEvent } from '@/src/lib/servicedesk/realtime'
import { toSdMonitorAlertDTO } from '@/src/mappers/sd-monitor.mapper'
import { SdAutomationRepository } from '@/src/repositories/sd-automation.repository'
import {
  SdMonitorAlertRepository,
  type SdMonitorAlertWithRelations,
} from '@/src/repositories/sd-monitor-alert.repository'
import { SdMonitorSourceRepository } from '@/src/repositories/sd-monitor-source.repository'
import {
  SdTicketRepository,
  type SdTicketWithRelations,
} from '@/src/repositories/sd-ticket.repository'
import type { SdMonitorAlertDTO, SdMonitorIngestDTO } from '@/types/sd-monitor'
import { assertModuleEnabled } from './authz'
import { fireSdAutomations } from './sd-automation-engine'
import { hashSdMonitorToken } from './sd-monitor-source.service'
import { notifySdEvent } from './sd-notification.service'
import { sdOnCallEscalationTarget } from './sd-oncall-resolver'
import {
  type SdEngineConfig,
  SdTicketEngine,
  sdSystemActor,
  sdTicketCode,
} from './sd-ticket-engine'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'

/**
 * Entrada pública do monitoramento (`POST /api/servicedesk/monitoring/
 * <token>`): sem sessão — o token da origem é o acesso.
 *
 * Regras:
 * - **Deduplicação** por `(origem, externalId)`: o mesmo alerta reenviado
 *   atualiza a linha que já existe, nunca abre um segundo chamado.
 * - **PROBLEM** sem alerta aberto abre o chamado com os padrões da origem
 *   (tipo, departamento, categoria, cliente), prioridade pelo mapa de
 *   severidade, canal `API` e ator de sistema; o host é casado com o item
 *   de configuração (nome, código ou IP).
 * - **OK/RESOLVED** fecha o alerta e, com `autoResolve`, leva o chamado à
 *   fase `RESOLVED` do tipo com a solução automática. Se o motor recusar
 *   (fase exige campos/aprovação/classificação da solução), publica uma
 *   mensagem pública no chamado dizendo que o alerta normalizou e deixa o
 *   chamado onde está.
 * - **Flapping**: o mesmo alerta voltando dentro de `flappingWindowMinutes`
 *   reabre o chamado anterior em vez de abrir outro.
 * - **Correlação** (`correlationMode = HOST`): um alerta novo da mesma máquina
 *   (item da CMDB ou, sem item, o mesmo host) que chega enquanto outro alerta
 *   dela está aberto, dentro de `correlationWindowMinutes`, entra no chamado
 *   desse alerta em vez de abrir outro. O chamado só encerra sozinho quando o
 *   último alerta ligado a ele normaliza.
 * - **Lotes**: o Grafana/Alertmanager manda vários alertas num envio; cada um
 *   passa pelas regras acima, em ordem.
 *
 * Nada aqui lança: toda falha vira `Result` e é logada/auditada.
 */

const SOURCE = 'monitor'
const CATALOG_ERRORS = new Set([
  'SD_CATEGORY_NOT_FOUND',
  'SD_CATEGORY_LEVEL_INVALID',
  'SD_CONFIG_NOT_FOUND',
])

export interface SdMonitorIngestItem {
  alert: SdMonitorAlertDTO
  outcome: SdMonitorIngestDTO['outcome']
  ticketCode: string | null
}

/** O primeiro alerta do envio (compatível com o formato antigo) + todos. */
export interface SdMonitorIngestResult extends SdMonitorIngestItem {
  results: SdMonitorIngestItem[]
}

function audience(ticket: SdTicketWithRelations) {
  return {
    requesterId: ticket.requesterId,
    participantIds: ticket.participants.map((p) => p.userId),
    contactUserId: ticket.contact?.userId ?? null,
  }
}

async function publish(
  ticket: SdTicketWithRelations,
  type: 'ticket.message' | 'ticket.updated',
): Promise<void> {
  await publishSdTicketEvent(
    ticket.workspaceId,
    {
      type,
      ticketId: ticket.id,
      number: ticket.number,
      at: new Date().toISOString(),
      actorId: null,
    },
    audience(ticket),
  )
}

/** Item de configuração que corresponde ao host (ou aos nomes) do alerta. */
async function matchConfigItem(
  workspaceId: string,
  event: SdMonitorEvent,
): Promise<string | null> {
  const hosts = [event.host, ...event.hostAliases].filter(
    (h): h is string => !!h,
  )
  if (hosts.length === 0) return null
  const found = await SdMonitorAlertRepository.findConfigItemByHosts(
    workspaceId,
    hosts,
  )
  if (!found.ok) {
    logger.warn('servicedesk.monitor.ci_lookup_failed', {
      workspaceId,
      reason: found.error.code,
    })
    return null
  }
  return found.value?.id ?? null
}

/** Abre o chamado com os padrões da origem. */
async function openTicket(
  source: SdMonitorSource,
  event: SdMonitorEvent,
  configItemId: string | null,
  config: SdEngineConfig,
): Promise<Result<SdTicketWithRelations>> {
  const priorityId = sdMonitorPriorityId(
    sdMonitorSeverityMap(source.severityMap),
    event.severity,
  )
  const base = {
    type: source.ticketType,
    title: event.subject,
    description: sdMonitorTicketBody(event, source.name),
    channel: 'API' as const,
    departmentId: source.departmentId ?? undefined,
    customerId: source.customerId ?? undefined,
    configItemId: configItemId ?? undefined,
    tags: event.tags.slice(0, 10),
    ...(priorityId ? { priorityId } : {}),
  }
  const actor = sdSystemActor(SOURCE)
  const created = await SdTicketEngine.create(
    source.workspaceId,
    { ...base, categoryId: source.categoryId ?? undefined },
    actor,
    config,
  )
  // A categoria padrão da origem pode não servir ao tipo: abre sem catálogo.
  if (
    !created.ok &&
    source.categoryId &&
    CATALOG_ERRORS.has(created.error.code)
  ) {
    return SdTicketEngine.create(source.workspaceId, base, actor, config)
  }
  return created
}

/** Mensagem pública de sistema (plano B quando a fase é recusada). */
async function postSystemMessage(
  ticket: SdTicketWithRelations,
  body: string,
  visibility: 'PUBLIC' | 'INTERNAL' = 'PUBLIC',
): Promise<void> {
  const posted = await SdAutomationRepository.insertSystemMessage({
    workspaceId: ticket.workspaceId,
    ticketId: ticket.id,
    body,
    visibility,
  })
  if (!posted.ok) {
    logger.warn('servicedesk.monitor.message_failed', {
      ticketId: ticket.id,
      reason: posted.error.code,
    })
    return
  }
  await publish(ticket, 'ticket.message')
}

/**
 * Leva o chamado à fase `RESOLVED` do tipo com a solução automática. Se o
 * motor recusar (campos obrigatórios, aprovação, classificação da solução)
 * ou o tipo não tiver fase resolvida, publica uma mensagem pública no lugar
 * e devolve `false`.
 */
async function resolveTicket(
  ticket: SdTicketWithRelations,
  source: SdMonitorSource,
  event: SdMonitorEvent,
  config: SdEngineConfig,
): Promise<boolean> {
  const solution = `Alerta "${event.subject}" normalizado no monitoramento (${source.name}).`
  const phaseId = await SdMonitorAlertRepository.findPhaseIdByCategory(
    ticket.workspaceId,
    ticket.type,
    'RESOLVED',
  )
  if (phaseId.ok && phaseId.value) {
    const moved = await SdTicketEngine.changePhase(
      ticket,
      phaseId.value,
      sdSystemActor(SOURCE),
      config,
      { solution, comment: solution, reason: 'monitor.auto_resolve' },
    )
    if (moved.ok) return true
    await postSystemMessage(
      ticket,
      `<p>${solution} O chamado não foi encerrado automaticamente: ${moved.error.message}</p>`,
    )
    return false
  }
  await postSystemMessage(
    ticket,
    `<p>${solution} O chamado não foi encerrado automaticamente: o tipo não tem fase de resolução ativa.</p>`,
  )
  return false
}

/**
 * Reabre o chamado anterior (flapping). Se ele já está numa fase aberta,
 * basta avisar; se o motor recusar a transição, publica a mensagem.
 */
async function reopenTicket(
  ticket: SdTicketWithRelations,
  event: SdMonitorEvent,
  config: SdEngineConfig,
): Promise<void> {
  const note = `<p>O alerta "${escapeHtml(event.subject)}" voltou a disparar dentro da janela de instabilidade — o chamado foi reaberto em vez de abrir um novo.</p>`
  const final = ['RESOLVED', 'CLOSED', 'CANCELED'].includes(
    ticket.phase.category,
  )
  if (!final) {
    await postSystemMessage(ticket, note)
    return
  }
  const phaseId = await SdMonitorAlertRepository.findPhaseIdByCategory(
    ticket.workspaceId,
    ticket.type,
    'IN_PROGRESS',
  )
  const target = phaseId.ok && phaseId.value ? phaseId.value : null
  const fallback = target
    ? null
    : await SdMonitorAlertRepository.findPhaseIdByCategory(
        ticket.workspaceId,
        ticket.type,
        'NEW',
      )
  const phase = target ?? (fallback?.ok ? fallback.value : null)
  if (!phase) {
    await postSystemMessage(ticket, note)
    return
  }
  const moved = await SdTicketEngine.changePhase(
    ticket,
    phase,
    sdSystemActor(SOURCE),
    config,
    { comment: 'Alerta reincidente (flapping)', reason: 'monitor.flapping' },
  )
  await postSystemMessage(
    ticket,
    moved.ok
      ? note
      : `${note}<p>Não foi possível mover a fase automaticamente: ${escapeHtml(moved.error.message)}</p>`,
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isFlapping(
  source: SdMonitorSource,
  alert: SdMonitorAlertWithRelations,
  now: Date,
): boolean {
  if (source.flappingWindowMinutes <= 0 || !alert.resolvedAt) return false
  const elapsed = now.getTime() - alert.resolvedAt.getTime()
  return elapsed <= source.flappingWindowMinutes * 60_000
}

async function trace(
  ticketId: string,
  workspaceId: string,
  action: string,
  alert: { id: string; externalId: string; severity: string | null },
  meta: Record<string, Prisma.InputJsonValue> = {},
): Promise<void> {
  await recordSdTicketEvent({
    workspaceId,
    ticketId,
    actorKind: 'SYSTEM',
    actorUserId: null,
    action,
    meta: {
      alertId: alert.id,
      externalId: alert.externalId,
      severity: alert.severity ?? '',
      ...meta,
    },
  })
}

/**
 * Alert that opened or reopened a ticket: whoever is on call right now for
 * the ticket's team (first layer, only while the schedule applies) hears
 * about it through `monitor.alert`. Never fails the ingestion.
 */
async function notifyOnCall(
  ticket: SdTicketWithRelations,
  event: SdMonitorEvent,
  config: SdEngineConfig,
  reopened: boolean,
  now: Date,
): Promise<void> {
  const warn = (reason: string) =>
    logger.warn('servicedesk.monitor.oncall_notify_failed', {
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      reason,
    })
  const target = await sdOnCallEscalationTarget(
    ticket.workspaceId,
    ticket.departmentId,
    now,
    1,
  )
  if (!target.ok) return warn(target.error.code)
  const userId = target.value?.slot?.userId
  if (!userId) return

  const code = sdTicketCode(ticket, config.prefixes)
  const sent = await notifySdEvent({
    workspaceId: ticket.workspaceId,
    event: 'monitor.alert',
    ticket: sdNotifyTicketOf(ticket, code),
    audience: 'payload',
    payload: {
      title: reopened
        ? `Alerta voltou e reabriu ${code}`
        : `Alerta do monitoramento abriu ${code}`,
      body: event.host ? `${event.subject} (${event.host})` : event.subject,
      userIds: [userId],
      meta: { scheduleId: target.value?.scheduleId, reopened },
    },
  })
  if (!sent.ok) warn(sent.error.code)
}

interface Handled {
  alert: SdMonitorAlertWithRelations
  outcome: SdMonitorIngestDTO['outcome']
  ticket: SdTicketWithRelations | null
}

/**
 * Chamado aberto de outro alerta da mesma máquina (mesma chave, atividade
 * dentro da janela) onde o alerta novo deve entrar. `null` = não correlaciona.
 */
async function findCorrelatedTicket(
  source: SdMonitorSource,
  correlationKey: string | null,
  now: Date,
): Promise<{ ticket: SdTicketWithRelations; rootAlertId: string } | null> {
  if (source.correlationMode === 'OFF' || !correlationKey) return null
  const since = new Date(
    now.getTime() - source.correlationWindowMinutes * 60_000,
  )
  const root = await SdMonitorAlertRepository.findCorrelationTarget(
    source.workspaceId,
    correlationKey,
    since,
  )
  if (!root.ok || !root.value?.ticketId) {
    if (!root.ok) {
      logger.warn('servicedesk.monitor.correlation_lookup_failed', {
        workspaceId: source.workspaceId,
        reason: root.error.code,
      })
    }
    return null
  }
  const ticket = await SdTicketRepository.findById(
    root.value.ticketId,
    source.workspaceId,
  )
  if (!ticket.ok) return null
  return { ticket: ticket.value, rootAlertId: root.value.id }
}

/** PROBLEM: abre, deduplica, correlaciona ou reabre (flapping). */
async function handleProblem(
  source: SdMonitorSource,
  event: SdMonitorEvent,
  existing: SdMonitorAlertWithRelations | null,
  config: SdEngineConfig,
  now: Date,
): Promise<Result<Handled>> {
  const workspaceId = source.workspaceId
  const configItemId = await matchConfigItem(workspaceId, event)
  const common = {
    subject: event.subject,
    body: event.body,
    severity: event.severity,
    host: event.host,
    configItemId,
    payload: event.raw as Prisma.InputJsonValue,
    correlationKey: sdMonitorCorrelationKey(configItemId, event.host),
    lastSeenAt: now,
  }

  // Alerta já aberto: só atualiza (deduplicação).
  if (existing && existing.status === 'OPEN') {
    const updated = await SdMonitorAlertRepository.update(existing.id, {
      ...common,
      occurrences: { increment: 1 },
    })
    if (!updated.ok) return updated
    if (existing.ticketId) {
      await trace(existing.ticketId, workspaceId, 'monitor.alert_repeated', {
        id: existing.id,
        externalId: existing.externalId,
        severity: event.severity,
      })
    }
    return ok({ alert: updated.value, outcome: 'alert_updated', ticket: null })
  }

  // Alerta ignorado: registra o recebimento e não abre nada.
  if (existing && existing.status === 'IGNORED') {
    const updated = await SdMonitorAlertRepository.update(existing.id, {
      ...common,
      occurrences: { increment: 1 },
    })
    if (!updated.ok) return updated
    return ok({ alert: updated.value, outcome: 'alert_updated', ticket: null })
  }

  // Flapping: o mesmo alerta voltou dentro da janela → reabre o chamado.
  if (existing?.ticketId && isFlapping(source, existing, now)) {
    const ticket = await SdTicketRepository.findById(
      existing.ticketId,
      workspaceId,
    )
    if (ticket.ok) {
      await reopenTicket(ticket.value, event, config)
      const updated = await SdMonitorAlertRepository.update(existing.id, {
        ...common,
        status: 'OPEN',
        resolvedAt: null,
        startedAt: event.startedAt ?? now,
        occurrences: { increment: 1 },
      })
      if (!updated.ok) return updated
      await trace(ticket.value.id, workspaceId, 'monitor.alert_reopened', {
        id: existing.id,
        externalId: existing.externalId,
        severity: event.severity,
      })
      return ok({
        alert: updated.value,
        outcome: 'ticket_reopened',
        ticket: ticket.value,
      })
    }
    logger.warn('servicedesk.monitor.flapping_ticket_missing', {
      workspaceId,
      alertId: existing.id,
    })
  }

  // Correlação: outro alerta da mesma máquina já tem chamado aberto.
  const target = await findCorrelatedTicket(source, common.correlationKey, now)
  if (target) {
    const data = {
      ...common,
      status: 'OPEN' as const,
      resolvedAt: null,
      ticketId: target.ticket.id,
      startedAt: event.startedAt ?? now,
      correlated: true,
      occurrences: 1,
    }
    const alert = existing
      ? await SdMonitorAlertRepository.update(existing.id, data)
      : await SdMonitorAlertRepository.create({
          ...data,
          workspaceId,
          sourceId: source.id,
          externalId: event.externalId,
        })
    if (!alert.ok) return alert

    const where = event.host ? ` em ${escapeHtml(event.host)}` : ''
    const severity = event.severity
      ? ` (severidade ${escapeHtml(event.severity)})`
      : ''
    await postSystemMessage(
      target.ticket,
      `<p>Outro alerta${where} entrou neste chamado em vez de abrir um novo: "${escapeHtml(event.subject)}"${severity}, origem ${escapeHtml(source.name)}.</p>`,
      'INTERNAL',
    )
    await trace(
      target.ticket.id,
      workspaceId,
      'monitor.alert_correlated',
      {
        id: alert.value.id,
        externalId: alert.value.externalId,
        severity: event.severity,
      },
      { rootAlertId: target.rootAlertId },
    )
    return ok({
      alert: alert.value,
      outcome: 'alert_correlated',
      ticket: target.ticket,
    })
  }

  const ticket = await openTicket(source, event, configItemId, config)
  if (!ticket.ok) {
    auditMutation({
      entity: 'sd_monitor_alert',
      action: 'create',
      actorId: null,
      outcome: 'failure',
      reason: ticket.error.code,
      meta: { workspaceId, sourceId: source.id },
    })
    return ticket
  }

  const data = {
    ...common,
    status: 'OPEN' as const,
    resolvedAt: null,
    ticketId: ticket.value.id,
    startedAt: event.startedAt ?? now,
    correlated: false,
    occurrences: 1,
  }
  const alert = existing
    ? await SdMonitorAlertRepository.update(existing.id, data)
    : await SdMonitorAlertRepository.create({
        ...data,
        workspaceId,
        sourceId: source.id,
        externalId: event.externalId,
      })
  if (!alert.ok) return alert

  await trace(ticket.value.id, workspaceId, 'monitor.alert_opened', {
    id: alert.value.id,
    externalId: alert.value.externalId,
    severity: event.severity,
  })
  void fireSdAutomations('TICKET_CREATED', ticket.value.id)
  return ok({
    alert: alert.value,
    outcome: 'ticket_created',
    ticket: ticket.value,
  })
}

/**
 * Avisa que o alerta normalizou mas o chamado segue aberto porque outros
 * alertas ligados a ele ainda não normalizaram.
 */
async function noteOthersStillOpen(
  ticket: SdTicketWithRelations,
  event: SdMonitorEvent,
  remaining: number | null,
): Promise<void> {
  const left =
    remaining === null
      ? 'ainda há alertas abertos'
      : `${remaining} ${remaining === 1 ? 'alerta segue aberto' : 'alertas seguem abertos'}`
  await postSystemMessage(
    ticket,
    `<p>O alerta "${escapeHtml(event.subject)}" normalizou, mas ${left} neste chamado. Ele será encerrado quando o último normalizar.</p>`,
    'INTERNAL',
  )
}

/** OK/RESOLVED: fecha o alerta e, se configurado, resolve o chamado. */
async function handleResolved(
  source: SdMonitorSource,
  event: SdMonitorEvent,
  existing: SdMonitorAlertWithRelations | null,
  config: SdEngineConfig,
  now: Date,
): Promise<Result<Handled>> {
  const workspaceId = source.workspaceId
  const common = {
    subject: event.subject,
    body: event.body,
    severity: event.severity,
    host: event.host,
    payload: event.raw as Prisma.InputJsonValue,
    status: 'RESOLVED' as const,
    resolvedAt: now,
    lastSeenAt: now,
  }

  if (!existing) {
    // Normalização de um alerta que nunca chegou como problema: só registra.
    const configItemId = await matchConfigItem(workspaceId, event)
    const created = await SdMonitorAlertRepository.create({
      ...common,
      workspaceId,
      sourceId: source.id,
      externalId: event.externalId,
      configItemId,
      correlationKey: sdMonitorCorrelationKey(configItemId, event.host),
      startedAt: event.startedAt ?? now,
    })
    if (!created.ok) return created
    return ok({ alert: created.value, outcome: 'alert_resolved', ticket: null })
  }

  const updated = await SdMonitorAlertRepository.update(existing.id, common)
  if (!updated.ok) return updated

  if (!existing.ticketId) {
    return ok({ alert: updated.value, outcome: 'alert_resolved', ticket: null })
  }

  const ticket = await SdTicketRepository.findById(
    existing.ticketId,
    workspaceId,
  )
  if (!ticket.ok) {
    return ok({ alert: updated.value, outcome: 'alert_resolved', ticket: null })
  }

  let resolved = false
  if (existing.status === 'OPEN') {
    // Com alertas correlacionados, o chamado só encerra no último.
    const others = await SdMonitorAlertRepository.countOpenByTicket(
      existing.ticketId,
      existing.id,
    )
    const stillOpen = !others.ok || others.value > 0
    if (stillOpen) {
      await noteOthersStillOpen(
        ticket.value,
        event,
        others.ok ? others.value : null,
      )
    } else if (source.autoResolve) {
      resolved = await resolveTicket(ticket.value, source, event, config)
    } else {
      await postSystemMessage(
        ticket.value,
        `<p>O alerta "${escapeHtml(event.subject)}" normalizou no monitoramento (${escapeHtml(source.name)}).</p>`,
      )
    }
  }
  await trace(
    ticket.value.id,
    workspaceId,
    'monitor.alert_resolved',
    {
      id: updated.value.id,
      externalId: updated.value.externalId,
      severity: event.severity,
    },
    { autoResolved: resolved },
  )

  return ok({
    alert: updated.value,
    outcome: resolved ? 'ticket_resolved' : 'alert_resolved',
    ticket: ticket.value,
  })
}

/** Um evento do envio: aplica as regras, publica, notifica e audita. */
async function processEvent(
  source: SdMonitorSource,
  event: SdMonitorEvent,
  config: SdEngineConfig,
  now: Date,
): Promise<Result<SdMonitorIngestItem>> {
  const existing = await SdMonitorAlertRepository.findByExternalId(
    source.id,
    event.externalId,
  )
  if (!existing.ok) return existing

  const handled = event.resolved
    ? await handleResolved(source, event, existing.value, config, now)
    : await handleProblem(source, event, existing.value, config, now)
  if (!handled.ok) return handled

  const { alert, outcome, ticket } = handled.value
  if (ticket) await publish(ticket, 'ticket.updated')
  if (
    ticket &&
    (outcome === 'ticket_created' || outcome === 'ticket_reopened')
  ) {
    await notifyOnCall(
      ticket,
      event,
      config,
      outcome === 'ticket_reopened',
      now,
    )
  }

  auditMutation({
    entity: 'sd_monitor_alert',
    action: event.resolved ? 'resolve' : 'alert',
    actorId: null,
    targetId: alert.id,
    meta: {
      workspaceId: source.workspaceId,
      sourceId: source.id,
      outcome,
      ticketId: alert.ticketId,
    },
  })
  logger.info('servicedesk.monitor.alert_received', {
    workspaceId: source.workspaceId,
    sourceId: source.id,
    alertId: alert.id,
    outcome,
    resolved: event.resolved,
  })

  return ok({
    alert: toSdMonitorAlertDTO(alert),
    outcome,
    ticketCode: alert.ticket
      ? sdTicketCode(alert.ticket, config.prefixes)
      : null,
  })
}

export const SdMonitorIngestService = {
  /**
   * Recebe um envio pelo token público (um alerta, ou vários no caso do
   * Grafana/Alertmanager). Devolve o primeiro resultado (formato antigo) e
   * a lista completa em `results`. Um erro interrompe o lote; reenviar é
   * seguro porque a deduplicação por `externalId` repete sem efeito colateral.
   */
  async ingest(
    token: string,
    payload: unknown,
  ): Promise<Result<SdMonitorIngestResult>> {
    const found = await SdMonitorSourceRepository.findByTokenHash(
      hashSdMonitorToken(token),
    )
    if (!found.ok) return found
    const source = found.value
    if (!source) return err(sdMonitorTokenInvalid())

    const enabled = await assertModuleEnabled(
      source.workspaceId,
      'SERVICE_DESK',
    )
    if (!enabled.ok) return enabled

    const events = parseSdMonitorEvents(source.kind, payload)
    if (events.length === 0) {
      logger.warn('servicedesk.monitor.payload_invalid', {
        workspaceId: source.workspaceId,
        sourceId: source.id,
      })
      return err(sdMonitorPayloadInvalid())
    }

    const config = await SdTicketEngine.loadConfig(source.workspaceId)
    if (!config.ok) return config

    const now = new Date()
    const results: SdMonitorIngestItem[] = []
    for (const event of events) {
      const item = await processEvent(source, event, config.value, now)
      if (!item.ok) return item
      results.push(item.value)
    }

    await SdMonitorSourceRepository.touchLastEvent(source.id, now)
    return ok({ ...results[0], results })
  },
}
