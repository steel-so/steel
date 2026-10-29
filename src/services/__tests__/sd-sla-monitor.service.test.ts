import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdEscalation,
  createFakeSdTicket,
} from '@/src/__tests__/factories/sd-ticket.factory'
import {
  createFakeSdEscalationRule,
  createFakeSdPhase,
  createFakeSdSettings,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'
import type { SdTicketWithRelations } from '@/src/repositories/sd-ticket.repository'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('@/src/repositories/sd-ticket-escalation.repository')
vi.mock('../sd-automation-engine', () => ({ runSdAutomations: vi.fn() }))
vi.mock('../steel-agent-dispatcher', () => ({
  dispatchSteelAgentEvent: vi.fn(),
}))
vi.mock('../sd-ticket-escalator', () => ({ runSdEscalationRule: vi.fn() }))
vi.mock('../sd-ticket-event-recorder', () => ({ recordSdTicketEvent: vi.fn() }))
vi.mock('@/src/services/sd-notification.service', () => ({
  notifySdEvent: vi.fn(async () => ({ ok: true, value: {} })),
}))
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: { loadConfig: vi.fn(), changePhase: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { SdTicketEscalationRepository } from '@/src/repositories/sd-ticket-escalation.repository'
import { runSdAutomations } from '../sd-automation-engine'
import { notifySdEvent } from '../sd-notification.service'
import { SdSlaMonitorService } from '../sd-sla-monitor.service'
import { SdTicketEngine } from '../sd-ticket-engine'
import { runSdEscalationRule } from '../sd-ticket-escalator'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import { dispatchSteelAgentEvent } from '../steel-agent-dispatcher'

const NOW = new Date('2026-09-21T14:00:00Z')
const ticketRepo = vi.mocked(SdTicketRepository)
const ctxRepo = vi.mocked(SdTicketContextRepository)
const escRepo = vi.mocked(SdTicketEscalationRepository)
const engine = vi.mocked(SdTicketEngine)
const escalate = vi.mocked(runSdEscalationRule)
const automations = vi.mocked(runSdAutomations)

function config(overrides = {}) {
  return {
    settings: createFakeSdSettings({
      autoCloseResolvedAfterHours: 0,
      ...overrides,
    }),
    prefixes: DEFAULT_SD_TICKET_PREFIXES,
  }
}

/** 1ª resposta vencida (13:00), resolução em risco (92% às 14:00). */
function slaTicket(overrides: Partial<SdTicketWithRelations> = {}) {
  return createFakeSdTicket({
    id: 't1',
    number: 9,
    assigneeId: 'a1',
    departmentId: 'd1',
    createdAt: new Date('2026-09-21T12:00:00Z'),
    lastActivityAt: new Date('2026-09-21T13:55:00Z'),
    firstResponseDueAt: new Date('2026-09-21T13:00:00Z'),
    resolutionDueAt: new Date('2026-09-21T14:10:00Z'),
    ...overrides,
  })
}

function setOpen(...batches: SdTicketWithRelations[][]) {
  for (const batch of batches)
    ticketRepo.listOpenForSla.mockResolvedValueOnce(ok(batch))
  ticketRepo.listOpenForSla.mockResolvedValue(ok([]))
}

beforeEach(() => {
  ctxRepo.listEnabledWorkspaceIds.mockResolvedValue(ok(['ws1']))
  ctxRepo.listActiveEscalationRules.mockResolvedValue(ok([]))
  ctxRepo.listDepartmentLeadIds.mockResolvedValue(ok(['lead']))
  engine.loadConfig.mockResolvedValue(ok(config()))
  ticketRepo.claimSlaFlag.mockResolvedValue(ok(true))
  ticketRepo.findById.mockImplementation(async (id) => ok(slaTicket({ id })))
  automations.mockResolvedValue(ok({ matched: 0, rules: [] }))
  escRepo.findLatestByRule.mockResolvedValue(ok(null))
})

describe('SdSlaMonitorService.runTick', () => {
  it('counts an error when the workspace list fails', async () => {
    ctxRepo.listEnabledWorkspaceIds.mockResolvedValue(err(databaseError()))
    expect((await SdSlaMonitorService.runTick(NOW)).errors).toBe(1)
  })

  it('counts config and batch failures', async () => {
    engine.loadConfig.mockResolvedValueOnce(err(databaseError()))
    expect((await SdSlaMonitorService.runTick(NOW)).errors).toBe(1)
    ctxRepo.listActiveEscalationRules.mockResolvedValue(err(databaseError()))
    ticketRepo.listOpenForSla.mockResolvedValue(err(databaseError()))
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result.errors).toBe(2)
    expect(result.workspaces).toBe(1)
  })

  it('marks breach and at-risk once, notifies and runs automations', async () => {
    setOpen([slaTicket()])
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result).toMatchObject({
      tickets: 1,
      breached: 1,
      atRisk: 1,
      errors: 0,
    })
    expect(ticketRepo.claimSlaFlag).toHaveBeenCalledWith(
      't1',
      'firstResponseBreached',
      NOW,
    )
    expect(ticketRepo.claimSlaFlag).toHaveBeenCalledWith('t1', 'slaAtRisk', NOW)
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sla.first_response_breached' }),
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sla.at_risk',
        meta: { timers: ['resolução'] },
      }),
    )
    expect(notifySdEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sla.breached',
        ticket: expect.objectContaining({
          code: 'INC-000009',
          assigneeId: 'a1',
          departmentId: 'd1',
        }),
        payload: expect.objectContaining({
          title: 'SLA violado: INC-000009 (1ª resposta)',
        }),
      }),
    )
    expect(notifySdEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sla.at_risk',
        payload: expect.objectContaining({
          title: 'SLA em risco: INC-000009 (resolução)',
        }),
      }),
    )
    expect(automations).toHaveBeenCalledWith('SLA_BREACHED', 't1')
    expect(automations).toHaveBeenCalledWith('SLA_AT_RISK', 't1')
    expect(dispatchSteelAgentEvent).toHaveBeenCalledWith(
      expect.any(String),
      'sd.sla.at_risk',
      expect.objectContaining({
        ticketId: 't1',
        code: 'INC-000009',
        timers: ['resolução'],
      }),
    )
  })

  it('does not re-mark already flagged tickets; handles both breaches', async () => {
    setOpen([
      slaTicket({
        firstResponseBreached: true,
        slaAtRiskNotifiedAt: NOW,
        departmentId: null,
      }),
      slaTicket({
        id: 't2',
        resolutionDueAt: new Date('2026-09-21T13:30:00Z'),
        departmentId: null,
      }),
    ])
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result.breached).toBe(2)
    expect(result.atRisk).toBe(0)
    expect(notifySdEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          title: 'SLA violado: INC-000009 (1ª resposta e resolução)',
        }),
      }),
    )
  })

  it('handles lost and failed claims', async () => {
    setOpen([slaTicket()])
    ticketRepo.claimSlaFlag
      .mockResolvedValueOnce(ok(false))
      .mockResolvedValueOnce(err(databaseError()))
    let result = await SdSlaMonitorService.runTick(NOW)
    expect(result).toMatchObject({ breached: 0, atRisk: 0, errors: 1 })

    setOpen([slaTicket()])
    ticketRepo.claimSlaFlag
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValueOnce(ok(false))
    result = await SdSlaMonitorService.runTick(NOW)
    expect(result).toMatchObject({ breached: 0, atRisk: 0, errors: 1 })
    expect(automations).not.toHaveBeenCalled()
  })

  it('logs a failed notification without stopping the tick', async () => {
    vi.mocked(notifySdEvent).mockResolvedValueOnce(err(databaseError('nope')))
    setOpen([slaTicket()])
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result.breached).toBe(1)
    expect(result.errors).toBe(0)
  })

  it('processes tickets in batches of 200', async () => {
    const first = Array.from({ length: 200 }, (_, i) =>
      createFakeSdTicket({ id: `t${String(i).padStart(3, '0')}` }),
    )
    setOpen(first, [createFakeSdTicket({ id: 'z' })])
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result.tickets).toBe(201)
    expect(ticketRepo.listOpenForSla).toHaveBeenNthCalledWith(
      2,
      'ws1',
      't199',
      200,
    )
  })

  it('catches unexpected workspace errors', async () => {
    ctxRepo.listEnabledWorkspaceIds.mockResolvedValue(ok(['ws1', 'ws2']))
    engine.loadConfig.mockRejectedValueOnce(new Error('boom'))
    engine.loadConfig.mockRejectedValueOnce('str')
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result).toMatchObject({ workspaces: 2, errors: 2 })
    expect(logger.error).toHaveBeenCalledWith(
      'servicedesk.sla.workspace_failed',
      expect.objectContaining({ message: 'str' }),
    )
  })

  it('uses the current time by default', async () => {
    ctxRepo.listEnabledWorkspaceIds.mockResolvedValue(ok([]))
    expect((await SdSlaMonitorService.runTick()).workspaces).toBe(0)
  })
})

