import type {
  SdEscalationRule,
  SdEscalationTrigger,
  SdPhase,
  SdTicketType,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { evaluateSdConditions } from '@/src/lib/servicedesk/conditions'
import { sdNotifyTicketOf } from '@/src/lib/servicedesk/notify'
import { computeSlaState, parseSdCalendar } from '@/src/lib/servicedesk/sla'
import {
  SdTicketRepository,
  type SdTicketWithRelations,
} from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { SdTicketEscalationRepository } from '@/src/repositories/sd-ticket-escalation.repository'
import { SdConditionsSchema } from '@/src/schemas/sd-rule.schema'
import { runSdAutomations } from './sd-automation-engine'
import { notifySdEvent } from './sd-notification.service'
import {
  type SdActor,
  type SdEngineConfig,
  SdTicketEngine,
  sdSystemActor,
  sdTicketCode,
} from './sd-ticket-engine'
import { runSdEscalationRule } from './sd-ticket-escalator'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'
import { sdTicketRowFacts } from './sd-ticket-rules'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'

/**
 * Tick de SLA do ServiceDesk (worker `servicedesk-sla`, 1×/min), para todo
 * workspace com o módulo habilitado:
 *
 * 1. chamados abertos (lotes de 200): calcula o SLA; marca
 *    `firstResponseBreached`/`resolutionBreached` e o aviso de risco
 *    (`slaAtRiskNotifiedAt`) **uma única vez** (escrita condicional), com
 *    evento, notificação (responsável + líderes do departamento) e
 *    automações `SLA_BREACHED`/`SLA_AT_RISK`;
 * 2. regras de escalonamento: `*_AT_RISK`/`*_BREACHED` no momento da
 *    marcação; `NO_UPDATE` quando `lastActivityAt` passou de
 *    `thresholdMinutes` (uma vez por período de inatividade);
 * 3. fecha chamados RESOLVED há mais de `autoCloseResolvedAfterHours`
 *    (pula quem precisa de assinatura e não tem).
 *
 * Idempotente: rodar duas vezes no mesmo minuto não duplica nada.
 */

export interface SdSlaTickResult {
  workspaces: number
  tickets: number
  breached: number
  atRisk: number
  escalations: number
  autoClosed: number
  errors: number
}

const BATCH = 200
const AUTO_CLOSE_BATCH = 100
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

interface WorkspaceRun {
  config: SdEngineConfig
  rules: SdEscalationRule[]
  actor: SdActor
  now: Date
  result: SdSlaTickResult
}

async function notifySla(
  t: SdTicketWithRelations,
  run: WorkspaceRun,
  event: 'sla.at_risk' | 'sla.breached',
  what: string,
): Promise<void> {
  const code = sdTicketCode(t, run.config.prefixes)
  const breached = event === 'sla.breached'
  const sent = await notifySdEvent({
    workspaceId: t.workspaceId,
    event,
    ticket: sdNotifyTicketOf(t, code),
    payload: {
      title: breached
        ? `SLA violado: ${code} (${what})`
        : `SLA em risco: ${code} (${what})`,
      body: t.title,
      meta: { what },
    },
  })
  if (!sent.ok) {
    logger.warn('servicedesk.sla.notify_failed', {
      workspaceId: t.workspaceId,
      ticketId: t.id,
      event,
      reason: sent.error.code,
    })
  }
}

/** `candidates` já vem filtrado pelo gatilho; aqui NO_UPDATE + condições. */
async function matchesRule(
  rule: SdEscalationRule,
  t: SdTicketWithRelations,
  now: Date,
): Promise<boolean> {
  if (rule.trigger === 'NO_UPDATE') {
    if (!rule.thresholdMinutes || rule.thresholdMinutes <= 0) return false
    if (
      now.getTime() - t.lastActivityAt.getTime() <
      rule.thresholdMinutes * MINUTE_MS
    ) {
      return false
    }
    const latest = await SdTicketEscalationRepository.findLatestByRule(
      t.id,
      rule.id,
    )
    if (!latest.ok) return false
    if (latest.value && latest.value.createdAt >= t.lastActivityAt) return false
  }
  const conditions = SdConditionsSchema.safeParse(rule.conditions)
  if (!conditions.success) return false
  return evaluateSdConditions(conditions.data, sdTicketRowFacts(t))
}

async function processTicket(t: SdTicketWithRelations, run: WorkspaceRun) {
  const { config, now, result } = run
  const state = computeSlaState(t, now, {
    atRiskPercent: config.settings.slaAtRiskPercent,
    calendar: parseSdCalendar(t.slaPolicy?.calendar ?? null),
  })
  const triggers: SdEscalationTrigger[] = []
  const breachedWhat: string[] = []

  const timers = [
    {
      timer: state.firstResponse,
      flag: 'firstResponseBreached' as const,
      marked: t.firstResponseBreached,
      breachTrigger: 'FIRST_RESPONSE_BREACHED' as const,
      riskTrigger: 'FIRST_RESPONSE_AT_RISK' as const,
      label: '1ª resposta',
      action: 'sla.first_response_breached',
    },
    {
      timer: state.resolution,
      flag: 'resolutionBreached' as const,
      marked: t.resolutionBreached,
      breachTrigger: 'RESOLUTION_BREACHED' as const,
      riskTrigger: 'RESOLUTION_AT_RISK' as const,
      label: 'resolução',
      action: 'sla.resolution_breached',
    },
  ]

  for (const item of timers) {
    if (item.timer.state !== 'breached' || item.marked) continue
    const claimed = await SdTicketRepository.claimSlaFlag(t.id, item.flag, now)
    if (!claimed.ok) {
      result.errors++
      continue
    }
    if (!claimed.value) continue
    result.breached++
    triggers.push(item.breachTrigger)
    breachedWhat.push(item.label)
    await recordSdTicketEvent({
      workspaceId: t.workspaceId,
      ticketId: t.id,
      actorKind: 'SYSTEM',
      action: item.action,
      toValue: item.timer.dueAt,
    })
  }
  if (breachedWhat.length > 0) {
    await notifySla(t, run, 'sla.breached', breachedWhat.join(' e '))
  }

  const atRisk = timers.filter((i) => i.timer.state === 'at_risk')
  let atRiskNow = false
  if (atRisk.length > 0 && !t.slaAtRiskNotifiedAt) {
    const claimed = await SdTicketRepository.claimSlaFlag(
      t.id,
      'slaAtRisk',
      now,
    )
    if (!claimed.ok) result.errors++
    else if (claimed.value) {
      atRiskNow = true
      result.atRisk++
      for (const item of atRisk) triggers.push(item.riskTrigger)
      await recordSdTicketEvent({
        workspaceId: t.workspaceId,
        ticketId: t.id,
        actorKind: 'SYSTEM',
        action: 'sla.at_risk',
        meta: { timers: atRisk.map((i) => i.label) },
      })
      await notifySla(
        t,
        run,
        'sla.at_risk',
        atRisk.map((i) => i.label).join(' e '),
      )
      void dispatchSteelAgentEvent(t.workspaceId, 'sd.sla.at_risk', {
        ticketId: t.id,
        code: sdTicketCode(t, run.config.prefixes),
        title: t.title,
        timers: atRisk.map((i) => i.label),
      })
    }
  }

  if (breachedWhat.length > 0) await runSdAutomations('SLA_BREACHED', t.id)
  if (atRiskNow) await runSdAutomations('SLA_AT_RISK', t.id)

  const candidates = run.rules.filter(
    (r) => r.trigger === 'NO_UPDATE' || triggers.includes(r.trigger),
  )
  if (candidates.length === 0) return
  const fresh = await SdTicketRepository.findById(t.id, t.workspaceId)
  if (!fresh.ok) {
    result.errors++
    return
  }
  let current = fresh.value
  for (const rule of candidates) {
    if (!(await matchesRule(rule, current, now))) continue
    const escalated = await runSdEscalationRule(
      current,
      rule,
      run.actor,
      config,
    )
    if (!escalated.ok) {
      result.errors++
      logger.warn('servicedesk.sla.escalation_failed', {
        workspaceId: t.workspaceId,
        ticketId: t.id,
        ruleId: rule.id,
        reason: escalated.error.code,
      })
      continue
    }
    result.escalations++
    current = escalated.value.ticket
  }
}

async function autoClose(workspaceId: string, run: WorkspaceRun) {
  const { settings } = run.config
  const hours = settings.autoCloseResolvedAfterHours
  if (hours <= 0) return
  const resolved = await SdTicketRepository.listResolvedBefore(
    workspaceId,
    new Date(run.now.getTime() - hours * HOUR_MS),
    AUTO_CLOSE_BATCH,
    settings.requireSignatureOnClose,
  )
  if (!resolved.ok) {
    run.result.errors++
    return
  }
  const closedPhase = new Map<SdTicketType, SdPhase | null>()
  for (const t of resolved.value) {
    if (!closedPhase.has(t.type)) {
      const phase = await SdTicketContextRepository.findFirstPhaseByCategory(
        workspaceId,
        t.type,
        'CLOSED',
      )
      closedPhase.set(t.type, phase.ok ? phase.value : null)
    }
    const target = closedPhase.get(t.type)
    if (!target) continue
    const moved = await SdTicketEngine.changePhase(
      t,
      target.id,
      run.actor,
      run.config,
      {
        reason: 'auto_close',
      },
    )
    if (!moved.ok) {
      run.result.errors++
      logger.warn('servicedesk.sla.auto_close_failed', {
        workspaceId,
        ticketId: t.id,
        reason: moved.error.code,
      })
      continue
    }
    run.result.autoClosed++
    await runSdAutomations('PHASE_CHANGED', t.id)
  }
}

async function runWorkspace(
  workspaceId: string,
  now: Date,
  result: SdSlaTickResult,
): Promise<void> {
  const config = await SdTicketEngine.loadConfig(workspaceId)
  if (!config.ok) {
    result.errors++
    return
  }
  const rules =
    await SdTicketContextRepository.listActiveEscalationRules(workspaceId)
  if (!rules.ok) result.errors++
  const run: WorkspaceRun = {
    config: config.value,
    rules: rules.ok ? rules.value : [],
    actor: sdSystemActor('sla-monitor'),
    now,
    result,
  }

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
    for (const ticket of batch.value) {
      result.tickets++
      await processTicket(ticket, run)
    }
    if (batch.value.length < BATCH) break
    afterId = batch.value[batch.value.length - 1].id
  }
  await autoClose(workspaceId, run)
}

export const SdSlaMonitorService = {
  async runTick(now = new Date()): Promise<SdSlaTickResult> {
    const result: SdSlaTickResult = {
      workspaces: 0,
      tickets: 0,
      breached: 0,
      atRisk: 0,
      escalations: 0,
      autoClosed: 0,
      errors: 0,
    }
    const workspaces = await SdTicketContextRepository.listEnabledWorkspaceIds()
    if (!workspaces.ok) {
      result.errors++
      return result
    }
    for (const workspaceId of workspaces.value) {
      result.workspaces++
      try {
        await runWorkspace(workspaceId, now, result)
      } catch (error) {
        result.errors++
        logger.error('servicedesk.sla.workspace_failed', {
          workspaceId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return result
  },
}
