import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/ai-insight.repository')
vi.mock('@/src/repositories/ai-proactive-signal.repository')
vi.mock('@/src/repositories/crm-sales-metrics.repository')
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('../authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock('../sd-access', () => ({ SdAccess: { resolve: vi.fn() } }))
vi.mock('../crm-sales-metrics.service', () => ({
  CrmSalesMetricsService: { compute: vi.fn() },
}))
vi.mock('../steel-agent-dispatcher', () => ({
  dispatchSteelAgentEvent: vi.fn(),
}))
vi.mock('../whatsapp-conversation-scope.service', () => ({
  loadWhatsAppTeamSnapshot: vi.fn(),
}))

import { AiInsightRepository } from '@/src/repositories/ai-insight.repository'
import {
  AiProactiveSignalRepository,
  type ProactiveWorkspaceRow,
} from '@/src/repositories/ai-proactive-signal.repository'
import { CrmSalesMetricsRepository } from '@/src/repositories/crm-sales-metrics.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { AiInsightGeneratorService } from '../ai-insight-generator.service'
import { assertModuleMember } from '../authz'
import { CrmSalesMetricsService } from '../crm-sales-metrics.service'
import { SdAccess } from '../sd-access'
import { dispatchSteelAgentEvent } from '../steel-agent-dispatcher'
import { loadWhatsAppTeamSnapshot } from '../whatsapp-conversation-scope.service'

const insights = vi.mocked(AiInsightRepository)
const signals = vi.mocked(AiProactiveSignalRepository)
const crmRepo = vi.mocked(CrmSalesMetricsRepository)
const sdContext = vi.mocked(SdTicketContextRepository)
const moduleMember = vi.mocked(assertModuleMember)
const sdAccess = vi.mocked(SdAccess.resolve)
const compute = vi.mocked(CrmSalesMetricsService.compute)
const dispatch = vi.mocked(dispatchSteelAgentEvent)
const snapshot = vi.mocked(loadWhatsAppTeamSnapshot)

const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'down' }
const NOW = new Date('2026-10-18T15:00:00.000Z')
const MIN = 60_000
const DAY = 86_400_000

function workspace(
  overrides: Partial<ProactiveWorkspaceRow> = {},
): ProactiveWorkspaceRow {
  return {
    id: 'ws1',
    slug: 'acme',
    name: 'Acme',
    aiEnabled: true,
    proactiveEnabled: true,
    modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
    ...overrides,
  }
}

const MEMBERS = [
  { userId: 'admin', name: 'Ana', email: 'ana@x.com', timeZone: null },
  { userId: 'agent', name: 'Bia', email: 'bia@x.com', timeZone: null },
]