describe('escalation rules', () => {
  it('runs breach/at-risk rules whose trigger fired and conditions match', async () => {
    const breach = createFakeSdEscalationRule({
      id: 'r1',
      trigger: 'FIRST_RESPONSE_BREACHED',
    })
    const risk = createFakeSdEscalationRule({
      id: 'r2',
      trigger: 'RESOLUTION_AT_RISK',
    })
    const other = createFakeSdEscalationRule({
      id: 'r3',
      trigger: 'RESOLUTION_BREACHED',
    })
    const noMatch = createFakeSdEscalationRule({
      id: 'r4',
      trigger: 'FIRST_RESPONSE_BREACHED',
      conditions: [{ field: 'type', operator: 'equals', value: 'CHANGE' }],
    })
    const invalid = createFakeSdEscalationRule({
      id: 'r5',
      trigger: 'FIRST_RESPONSE_BREACHED',
      conditions: 'x',
    })
    ctxRepo.listActiveEscalationRules.mockResolvedValue(
      ok([breach, risk, other, noMatch, invalid]),
    )
    escalate.mockImplementation(async (t) =>
      ok({ ticket: t, escalation: createFakeSdEscalation() }),
    )
    setOpen([slaTicket()])
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result.escalations).toBe(2)
    expect(escalate.mock.calls.map((c) => c[1].id)).toEqual(['r1', 'r2'])
  })

  it('skips candidates when there are none, and counts reload/escalation failures', async () => {
    ctxRepo.listActiveEscalationRules.mockResolvedValue(
      ok([createFakeSdEscalationRule({ trigger: 'RESOLUTION_BREACHED' })]),
    )
    setOpen([slaTicket()])
    await SdSlaMonitorService.runTick(NOW)
    expect(ticketRepo.findById).not.toHaveBeenCalled()

    ctxRepo.listActiveEscalationRules.mockResolvedValue(
      ok([createFakeSdEscalationRule({ trigger: 'FIRST_RESPONSE_BREACHED' })]),
    )
    ticketRepo.findById.mockResolvedValueOnce(err(databaseError()))
    setOpen([slaTicket()])
    expect((await SdSlaMonitorService.runTick(NOW)).errors).toBe(1)

    escalate.mockResolvedValue(err(databaseError()))
    setOpen([slaTicket()])
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result).toMatchObject({ escalations: 0, errors: 1 })
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.sla.escalation_failed',
      expect.any(Object),
    )
  })

  it('NO_UPDATE: threshold, once per inactivity period', async () => {
    const rule = createFakeSdEscalationRule({
      id: 'nu',
      trigger: 'NO_UPDATE',
      thresholdMinutes: 60,
    })
    const zero = createFakeSdEscalationRule({
      trigger: 'NO_UPDATE',
      thresholdMinutes: 0,
    })
    const none = createFakeSdEscalationRule({
      trigger: 'NO_UPDATE',
      thresholdMinutes: null,
    })
    ctxRepo.listActiveEscalationRules.mockResolvedValue(ok([zero, none, rule]))
    escalate.mockImplementation(async (t) =>
      ok({ ticket: t, escalation: createFakeSdEscalation() }),
    )
    const calm = { firstResponseDueAt: null, resolutionDueAt: null }

    // atividade recente → não escala
    ticketRepo.findById.mockResolvedValue(ok(slaTicket(calm)))
    setOpen([slaTicket(calm)])
    expect((await SdSlaMonitorService.runTick(NOW)).escalations).toBe(0)

    const stale = slaTicket({
      ...calm,
      lastActivityAt: new Date('2026-09-21T12:00:00Z'),
    })
    ticketRepo.findById.mockResolvedValue(ok(stale))

    // já escalou depois da última atividade → não repete
    escRepo.findLatestByRule.mockResolvedValue(
      ok(
        createFakeSdEscalation({ createdAt: new Date('2026-09-21T12:30:00Z') }),
      ),
    )
    setOpen([stale])
    expect((await SdSlaMonitorService.runTick(NOW)).escalations).toBe(0)

    // lookup falhou → não escala
    escRepo.findLatestByRule.mockResolvedValue(err(databaseError()))
    setOpen([stale])
    expect((await SdSlaMonitorService.runTick(NOW)).escalations).toBe(0)

    // escalada antiga (antes da atividade) → escala de novo
    escRepo.findLatestByRule.mockResolvedValue(
      ok(
        createFakeSdEscalation({ createdAt: new Date('2026-09-21T11:00:00Z') }),
      ),
    )
    setOpen([stale])
    expect((await SdSlaMonitorService.runTick(NOW)).escalations).toBe(1)
    expect(escalate).toHaveBeenLastCalledWith(
      stale,
      rule,
      expect.objectContaining({ kind: 'system' }),
      expect.any(Object),
    )
  })
})

