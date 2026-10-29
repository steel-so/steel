import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdMonitorAlert,
  createFakeSdMonitorSource,
  sdMonitorToken,
} from '@/src/__tests__/factories/sd-monitor.factory'
import {
  createFakeSdTicket,
  createFakeSdUserSummary,
} from '@/src/__tests__/factories/sd-ticket.factory'
import {
  createFakeSdPhase,
  createFakeSdSettings,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  sdPhaseRequirementsUnmet,
  sdTicketNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/sd-monitor-source.repository')
vi.mock('@/src/repositories/sd-monitor-alert.repository')
vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('@/src/repositories/sd-automation.repository')
vi.mock('@/src/lib/servicedesk/realtime', () => ({
  publishSdTicketEvent: vi.fn(),
}))
vi.mock('../authz', () => ({ assertModuleEnabled: vi.fn() }))
vi.mock('../sd-automation-engine', () => ({
  fireSdAutomations: vi.fn(async () => undefined),
}))
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: {
    loadConfig: vi.fn(),
    create: vi.fn(),
    changePhase: vi.fn(),
  },
}))
vi.mock('../sd-ticket-event-recorder', () => ({ recordSdTicketEvent: vi.fn() }))
vi.mock('../sd-notification.service', () => ({ notifySdEvent: vi.fn() }))
vi.mock('../sd-oncall-resolver', () => ({
  sdOnCallEscalationTarget: vi.fn(async () => ({ ok: true, value: null })),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { publishSdTicketEvent } from '@/src/lib/servicedesk/realtime'
import { SdAutomationRepository } from '@/src/repositories/sd-automation.repository'
import { SdMonitorAlertRepository } from '@/src/repositories/sd-monitor-alert.repository'
import { SdMonitorSourceRepository } from '@/src/repositories/sd-monitor-source.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { assertModuleEnabled } from '../authz'
import { fireSdAutomations } from '../sd-automation-engine'
import { SdMonitorIngestService } from '../sd-monitor-ingest.service'
import { hashSdMonitorToken } from '../sd-monitor-source.service'
import { notifySdEvent } from '../sd-notification.service'
import { sdOnCallEscalationTarget } from '../sd-oncall-resolver'
import { SdTicketEngine } from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'

const sources = vi.mocked(SdMonitorSourceRepository)
const alerts = vi.mocked(SdMonitorAlertRepository)
const tickets = vi.mocked(SdTicketRepository)
const automation = vi.mocked(SdAutomationRepository)
const engine = vi.mocked(SdTicketEngine)

const { token } = sdMonitorToken()
const WS = 'ws1'

const problem = {
  eventId: '31415',
  eventStatus: 'PROBLEM',
  eventName: 'Sem resposta do agente no SRV-01',
  eventSeverity: 'Disaster',
  hostName: 'SRV-01',
  message: 'ICMP ping falhou',
}
const recovery = { ...problem, eventStatus: 'RESOLVED' }

const CONFIG = {
  settings: createFakeSdSettings(),
  prefixes: DEFAULT_SD_TICKET_PREFIXES,
}

function ticket(overrides = {}) {
  return createFakeSdTicket({
    id: 't1',
    number: 42,
    workspaceId: WS,
    channel: 'API',
    ...overrides,
  })
}

beforeEach(() => {
  sources.findByTokenHash.mockResolvedValue(ok(createFakeSdMonitorSource()))
  sources.touchLastEvent.mockResolvedValue(ok(undefined))
  vi.mocked(assertModuleEnabled).mockResolvedValue(ok(true))
  engine.loadConfig.mockResolvedValue(ok(CONFIG))
  engine.create.mockResolvedValue(ok(ticket()))
  engine.changePhase.mockResolvedValue(ok(ticket()))
  alerts.findByExternalId.mockResolvedValue(ok(null))
  alerts.findConfigItemByHosts.mockResolvedValue(
    ok({ id: 'ci-1', name: 'SRV-01' }),
  )
  alerts.findPhaseIdByCategory.mockResolvedValue(ok('phase-resolved'))
  alerts.findCorrelationTarget.mockResolvedValue(ok(null))
  alerts.countOpenByTicket.mockResolvedValue(ok(0))
  alerts.create.mockImplementation(async ({ payload: _p, ...data }) =>
    ok(
      createFakeSdMonitorAlert({
        ...data,
        ticket: data.ticketId
          ? {
              id: 't1',
              number: 42,
              type: 'INCIDENT',
              title: 'Servidor fora',
              phase: { name: 'Novo' },
            }
          : null,
      }),
    ),
  )
  alerts.update.mockImplementation(
    async (id, { payload: _p, occurrences: _o, ...data }) =>
      ok(createFakeSdMonitorAlert({ id, ...data })),
  )
  automation.insertSystemMessage.mockResolvedValue(ok({ id: 'msg-1' }))
})

describe('token and module gate', () => {
  it('refuses an unknown token', async () => {
    sources.findByTokenHash.mockResolvedValue(ok(null))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'SD_MONITOR_TOKEN_INVALID',
    )
    expect(sources.findByTokenHash).toHaveBeenCalledWith(
      hashSdMonitorToken(token),
    )
    expect(engine.create).not.toHaveBeenCalled()
  })

  it('propagates the lookup error and the disabled module', async () => {
    sources.findByTokenHash.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'DATABASE_ERROR',
    )
    sources.findByTokenHash.mockResolvedValue(ok(createFakeSdMonitorSource()))
    vi.mocked(assertModuleEnabled).mockResolvedValue(
      err({ code: 'MODULE_DISABLED', message: 'off' }),
    )
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'MODULE_DISABLED',
    )
  })

  it('refuses a payload it cannot read', async () => {
    expectErr(
      await SdMonitorIngestService.ingest(token, { foo: 'bar' }),
      'SD_MONITOR_PAYLOAD_INVALID',
    )
    expectErr(
      await SdMonitorIngestService.ingest(token, 'nope'),
      'SD_MONITOR_PAYLOAD_INVALID',
    )
  })

  it('propagates a failure of the engine config and of the alert lookup', async () => {
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'DATABASE_ERROR',
    )
    engine.loadConfig.mockResolvedValue(ok(CONFIG))
    alerts.findByExternalId.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'DATABASE_ERROR',
    )
  })
})