function sdContextFor(agentIds: string[], adminIds: string[]) {
  sdAccess.mockImplementation(async (userId) =>
    ok({
      userId,
      role: 'MEMBER',
      isPrivileged: false,
      permissions: null,
      isAdmin: adminIds.includes(userId),
      isAgent: agentIds.includes(userId) || adminIds.includes(userId),
      departmentIds: [],
      leadDepartmentIds: [],
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  insights.deleteResolvedBefore.mockResolvedValue(ok(0))
  insights.resolveAllActive.mockResolvedValue(ok(0))
  insights.listForReconcile.mockResolvedValue(ok([]))
  insights.applyPlan.mockImplementation(async (_ws, plan) =>
    ok({
      created: plan.create.length,
      refreshed: plan.refresh.length,
      reopened: plan.reopen.length,
      resolved: plan.resolveIds.length,
    }),
  )
  signals.listWorkspaces.mockResolvedValue(ok([workspace()]))
  signals.listMembers.mockResolvedValue(ok(MEMBERS))
  signals.sdBreachForecast.mockResolvedValue(ok([]))
  signals.zapWaiting.mockResolvedValue(ok([]))
  signals.zapNegative.mockResolvedValue(ok([]))
  signals.zapSentimentRule.mockResolvedValue(
    ok({ enabled: true, threshold: -0.3 }),
  )
  crmRepo.listOpen.mockResolvedValue(ok([]))
  crmRepo.lastActivityByOpportunity.mockResolvedValue(ok(new Map()))
  compute.mockResolvedValue(err(DB_ERROR))
  sdContext.findDefaultCalendar.mockResolvedValue(ok(null))
  sdContext.ensureSettings.mockResolvedValue(
    ok(createFakeSdSettings({ workspaceId: 'ws1' })),
  )
  sdContextFor(['agent'], ['admin'])
  moduleMember.mockImplementation(async (userId) =>
    ok({
      role: userId === 'admin' ? 'ADMIN' : 'MEMBER',
      isPrivileged: userId === 'admin',
      permissions: null,
    }),
  )
  snapshot.mockResolvedValue(ok([]))
  dispatch.mockResolvedValue(1)
})

function lastPlan() {
  const call = insights.applyPlan.mock.calls.at(-1)
  if (!call) throw new Error('applyPlan was not called')
  return call[1]
}

describe('AiInsightGeneratorService.runTick', () => {
  it('builds every module, reconciles and fires agent events per condition', async () => {
    signals.sdBreachForecast.mockResolvedValue(
      ok([
        {
          ticketId: 't1',
          number: 7,
          type: 'INCIDENT',
          title: 'VPN caiu',
          departmentId: 'd1',
          departmentName: 'N1',
          assigneeId: 'agent',
          breachEtaAt: new Date(NOW.getTime() + 30 * MIN),
          score: 90,
        },
      ]),
    )
    crmRepo.listOpen.mockResolvedValue(
      ok([
        {
          id: 'o1',
          name: 'Renovação',
          amount: new Prisma.Decimal(500),
          probability: null,
          closeDate: null,
          updatedAt: new Date(NOW.getTime() - 20 * DAY),
          pipelineId: 'p1',
          stage: {
            id: 's1',
            name: 'Proposta',
            probability: 50,
            color: null,
            position: 1,
          },
          owner: { id: 'agent', name: 'Bia', image: null },
          company: null,
        },
      ]),
    )
    compute.mockResolvedValue(
      ok({
        kind: 'forecast',
        period: {
          key: '2026-10',
          label: 'outubro de 2026',
          fromDay: '2026-10-01',
          toDay: '2026-10-31',
          endsAt: '2026-11-01T03:00:00.000Z',
          timeZone: 'America/Sao_Paulo',
        },
        wonAmount: 0,
        commitAmount: 0,
        bestCaseAmount: 0,
        weightedAmount: 1000,
        targetAmount: 10_000,
        openCount: 1,
      }),
    )
    signals.zapWaiting.mockResolvedValue(
      ok([
        {
          id: 'c1',
          assignedUserId: null,
          teamId: null,
          avgSentimentScore: null,
          lastMessageAt: new Date(NOW.getTime() - 40 * MIN),
          createdAt: new Date(NOW.getTime() - DAY),
          contactName: 'Maria',
        },
      ]),
    )

    const result = await AiInsightGeneratorService.runTick(NOW)

    const keys = lastPlan().create.map((d) => `${d.userId}:${d.dedupeKey}`)
    expect(keys).toEqual([
      'admin:sd-breach:dept:d1',
      'agent:sd-breach:assignee:agent',
      'admin:crm-stale:all',
      'admin:crm-forecast:2026-10',
      'agent:crm-stale:owner:agent',
      'admin:zap-waiting:queue',
      'agent:zap-waiting:queue',
    ])
    expect(lastPlan().create[1].title).toBe(
      'O chamado INC-000007 deve estourar o SLA às 12:30',
    )
    expect(result).toMatchObject({
      workspaces: 1,
      evaluated: 1,
      created: 7,
      errors: 0,
      events: 3,
    })
    expect(dispatch).toHaveBeenCalledWith(
      'ws1',
      'sd.insight.detected',
      expect.objectContaining({
        insightKind: 'SD_SLA_BREACH_FORECAST',
        dedupeKey: 'sd-breach:dept:d1',
      }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      'ws1',
      'crm.insight.detected',
      expect.objectContaining({ dedupeKey: 'crm-forecast:2026-10' }),
    )
    expect(insights.deleteResolvedBefore).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 30 * DAY),
    )
  })

  it('resolves the insights of a workspace that turned the proactive AI off', async () => {
    signals.listWorkspaces.mockResolvedValue(
      ok([
        workspace({ proactiveEnabled: false }),
        workspace({ id: 'ws2', aiEnabled: false }),
      ]),
    )
    insights.resolveAllActive.mockResolvedValue(ok(2))

    const result = await AiInsightGeneratorService.runTick(NOW)

    expect(result).toMatchObject({ disabled: 2, resolved: 4, evaluated: 0 })
    expect(insights.resolveAllActive).toHaveBeenCalledWith('ws1', NOW)
    expect(insights.resolveAllActive).toHaveBeenCalledWith('ws2', NOW)
    expect(signals.listMembers).not.toHaveBeenCalled()

    insights.resolveAllActive.mockResolvedValue(err(DB_ERROR))
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(2)
  })

  it('resolves a disabled module but never touches a module that failed', async () => {
    signals.listWorkspaces.mockResolvedValue(
      ok([workspace({ modules: ['SERVICE_DESK', 'CRM'] })]),
    )
    signals.sdBreachForecast.mockResolvedValue(err(DB_ERROR))
    insights.listForReconcile.mockResolvedValue(
      ok([
        {
          id: 'sd',
          userId: 'admin',
          dedupeKey: 'sd-breach:dept:d1',
          module: 'SERVICE_DESK',
          status: 'ACTIVE',
        },
        {
          id: 'zap',
          userId: 'admin',
          dedupeKey: 'zap-waiting:queue',
          module: 'COMMUNICATION',
          status: 'ACTIVE',
        },
      ]),
    )

    const result = await AiInsightGeneratorService.runTick(NOW)

    expect(lastPlan().resolveIds).toEqual(['zap'])
    expect(result.errors).toBe(1)
    expect(signals.zapWaiting).not.toHaveBeenCalled()
  })

  it('skips viewers without access and short-circuits empty modules', async () => {
    signals.sdBreachForecast.mockResolvedValue(
      ok([
        {
          ticketId: 't1',
          number: 7,
          type: 'INCIDENT',
          title: 'VPN caiu',
          departmentId: null,
          departmentName: null,
          assigneeId: 'agent',
          breachEtaAt: new Date(NOW.getTime() + 90 * MIN),
          score: 50,
        },
      ]),
    )
    // Requester (not an agent) and an access failure.
    sdAccess.mockImplementation(async (userId) =>
      userId === 'admin'
        ? err(forbidden())
        : ok({
            userId,
            role: 'MEMBER',
            isPrivileged: false,
            permissions: null,
            isAdmin: false,
            isAgent: false,
            departmentIds: [],
            leadDepartmentIds: [],
          }),
    )
    signals.zapSentimentRule.mockResolvedValue(
      ok({ enabled: false, threshold: -0.3 }),
    )

    await AiInsightGeneratorService.runTick(NOW)

    expect(lastPlan().create).toEqual([])
    // No CRM deal, no quota and no zap signal: nobody's access is resolved.
    expect(moduleMember).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(signals.zapNegative).not.toHaveBeenCalled()
  })

  it('filters CRM and Comunicação viewers by access', async () => {
    crmRepo.listOpen.mockResolvedValue(
      ok([
        {
          id: 'o1',
          name: 'Renovação',
          amount: null,
          probability: null,
          closeDate: null,
          updatedAt: new Date(NOW.getTime() - 20 * DAY),
          pipelineId: 'p1',
          stage: {
            id: 's1',
            name: 'Proposta',
            probability: 50,
            color: null,
            position: 1,
          },
          owner: null,
          company: null,
        },
      ]),
    )
    signals.zapNegative.mockResolvedValue(
      ok([
        {
          id: 'c9',
          assignedUserId: 'agent',
          teamId: null,
          avgSentimentScore: -0.9,
          lastMessageAt: NOW,
          createdAt: NOW,
          contactName: 'João',
        },
      ]),
    )
    moduleMember.mockImplementation(async (userId) =>
      userId === 'admin'
        ? ok({ role: 'ADMIN', isPrivileged: true, permissions: null })
        : err(forbidden()),
    )

    await AiInsightGeneratorService.runTick(NOW)

    expect(lastPlan().create.map((d) => `${d.userId}:${d.dedupeKey}`)).toEqual([
      'admin:crm-stale:all',
      'admin:zap-sentiment:c9',
    ])
    expect(dispatch).toHaveBeenCalledWith(
      'ws1',
      'zap.insight.detected',
      expect.objectContaining({ dedupeKey: 'zap-sentiment:c9' }),
    )
  })

  it('counts each module failure', async () => {
    crmRepo.listOpen.mockResolvedValue(err(DB_ERROR))
    signals.zapWaiting.mockResolvedValue(err(DB_ERROR))
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(2)

    crmRepo.listOpen.mockResolvedValue(ok([]))
    crmRepo.lastActivityByOpportunity.mockResolvedValue(err(DB_ERROR))
    signals.zapWaiting.mockResolvedValue(ok([]))
    signals.zapSentimentRule.mockResolvedValue(err(DB_ERROR))
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(2)

    crmRepo.lastActivityByOpportunity.mockResolvedValue(ok(new Map()))
    signals.zapSentimentRule.mockResolvedValue(
      ok({ enabled: true, threshold: -0.3 }),
    )
    signals.zapNegative.mockResolvedValue(err(DB_ERROR))
    signals.sdBreachForecast.mockResolvedValue(
      ok([
        {
          ticketId: 't1',
          number: 7,
          type: 'INCIDENT',
          title: 'VPN caiu',
          departmentId: null,
          departmentName: null,
          assigneeId: null,
          breachEtaAt: NOW,
          score: 50,
        },
      ]),
    )
    sdContext.findDefaultCalendar.mockResolvedValue(err(DB_ERROR))
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(2)

    sdContext.findDefaultCalendar.mockResolvedValue(ok(null))
    sdContext.ensureSettings.mockResolvedValue(err(DB_ERROR))
    signals.zapNegative.mockResolvedValue(
      ok([
        {
          id: 'c9',
          assignedUserId: null,
          teamId: null,
          avgSentimentScore: -0.9,
          lastMessageAt: NOW,
          createdAt: NOW,
          contactName: null,
        },
      ]),
    )
    snapshot.mockResolvedValue(err(DB_ERROR))
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(2)
  })

  it('survives workspace-level failures', async () => {
    insights.deleteResolvedBefore.mockResolvedValue(err(DB_ERROR))
    signals.listMembers.mockResolvedValue(err(DB_ERROR))
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(2)

    insights.deleteResolvedBefore.mockResolvedValue(ok(3))
    signals.listMembers.mockResolvedValue(ok(MEMBERS))
    insights.listForReconcile.mockResolvedValue(err(DB_ERROR))
    const reconcile = await AiInsightGeneratorService.runTick(NOW)
    expect(reconcile).toMatchObject({ errors: 1, pruned: 3 })

    insights.listForReconcile.mockResolvedValue(ok([]))
    insights.applyPlan.mockResolvedValue(err(DB_ERROR))
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(1)

    signals.listMembers.mockRejectedValue(new Error('boom'))
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(1)
    signals.listMembers.mockRejectedValue('boom')
    expect((await AiInsightGeneratorService.runTick(NOW)).errors).toBe(1)

    signals.listWorkspaces.mockResolvedValue(err(DB_ERROR))
    expect(await AiInsightGeneratorService.runTick(NOW)).toMatchObject({
      workspaces: 0,
      errors: 1,
    })
  })
})