describe('auto-close', () => {
  const closed = createFakeSdPhase({ id: 'closed', category: 'CLOSED' })

  beforeEach(() => {
    setOpen()
    engine.loadConfig.mockResolvedValue(
      ok(config({ autoCloseResolvedAfterHours: 72 })),
    )
    ctxRepo.findFirstPhaseByCategory.mockResolvedValue(ok(closed))
  })

  it('is skipped when disabled', async () => {
    engine.loadConfig.mockResolvedValue(ok(config()))
    await SdSlaMonitorService.runTick(NOW)
    expect(ticketRepo.listResolvedBefore).not.toHaveBeenCalled()
  })

  it('counts a listing error', async () => {
    ticketRepo.listResolvedBefore.mockResolvedValue(err(databaseError()))
    expect((await SdSlaMonitorService.runTick(NOW)).errors).toBe(1)
  })

  it('closes resolved tickets, caching the CLOSED phase per type', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(
        config({
          autoCloseResolvedAfterHours: 72,
          requireSignatureOnClose: true,
        }),
      ),
    )
    ticketRepo.listResolvedBefore.mockResolvedValue(
      ok([
        createFakeSdTicket({ id: 'a' }),
        createFakeSdTicket({ id: 'b' }),
        createFakeSdTicket({ id: 'c', type: 'CHANGE' }),
        createFakeSdTicket({ id: 'd', type: 'PROBLEM' }),
      ]),
    )
    ctxRepo.findFirstPhaseByCategory.mockImplementation(async (_ws, type) =>
      type === 'CHANGE'
        ? ok(null)
        : type === 'PROBLEM'
          ? err(databaseError())
          : ok(closed),
    )
    engine.changePhase
      .mockResolvedValueOnce(ok(createFakeSdTicket({ id: 'a' })))
      .mockResolvedValueOnce(err(databaseError()))
    const result = await SdSlaMonitorService.runTick(NOW)
    expect(result).toMatchObject({ autoClosed: 1, errors: 1 })
    expect(ticketRepo.listResolvedBefore).toHaveBeenCalledWith(
      'ws1',
      new Date(NOW.getTime() - 72 * 3_600_000),
      100,
      true,
    )
    expect(ctxRepo.findFirstPhaseByCategory).toHaveBeenCalledTimes(3)
    expect(engine.changePhase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      'closed',
      expect.objectContaining({ kind: 'system' }),
      expect.any(Object),
      { reason: 'auto_close' },
    )
    expect(automations).toHaveBeenCalledWith('PHASE_CHANGED', 'a')
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.sla.auto_close_failed',
      expect.objectContaining({ ticketId: 'b' }),
    )
  })
})