describe('PROBLEM', () => {
  it('opens the ticket with the source defaults and links the CI by host', async () => {
    engine.create.mockResolvedValue(
      ok(
        ticket({
          requesterId: 'u-solicitante',
          participants: [
            {
              userId: 'u-participante',
              user: createFakeSdUserSummary({ id: 'u-participante' }),
            },
          ],
        }),
      ),
    )
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('ticket_created')
    expect(publishSdTicketEvent).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ type: 'ticket.updated', ticketId: 't1' }),
      {
        requesterId: 'u-solicitante',
        participantIds: ['u-participante'],
        contactUserId: null,
      },
    )
    expect(result.ticketCode).toBe('INC-000042')

    const [workspaceId, input, actor] = engine.create.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(actor).toEqual({ kind: 'system', source: 'monitor' })
    expect(input).toMatchObject({
      type: 'INCIDENT',
      title: 'Sem resposta do agente no SRV-01',
      channel: 'API',
      configItemId: 'ci-1',
    })
    expect(input.description).toContain('SRV-01')

    expect(alerts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        sourceId: 'src-1',
        externalId: '31415',
        status: 'OPEN',
        ticketId: 't1',
        configItemId: 'ci-1',
        severity: 'Disaster',
      }),
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'monitor.alert_opened',
        actorKind: 'SYSTEM',
      }),
    )
    expect(fireSdAutomations).toHaveBeenCalledWith('TICKET_CREATED', 't1')
    expect(sources.touchLastEvent).toHaveBeenCalledWith(
      'src-1',
      expect.any(Date),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'sd_monitor_alert', action: 'alert' }),
    )
  })

  it('maps the severity to the configured priority', async () => {
    sources.findByTokenHash.mockResolvedValue(
      ok(
        createFakeSdMonitorSource({
          severityMap: [{ from: 'disaster', priorityId: 'p-critica' }],
          departmentId: 'dep-1',
          customerId: 'cus-1',
          categoryId: 'cat-1',
          ticketType: 'PROBLEM',
        }),
      ),
    )
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(engine.create.mock.calls[0][1]).toMatchObject({
      priorityId: 'p-critica',
      departmentId: 'dep-1',
      customerId: 'cus-1',
      categoryId: 'cat-1',
      type: 'PROBLEM',
    })
  })

  it('reopens the ticket without the catalog when the category does not fit', async () => {
    sources.findByTokenHash.mockResolvedValue(
      ok(createFakeSdMonitorSource({ categoryId: 'cat-1' })),
    )
    engine.create
      .mockResolvedValueOnce(
        err({ code: 'SD_CATEGORY_NOT_FOUND', message: 'x' }),
      )
      .mockResolvedValueOnce(ok(ticket()))
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(engine.create).toHaveBeenCalledTimes(2)
    expect(engine.create.mock.calls[1][1]).not.toHaveProperty('categoryId')
  })

  it('gives up and audits when the engine refuses the ticket', async () => {
    engine.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'DATABASE_ERROR',
    )
    expect(alerts.create).not.toHaveBeenCalled()
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'DATABASE_ERROR' }),
    )
  })

  it('opens the ticket without a CI when no host matches', async () => {
    alerts.findConfigItemByHosts.mockResolvedValue(ok(null))
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(engine.create.mock.calls[0][1].configItemId).toBeUndefined()

    alerts.findConfigItemByHosts.mockResolvedValue(err(databaseError()))
    expectOk(await SdMonitorIngestService.ingest(token, problem))

    // Alerta sem host nem consulta o CMDB.
    alerts.findConfigItemByHosts.mockClear()
    expectOk(
      await SdMonitorIngestService.ingest(token, {
        externalId: 'sem-host',
        subject: 'Falha genérica',
      }),
    )
    expect(alerts.findConfigItemByHosts).not.toHaveBeenCalled()
  })

  it('deduplicates: the same alert again only updates the row', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, {
        ...problem,
        eventSeverity: 'High',
      }),
    )
    expect(result.outcome).toBe('alert_updated')
    expect(engine.create).not.toHaveBeenCalled()
    expect(alerts.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ severity: 'High' }),
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'monitor.alert_repeated' }),
    )
  })

  it('does not trace a repeated alert that never opened a ticket', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: null })),
    )
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(recordSdTicketEvent).not.toHaveBeenCalled()
  })

  it('records an ignored alert without opening anything', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', status: 'IGNORED' })),
    )
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('alert_updated')
    expect(engine.create).not.toHaveBeenCalled()
  })

  it('propagates a failure of the alert write', async () => {
    alerts.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'DATABASE_ERROR',
    )
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1' })),
    )
    alerts.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'DATABASE_ERROR',
    )
  })
})

