import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-dashboard-source.repository')
vi.mock('../authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { CrmDashboardSourceRepository } from '@/src/repositories/crm-dashboard-source.repository'
import {
  CRM_DASHBOARD_ROW_LIMITS,
  CRM_DASHBOARD_SOURCES,
} from '@/src/schemas/crm-dashboard-source.schema'
import { assertModuleMember } from '../authz'
import { CrmDashboardSourceService } from '../crm-dashboard-source.service'

const repo = vi.mocked(CrmDashboardSourceRepository)
const access = vi.mocked(assertModuleMember)
const WS = 'ws1'
const NOW = new Date('2026-10-10T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue(ok({} as never))
  repo.memberNames.mockResolvedValue(ok(new Map([['u1', 'Ana']])))
  repo.proposals.mockResolvedValue(ok([]))
  repo.contracts.mockResolvedValue(ok([]))
  repo.charges.mockResolvedValue(ok([]))
  repo.activities.mockResolvedValue(ok([]))
  repo.quotas.mockResolvedValue(ok([]))
  repo.customerHealth.mockResolvedValue(ok([]))
  repo.opportunityHealth.mockResolvedValue(ok([]))
  repo.campaigns.mockResolvedValue(ok({ multichannel: [], email: [] }))
  repo.campaignCounts.mockResolvedValue(ok([]))
  repo.emailCampaignCounts.mockResolvedValue(ok([]))
})

describe('CrmDashboardSourceService.rows', () => {
  it('requires CRM module access with dashboards:VIEW', async () => {
    access.mockResolvedValue(err(forbidden()))
    expectErr(
      await CrmDashboardSourceService.rows('u1', WS, 'crm-proposals', NOW),
      'FORBIDDEN',
    )
    expect(access).toHaveBeenCalledWith('u1', WS, 'CRM', {
      resource: 'dashboards',
      action: 'VIEW',
    })
    expect(repo.proposals).not.toHaveBeenCalled()
  })

  it('answers an empty list for every source without data', async () => {
    for (const source of CRM_DASHBOARD_SOURCES) {
      expect(
        expectOk(await CrmDashboardSourceService.rows('u1', WS, source, NOW)),
      ).toEqual([])
    }
  })

  it('scopes the window to the workspace and the row ceiling', async () => {
    await CrmDashboardSourceService.rows('u1', WS, 'crm-proposals', NOW)
    const [workspaceId, since, limit] = repo.proposals.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(limit).toBe(CRM_DASHBOARD_ROW_LIMITS['crm-proposals'])
    expect(since.getTime()).toBeLessThan(NOW.getTime() - 399 * 86_400_000)
  })

  it('propagates repository failures', async () => {
    repo.charges.mockResolvedValue(err(databaseError('boom')))
    expectErr(
      await CrmDashboardSourceService.rows('u1', WS, 'crm-charges', NOW),
      'DATABASE_ERROR',
    )
  })

  it('logs when a source hits its ceiling', async () => {
    const limit = CRM_DASHBOARD_ROW_LIMITS['crm-activities']
    repo.activities.mockResolvedValue(
      ok(
        Array.from({ length: limit }, (_, i) => ({
          id: `a${i}`,
          action: 'CREATED',
          entity: 'company',
          actorUserId: null,
          summary: null,
          createdAt: NOW,
          actor: null,
        })),
      ),
    )
    const rows = expectOk(
      await CrmDashboardSourceService.rows('u1', WS, 'crm-activities', NOW),
    )
    expect(rows).toHaveLength(limit)
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.dashboard.source_truncated',
      expect.objectContaining({ source: 'crm-activities' }),
    )
  })

  it('joins quotas with the deals won since the earliest period', async () => {
    repo.quotas.mockResolvedValue(
      ok([
        {
          id: 'q1',
          ownerId: 'u1',
          period: 'MONTH',
          periodKey: '2026-09',
          targetAmount: 1000 as never,
          owner: { name: 'Ana' },
        },
      ]),
    )
    repo.wonDeals.mockResolvedValue(
      ok([
        {
          ownerId: 'u1',
          amount: 400 as never,
          wonAt: new Date('2026-09-15T00:00:00.000Z'),
        },
      ]),
    )
    const rows = expectOk(
      await CrmDashboardSourceService.rows('u1', WS, 'crm-quotas', NOW),
    )
    expect(repo.wonDeals.mock.calls[0][1].toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
    expect(rows[0]).toMatchObject({ achieved: 400, attainmentPct: 40 })
  })

  it('serves customers and deals together in crm-health', async () => {
    repo.customerHealth.mockResolvedValue(
      ok([
        {
          id: 'h1',
          riskScore: 10,
          level: 'LOW',
          previousScore: null,
          previousLevel: null,
          nextAction: { label: 'Manter' },
          computedAt: NOW,
          company: { name: 'Acme', accountOwnerId: null },
        },
      ]),
    )
    repo.opportunityHealth.mockResolvedValue(
      ok([
        {
          id: 'h2',
          riskScore: 90,
          level: 'HIGH',
          previousScore: null,
          previousLevel: null,
          nextAction: { label: 'Ligar' },
          computedAt: NOW,
          opportunity: {
            name: 'Negócio',
            amount: 100 as never,
            ownerId: 'u1',
            company: null,
            stage: { name: 'Proposta' },
          },
        },
      ]),
    )
    const rows = expectOk(
      await CrmDashboardSourceService.rows('u1', WS, 'crm-health', NOW),
    ) as { kind: string; owner: string | null }[]
    expect(rows.map((r) => r.kind)).toEqual(['Cliente', 'Oportunidade'])
    expect(rows[1].owner).toBe('Ana')
  })
})
