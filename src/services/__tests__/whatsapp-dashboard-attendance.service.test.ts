import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeWaDashboardAttendance,
  createFakeWaDashboardEvent,
  createFakeWaDashboardSlaCycle,
  createFakeWaDashboardTeamMember,
} from '@/src/__tests__/factories/whatsapp-dashboard-attendance.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-dashboard-source.repository')
vi.mock('@/src/repositories/whatsapp-dashboard-attendance.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppDashboardAttendanceRepository } from '@/src/repositories/whatsapp-dashboard-attendance.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WA_DASHBOARD_ROW_LIMITS } from '@/src/schemas/whatsapp-dashboard.schema'
import { WhatsAppDashboardSourceService } from '../whatsapp-dashboard-source.service'

const repo = vi.mocked(WhatsAppDashboardAttendanceRepository)
const membership = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const WS = 'ws1'
const NOW = new Date('2026-11-18T12:00:00.000Z')
const SINCE_MS = NOW.getTime() - 400 * 86_400_000

beforeEach(() => {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'VIEWER' })),
  )
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WhatsAppDashboardSourceService.rows — whatsapp-attendances', () => {
  const SOURCE = 'whatsapp-attendances'

  it('should refuse who is not a member of the workspace', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE))
    expect(repo.attendances).not.toHaveBeenCalled()
  })

  it('should map the conversations over the history window', async () => {
    repo.attendances.mockResolvedValue(
      ok([
        {
          ...createFakeWaDashboardAttendance({ unreadCount: 2 }),
          avgResponseSeconds: null,
        },
      ]),
    )

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE, NOW),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'Em atendimento',
      isWaiting: true,
    })
    const [workspaceId, since, limit] = repo.attendances.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(since.getTime()).toBe(SINCE_MS)
    expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS[SOURCE])
  })

  it('should propagate a repository failure', async () => {
    repo.attendances.mockResolvedValue(err(databaseError('boom')))

    expectErr(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardSourceService.rows — whatsapp-conversation-events', () => {
  const SOURCE = 'whatsapp-conversation-events'

  it('should map the events over the history window', async () => {
    repo.conversationEvents.mockResolvedValue(
      ok([createFakeWaDashboardEvent({ kind: 'ASSIGNED', reason: 'Ana' })]),
    )

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE, NOW),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'Atribuição', reason: 'Ana' })
    const [workspaceId, since, limit] = repo.conversationEvents.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(since.getTime()).toBe(SINCE_MS)
    expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS[SOURCE])
  })

  it('should propagate a repository failure', async () => {
    repo.conversationEvents.mockResolvedValue(err(databaseError('boom')))

    expectErr(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardSourceService.rows — whatsapp-sla-cycles', () => {
  const SOURCE = 'whatsapp-sla-cycles'

  it('should read the running targets as of the current time', async () => {
    // The fake cycle is due at 12:15 and warns at 12:12 of 2026-11-17.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-17T12:13:00.000Z'))
    repo.slaCycleData.mockResolvedValue(
      ok({
        cycles: [createFakeWaDashboardSlaCycle({ policyId: 'p1' })],
        policies: [{ id: 'p1', teamId: null }],
        teams: [],
        agents: [],
      }),
    )

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE, NOW),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      policy: 'Padrão',
      firstResponseState: 'Em risco',
      slaAtRisk: true,
    })
    const [workspaceId, since, limit] = repo.slaCycleData.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(since.getTime()).toBe(SINCE_MS)
    expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS[SOURCE])
  })

  it('should propagate a repository failure', async () => {
    repo.slaCycleData.mockResolvedValue(err(databaseError('boom')))

    expectErr(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardSourceService.rows — whatsapp-team-members', () => {
  const SOURCE = 'whatsapp-team-members'

  function dataWith(count: number) {
    const member = createFakeWaDashboardTeamMember()
    return {
      members: Array.from({ length: count }, () => ({ ...member })),
      presences: [],
      openCounts: [],
    }
  }

  it('should map the current memberships without a history window', async () => {
    repo.teamMemberData.mockResolvedValue(ok(dataWith(1)))

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE, NOW),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      team: 'Retenção',
      attendant: 'Ana',
      presence: 'Disponível',
    })
    expect(repo.teamMemberData).toHaveBeenCalledWith(
      WS,
      WA_DASHBOARD_ROW_LIMITS[SOURCE],
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should log when the source hits the row limit', async () => {
    repo.teamMemberData.mockResolvedValue(
      ok(dataWith(WA_DASHBOARD_ROW_LIMITS[SOURCE])),
    )

    expectOk(await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE))

    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.dashboard.source_truncated',
      expect.objectContaining({ workspaceId: WS, source: SOURCE }),
    )
  })

  it('should propagate a repository failure', async () => {
    repo.teamMemberData.mockResolvedValue(err(databaseError('boom')))

    expectErr(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE),
      'DATABASE_ERROR',
    )
  })
})