describe('flapping', () => {
  const resolvedAt = new Date(Date.now() - 5 * 60_000)

  function flapping(overrides = {}) {
    alerts.findByExternalId.mockResolvedValue(
      ok(
        createFakeSdMonitorAlert({
          id: 'a1',
          status: 'RESOLVED',
          resolvedAt,
          ticketId: 't1',
          ...overrides,
        }),
      ),
    )
  }

  it('reopens the previous ticket instead of opening a new one', async () => {
    flapping()
    tickets.findById.mockResolvedValue(
      ok(ticket({ phase: createFakeSdPhase({ category: 'RESOLVED' }) })),
    )
    alerts.findPhaseIdByCategory.mockResolvedValue(ok('phase-andamento'))
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('ticket_reopened')
    expect(engine.create).not.toHaveBeenCalled()
    expect(engine.changePhase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      'phase-andamento',
      { kind: 'system', source: 'monitor' },
      CONFIG,
      expect.objectContaining({ reason: 'monitor.flapping' }),
    )
    expect(alerts.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ status: 'OPEN', resolvedAt: null }),
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'monitor.alert_reopened' }),
    )
    expect(automation.insertSystemMessage).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'PUBLIC' }),
    )
  })

  it('only posts a note when the previous ticket is still open', async () => {
    flapping()
    tickets.findById.mockResolvedValue(
      ok(ticket({ phase: createFakeSdPhase({ category: 'IN_PROGRESS' }) })),
    )
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('ticket_reopened')
    expect(engine.changePhase).not.toHaveBeenCalled()
    expect(automation.insertSystemMessage).toHaveBeenCalled()
  })

  it('falls back to the NEW phase and explains a refused transition', async () => {
    flapping()
    tickets.findById.mockResolvedValue(
      ok(ticket({ phase: createFakeSdPhase({ category: 'CLOSED' }) })),
    )
    alerts.findPhaseIdByCategory
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok('phase-nova'))
    engine.changePhase.mockResolvedValue(
      err({ code: 'SD_PHASE_TRANSITION_NOT_ALLOWED', message: 'proibido' }),
    )
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(engine.changePhase).toHaveBeenCalledWith(
      expect.anything(),
      'phase-nova',
      expect.anything(),
      CONFIG,
      expect.anything(),
    )
    expect(automation.insertSystemMessage.mock.calls[0][0].body).toContain(
      'proibido',
    )
  })

  it('just notes it when the type has no open phase at all', async () => {
    flapping()
    tickets.findById.mockResolvedValue(
      ok(ticket({ phase: createFakeSdPhase({ category: 'CLOSED' }) })),
    )
    alerts.findPhaseIdByCategory.mockResolvedValue(ok(null))
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(engine.changePhase).not.toHaveBeenCalled()
    expect(automation.insertSystemMessage).toHaveBeenCalled()
  })

  it('opens a new ticket outside the window and with the window off', async () => {
    flapping({ resolvedAt: new Date(Date.now() - 120 * 60_000) })
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(engine.create).toHaveBeenCalledTimes(1)
    expect(alerts.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ status: 'OPEN', ticketId: 't1' }),
    )

    engine.create.mockClear()
    sources.findByTokenHash.mockResolvedValue(
      ok(createFakeSdMonitorSource({ flappingWindowMinutes: 0 })),
    )
    flapping()
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(engine.create).toHaveBeenCalledTimes(1)
  })

  it('opens a new ticket when the previous one is gone', async () => {
    flapping()
    tickets.findById.mockResolvedValue(err(sdTicketNotFound()))
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('ticket_created')
    expect(engine.create).toHaveBeenCalledTimes(1)
  })

  it('opens a new ticket when the resolved alert had none', async () => {
    flapping({ ticketId: null })
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(engine.create).toHaveBeenCalledTimes(1)
  })

  it('propagates a failure of the reopen write', async () => {
    flapping()
    tickets.findById.mockResolvedValue(
      ok(ticket({ phase: createFakeSdPhase({ category: 'IN_PROGRESS' }) })),
    )
    alerts.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'DATABASE_ERROR',
    )
  })

  it('logs but survives a failed system message', async () => {
    flapping()
    tickets.findById.mockResolvedValue(
      ok(ticket({ phase: createFakeSdPhase({ category: 'IN_PROGRESS' }) })),
    )
    automation.insertSystemMessage.mockResolvedValue(err(databaseError()))
    expectOk(await SdMonitorIngestService.ingest(token, problem))
  })
})

describe('OK / RESOLVED', () => {
  it('resolves the ticket through the engine when autoResolve is on', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    tickets.findById.mockResolvedValue(ok(ticket()))
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('ticket_resolved')
    expect(engine.changePhase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      'phase-resolved',
      { kind: 'system', source: 'monitor' },
      CONFIG,
      expect.objectContaining({ reason: 'monitor.auto_resolve' }),
    )
    expect(alerts.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        status: 'RESOLVED',
        resolvedAt: expect.any(Date),
      }),
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'monitor.alert_resolved',
        meta: expect.objectContaining({ autoResolved: true }),
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'resolve' }),
    )
  })

  it('posts a public message when the phase refuses the automatic close', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    tickets.findById.mockResolvedValue(ok(ticket()))
    engine.changePhase.mockResolvedValue(
      err(sdPhaseRequirementsUnmet('Informe a classificação da solução')),
    )
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('alert_resolved')
    expect(automation.insertSystemMessage.mock.calls[0][0].body).toContain(
      'Informe a classificação da solução',
    )
  })

  it('explains it when the type has no resolved phase', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    tickets.findById.mockResolvedValue(ok(ticket()))
    alerts.findPhaseIdByCategory.mockResolvedValue(ok(null))
    expectOk(await SdMonitorIngestService.ingest(token, recovery))
    expect(engine.changePhase).not.toHaveBeenCalled()
    expect(automation.insertSystemMessage.mock.calls[0][0].body).toContain(
      'fase de resolução ativa',
    )
  })

  it('only warns on the ticket when autoResolve is off', async () => {
    sources.findByTokenHash.mockResolvedValue(
      ok(createFakeSdMonitorSource({ autoResolve: false })),
    )
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    tickets.findById.mockResolvedValue(ok(ticket()))
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('alert_resolved')
    expect(engine.changePhase).not.toHaveBeenCalled()
    expect(automation.insertSystemMessage.mock.calls[0][0].body).toContain(
      'normalizou',
    )
  })

  it('stays quiet when the alert was already resolved', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(
        createFakeSdMonitorAlert({
          id: 'a1',
          ticketId: 't1',
          status: 'RESOLVED',
        }),
      ),
    )
    tickets.findById.mockResolvedValue(ok(ticket()))
    expectOk(await SdMonitorIngestService.ingest(token, recovery))
    expect(engine.changePhase).not.toHaveBeenCalled()
    expect(automation.insertSystemMessage).not.toHaveBeenCalled()
  })

  it('records a recovery that never arrived as a problem', async () => {
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('alert_resolved')
    expect(result.ticketCode).toBeNull()
    expect(engine.create).not.toHaveBeenCalled()
    expect(alerts.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'RESOLVED', configItemId: 'ci-1' }),
    )
  })

  it('closes an alert that has no ticket at all', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: null })),
    )
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('alert_resolved')
    expect(tickets.findById).not.toHaveBeenCalled()
  })

  it('closes the alert even when the ticket is gone', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    tickets.findById.mockResolvedValue(err(sdTicketNotFound()))
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('alert_resolved')
  })

  it('propagates a failure of the resolution write', async () => {
    alerts.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, recovery),
      'DATABASE_ERROR',
    )
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1' })),
    )
    alerts.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, recovery),
      'DATABASE_ERROR',
    )
  })
})

describe('on-call notice', () => {
  const onCall = vi.mocked(sdOnCallEscalationTarget)
  const notify = vi.mocked(notifySdEvent)
  const target = (userId: string | null) =>
    ok({
      scheduleId: 'sch-1',
      scheduleName: 'Redes',
      slot: userId
        ? {
            layerId: 'l1',
            layerName: 'N1',
            level: 1,
            userId,
            source: 'rotation' as const,
            overrideId: null,
            periodStart: new Date(),
            periodEnd: new Date(),
          }
        : null,
      resolution: {} as never,
    })

  beforeEach(() => {
    onCall.mockReset()
    notify.mockReset()
    onCall.mockResolvedValue(target('plantonista'))
    notify.mockResolvedValue(ok({}) as never)
  })

  it('tells whoever is on call when an alert opens a ticket', async () => {
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('ticket_created')
    expect(onCall).toHaveBeenCalledWith(
      WS,
      ticket().departmentId,
      expect.any(Date),
      1,
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        event: 'monitor.alert',
        audience: 'payload',
        payload: expect.objectContaining({
          title: 'Alerta do monitoramento abriu INC-000042',
          body: 'Sem resposta do agente no SRV-01 (SRV-01)',
          userIds: ['plantonista'],
        }),
      }),
    )
  })

  it('says the alert came back when it reopens the ticket', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(
        createFakeSdMonitorAlert({
          id: 'a1',
          status: 'RESOLVED',
          resolvedAt: new Date(Date.now() - 60_000),
          ticketId: 't1',
        }),
      ),
    )
    tickets.findById.mockResolvedValue(
      ok(ticket({ phase: createFakeSdPhase({ category: 'RESOLVED' }) })),
    )
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, {
        ...problem,
        hostName: undefined,
      }),
    )
    expect(result.outcome).toBe('ticket_reopened')
    expect(notify.mock.calls[0][0].payload).toMatchObject({
      title: 'Alerta voltou e reabriu INC-000042',
      body: 'Sem resposta do agente no SRV-01',
    })
  })

  it('stays quiet when nobody is on call', async () => {
    onCall.mockResolvedValue(target(null))
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    onCall.mockResolvedValue(ok(null))
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(notify).not.toHaveBeenCalled()
  })

  it('never notifies for a repeated or resolved alert', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', status: 'OPEN' })),
    )
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expectOk(await SdMonitorIngestService.ingest(token, recovery))
    expect(onCall).not.toHaveBeenCalled()
  })

  it('keeps the ingestion when the on-call lookup or the delivery fails', async () => {
    onCall.mockResolvedValue(err(databaseError()))
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(notify).not.toHaveBeenCalled()

    onCall.mockResolvedValue(target('plantonista'))
    notify.mockResolvedValue(err(databaseError()))
    expectOk(await SdMonitorIngestService.ingest(token, problem))
  })
})

describe('deduplication counters', () => {
  it('counts the repetitions of an open alert and of an ignored one', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(alerts.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        occurrences: { increment: 1 },
        lastSeenAt: expect.any(Date),
      }),
    )

    alerts.update.mockClear()
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a2', status: 'IGNORED' })),
    )
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(alerts.update).toHaveBeenCalledWith(
      'a2',
      expect.objectContaining({ occurrences: { increment: 1 } }),
    )
  })

  it('stores the correlation key from the matched CI', async () => {
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(alerts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationKey: 'ci:ci-1',
        correlated: false,
        occurrences: 1,
      }),
    )
  })

  it('falls back to the host name for the key when the CI does not match', async () => {
    alerts.findConfigItemByHosts.mockResolvedValue(ok(null))
    expectOk(
      await SdMonitorIngestService.ingest(token, {
        ...problem,
        hostName: 'SRV-01.lan',
      }),
    )
    expect(alerts.create).toHaveBeenCalledWith(
      expect.objectContaining({ correlationKey: 'host:srv-01' }),
    )
  })

  it('passes every name of the machine to the CMDB lookup', async () => {
    expectOk(
      await SdMonitorIngestService.ingest(token, {
        ...problem,
        hostIp: '10.0.0.5',
      }),
    )
    expect(alerts.findConfigItemByHosts).toHaveBeenCalledWith(WS, [
      'SRV-01',
      '10.0.0.5',
    ])
  })
})

describe('correlation', () => {
  const root = () =>
    createFakeSdMonitorAlert({
      id: 'root',
      ticketId: 't1',
      correlationKey: 'ci:ci-1',
      externalId: 'cpu-1',
    })

  beforeEach(() => {
    alerts.findCorrelationTarget.mockResolvedValue(ok(root()))
    tickets.findById.mockResolvedValue(ok(ticket()))
  })

  it('attaches a new alert of the same machine to the open ticket', async () => {
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('alert_correlated')
    expect(engine.create).not.toHaveBeenCalled()
    expect(fireSdAutomations).not.toHaveBeenCalled()
    expect(alerts.findCorrelationTarget).toHaveBeenCalledWith(
      WS,
      'ci:ci-1',
      expect.any(Date),
    )
    expect(alerts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't1',
        correlated: true,
        status: 'OPEN',
      }),
    )
    const message = automation.insertSystemMessage.mock.calls[0][0]
    expect(message.visibility).toBe('INTERNAL')
    expect(message.body).toContain('Sem resposta do agente no SRV-01')
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'monitor.alert_correlated',
        meta: expect.objectContaining({ rootAlertId: 'root' }),
      }),
    )
    expect(publishSdTicketEvent).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ type: 'ticket.updated' }),
      expect.anything(),
    )
    expect(onCallMock()).not.toHaveBeenCalled()
  })

  it('uses the configured window to bound the lookup', async () => {
    sources.findByTokenHash.mockResolvedValue(
      ok(createFakeSdMonitorSource({ correlationWindowMinutes: 10 })),
    )
    const before = Date.now()
    expectOk(await SdMonitorIngestService.ingest(token, problem))
    const since = alerts.findCorrelationTarget.mock.calls[0][2]
    expect(before - since.getTime()).toBeGreaterThanOrEqual(10 * 60_000 - 1000)
    expect(before - since.getTime()).toBeLessThan(11 * 60_000)
  })

  it('reuses the row of a resolved alert that comes back outside the flapping window', async () => {
    alerts.findByExternalId.mockResolvedValue(
      ok(
        createFakeSdMonitorAlert({
          id: 'old',
          status: 'RESOLVED',
          ticketId: 't-old',
          resolvedAt: new Date('2020-01-01T00:00:00Z'),
        }),
      ),
    )
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('alert_correlated')
    expect(alerts.update).toHaveBeenCalledWith(
      'old',
      expect.objectContaining({
        ticketId: 't1',
        correlated: true,
        status: 'OPEN',
      }),
    )
    expect(alerts.create).not.toHaveBeenCalled()
  })

  it('does not correlate when the source turned it off', async () => {
    sources.findByTokenHash.mockResolvedValue(
      ok(createFakeSdMonitorSource({ correlationMode: 'OFF' })),
    )
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('ticket_created')
    expect(alerts.findCorrelationTarget).not.toHaveBeenCalled()
  })

  it('does not correlate an alert that does not say which machine it came from', async () => {
    alerts.findConfigItemByHosts.mockClear()
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, {
        externalId: 'x1',
        status: 'PROBLEM',
        subject: 'Fila cheia',
      }),
    )
    expect(result.outcome).toBe('ticket_created')
    expect(alerts.findConfigItemByHosts).not.toHaveBeenCalled()
    expect(alerts.findCorrelationTarget).not.toHaveBeenCalled()
  })

  it('opens its own ticket when nothing is open for the machine', async () => {
    alerts.findCorrelationTarget.mockResolvedValue(ok(null))
    const result = expectOk(await SdMonitorIngestService.ingest(token, problem))
    expect(result.outcome).toBe('ticket_created')
  })

  it('opens its own ticket when the lookup fails or the root ticket is gone', async () => {
    alerts.findCorrelationTarget.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await SdMonitorIngestService.ingest(token, problem)).outcome,
    ).toBe('ticket_created')

    alerts.findCorrelationTarget.mockResolvedValue(ok(root()))
    tickets.findById.mockResolvedValue(err(sdTicketNotFound()))
    expect(
      expectOk(await SdMonitorIngestService.ingest(token, problem)).outcome,
    ).toBe('ticket_created')
  })

  it('propagates a failure of the alert write', async () => {
    alerts.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, problem),
      'DATABASE_ERROR',
    )
  })
})

function onCallMock() {
  return vi.mocked(sdOnCallEscalationTarget)
}

describe('resolving with correlated alerts', () => {
  beforeEach(() => {
    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    tickets.findById.mockResolvedValue(ok(ticket()))
  })

  it('keeps the ticket open while other alerts are still open', async () => {
    alerts.countOpenByTicket.mockResolvedValue(ok(2))
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('alert_resolved')
    expect(engine.changePhase).not.toHaveBeenCalled()
    expect(alerts.countOpenByTicket).toHaveBeenCalledWith('t1', 'a1')
    const message = automation.insertSystemMessage.mock.calls[0][0]
    expect(message.visibility).toBe('INTERNAL')
    expect(message.body).toContain('2 alertas seguem abertos')
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'monitor.alert_resolved',
        meta: expect.objectContaining({ autoResolved: false }),
      }),
    )
  })

  it('uses the singular for a single remaining alert', async () => {
    alerts.countOpenByTicket.mockResolvedValue(ok(1))
    expectOk(await SdMonitorIngestService.ingest(token, recovery))
    expect(automation.insertSystemMessage.mock.calls[0][0].body).toContain(
      '1 alerta segue aberto',
    )
  })

  it('does not close the ticket when it cannot count the open alerts', async () => {
    alerts.countOpenByTicket.mockResolvedValue(err(databaseError()))
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('alert_resolved')
    expect(engine.changePhase).not.toHaveBeenCalled()
    expect(automation.insertSystemMessage.mock.calls[0][0].body).toContain(
      'ainda há alertas abertos',
    )
  })

  it('closes the ticket together with the last alert', async () => {
    alerts.countOpenByTicket.mockResolvedValue(ok(0))
    const result = expectOk(
      await SdMonitorIngestService.ingest(token, recovery),
    )
    expect(result.outcome).toBe('ticket_resolved')
  })
})

describe('batches (Grafana / Alertmanager)', () => {
  const grafana = {
    status: 'firing',
    alerts: [
      {
        status: 'firing',
        fingerprint: 'fp-1',
        labels: { alertname: 'CPU alta', host: 'srv-01', severity: 'critical' },
        annotations: { summary: 'CPU acima de 90%' },
      },
      {
        status: 'firing',
        fingerprint: 'fp-2',
        labels: { alertname: 'Disco cheio', host: 'srv-01' },
        annotations: { summary: 'Disco em 95%' },
      },
    ],
  }

  beforeEach(() => {
    sources.findByTokenHash.mockResolvedValue(
      ok(createFakeSdMonitorSource({ kind: 'GRAFANA' })),
    )
  })

  it('processes every alert in order and returns them all', async () => {
    const result = expectOk(await SdMonitorIngestService.ingest(token, grafana))
    expect(result.results).toHaveLength(2)
    expect(result.outcome).toBe('ticket_created')
    expect(alerts.findByExternalId.mock.calls.map((c) => c[1])).toEqual([
      'fp-1',
      'fp-2',
    ])
    expect(sources.touchLastEvent).toHaveBeenCalledTimes(1)
  })

  it('stores only the alert that originated each row', async () => {
    expectOk(await SdMonitorIngestService.ingest(token, grafana))
    const payloads = alerts.create.mock.calls.map((c) => c[0].payload)
    expect(payloads[0]).toMatchObject({ fingerprint: 'fp-1' })
    expect(payloads[1]).toMatchObject({ fingerprint: 'fp-2' })
  })

  it('stops at the first failure so the sender can retry safely', async () => {
    engine.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdMonitorIngestService.ingest(token, grafana),
      'DATABASE_ERROR',
    )
    expect(engine.create).toHaveBeenCalledTimes(1)
    expect(sources.touchLastEvent).not.toHaveBeenCalled()
  })

  it('refuses a batch without a readable alert', async () => {
    expectErr(
      await SdMonitorIngestService.ingest(token, { alerts: [] }),
      'SD_MONITOR_PAYLOAD_INVALID',
    )
  })

  it('reads a PRTG sensor and resolves on Up', async () => {
    sources.findByTokenHash.mockResolvedValue(
      ok(createFakeSdMonitorSource({ kind: 'PRTG' })),
    )
    const down = {
      sensorId: '2001',
      device: 'SRV-01',
      sensor: 'Ping',
      status: 'Down',
      message: 'Timeout',
    }
    const result = expectOk(await SdMonitorIngestService.ingest(token, down))
    expect(result.outcome).toBe('ticket_created')
    expect(engine.create.mock.calls[0][1].title).toBe('Ping em SRV-01')
    expect(alerts.findByExternalId).toHaveBeenCalledWith('src-1', 'sensor-2001')

    alerts.findByExternalId.mockResolvedValue(
      ok(createFakeSdMonitorAlert({ id: 'a1', ticketId: 't1' })),
    )
    tickets.findById.mockResolvedValue(ok(ticket()))
    const up = expectOk(
      await SdMonitorIngestService.ingest(token, { ...down, status: 'Up' }),
    )
    expect(up.outcome).toBe('ticket_resolved')
  })
})
