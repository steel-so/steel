import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeCrmCustomerHealth,
  createFakeCrmOpportunityHealth,
} from '@/src/__tests__/factories/nov-health-scores.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import type {
  CustomerHealthSignals,
  OpportunityHealthSignals,
} from '@/src/lib/crm-health'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/crm-health.repository')
vi.mock('@/src/repositories/crm-health-signals.repository')
vi.mock('../crm-notifications')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { CrmHealthRepository } from '@/src/repositories/crm-health.repository'
import { CrmHealthSignalsRepository } from '@/src/repositories/crm-health-signals.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmHealthService } from '../crm-health.service'
import {
  notifyCrmCustomerHealthDrop,
  notifyCrmOpportunityAtRisk,
} from '../crm-notifications'

const members = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const repo = vi.mocked(CrmHealthRepository)
const signalsRepo = vi.mocked(CrmHealthSignalsRepository)
const notifyCustomer = vi.mocked(notifyCrmCustomerHealthDrop)
const notifyDeal = vi.mocked(notifyCrmOpportunityAtRisk)
const audit = vi.mocked(auditMutation)

const now = new Date('2026-10-30T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const company = {
  id: 'c1',
  name: 'Acme',
  cnpj: null,
  accountOwnerId: 'owner1',
  createdAt: daysAgo(400),
}
const deal = {
  id: 'o1',
  name: 'Renovação',
  ownerId: 'rep1',
  companyId: 'c1',
  pointOfContactId: null,
  closeDate: daysAgo(40),
  createdAt: daysAgo(90),
  updatedAt: daysAgo(90),
  stageChangedAt: null,
  contactChangedAt: null,
  isOpen: true,
}

const silentCustomer: CustomerHealthSignals = {
  now,
  companyCreatedAt: daysAgo(400),
  crm: {
    lastInteractionAt: null,
    openDeals: 0,
    highRiskDeals: 0,
    mediumRiskDeals: 0,
    totalDeals: 0,
    lostDeals180d: 0,
    wonDeals180d: 0,
    overdueTasks: 0,
  },
  zap: null,
  sd: null,
}
const healthyCustomer: CustomerHealthSignals = {
  ...silentCustomer,
  crm: { ...silentCustomer.crm, lastInteractionAt: daysAgo(1) },
}
const stalledDeal: OpportunityHealthSignals = {
  now,
  createdAt: daysAgo(90),
  stageChangedAt: null,
  lastActivityAt: null,
  lastInteractionAt: null,
  closeDate: daysAgo(40),
  pointOfContactId: null,
  contactChangedAt: null,
  overdueTasks: 3,
  hasNextStep: false,
}

function upserted<T>(
  row: T,
  previous: [number | null, 'LOW' | 'MEDIUM' | 'HIGH' | null],
) {
  return ok({ row, previousScore: previous[0], previousLevel: previous[1] })
}

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  asRole('MEMBER')
  notifyCustomer.mockResolvedValue(1)
  notifyDeal.mockResolvedValue(1)
})

describe('authorization', () => {
  it('rejects non-members and a disabled CRM module', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await CrmHealthService.listCustomerHealth('u', 'ws', { limit: 5 }),
      'FORBIDDEN',
    )
    asRole('OWNER')
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(
      await CrmHealthService.listOpportunityHealth('u', 'ws', { limit: 5 }),
      'MODULE_DISABLED',
    )
  })

  it('lets a viewer read but not recompute', async () => {
    asRole('VIEWER')
    repo.listCustomerHealth.mockResolvedValue(ok([]))
    expect(
      expectOk(
        await CrmHealthService.listCustomerHealth('u', 'ws', { limit: 5 }),
      ),
    ).toEqual([])
    expectErr(
      await CrmHealthService.recomputeCustomerHealth('u', 'ws', 'c1'),
      'FORBIDDEN',
    )
    expectErr(
      await CrmHealthService.recomputeOpportunityHealth('u', 'ws', 'o1'),
      'FORBIDDEN',
    )
    expect(repo.upsertCustomerHealth).not.toHaveBeenCalled()
  })
})

describe('customer health', () => {
  it('returns the stored score with the company name', async () => {
    repo.findCompany.mockResolvedValue(ok(company))
    repo.getCustomerHealth.mockResolvedValue(
      ok(
        createFakeCrmCustomerHealth({
          companyId: 'c1',
          riskScore: 55,
          previousScore: 40,
        }),
      ),
    )
    const dto = expectOk(
      await CrmHealthService.getCustomerHealth('u', 'ws', 'c1'),
    )
    expect(dto).toMatchObject({
      companyName: 'Acme',
      healthScore: 45,
      riskDelta: 15,
    })
    expect(signalsRepo.customerSignals).not.toHaveBeenCalled()
  })

  it('computes on the first look, without alerting', async () => {
    repo.findCompany.mockResolvedValue(ok(company))
    repo.getCustomerHealth.mockResolvedValue(ok(null))
    signalsRepo.customerSignals.mockResolvedValue(ok(silentCustomer))
    repo.upsertCustomerHealth.mockImplementation(
      async (workspaceId, companyId, computation) =>
        upserted(
          createFakeCrmCustomerHealth({
            workspaceId,
            companyId,
            riskScore: computation.riskScore,
            level: computation.level,
          }),
          [null, null],
        ),
    )
    const dto = expectOk(
      await CrmHealthService.getCustomerHealth('u', 'ws', 'c1', now),
    )
    expect(dto.level).toBe('HIGH')
    expect(dto.companyName).toBe('Acme')
    expect(notifyCustomer).not.toHaveBeenCalled()
  })

  it('reports a missing company and propagates repository failures', async () => {
    repo.findCompany.mockResolvedValue(ok(null))
    expectErr(
      await CrmHealthService.getCustomerHealth('u', 'ws', 'c1'),
      'CRM_COMPANY_NOT_FOUND',
    )

    repo.findCompany.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.getCustomerHealth('u', 'ws', 'c1'),
      'DATABASE_ERROR',
    )

    repo.findCompany.mockResolvedValue(ok(company))
    repo.getCustomerHealth.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.getCustomerHealth('u', 'ws', 'c1'),
      'DATABASE_ERROR',
    )

    repo.getCustomerHealth.mockResolvedValue(ok(null))
    signalsRepo.customerSignals.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.getCustomerHealth('u', 'ws', 'c1'),
      'DATABASE_ERROR',
    )

    signalsRepo.customerSignals.mockResolvedValue(ok(silentCustomer))
    repo.upsertCustomerHealth.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.getCustomerHealth('u', 'ws', 'c1'),
      'DATABASE_ERROR',
    )
  })

  it('lists the ranking', async () => {
    repo.listCustomerHealth.mockResolvedValue(
      ok([
        {
          ...createFakeCrmCustomerHealth({ riskScore: 80, level: 'HIGH' }),
          company: { name: 'Acme', accountOwnerId: null },
        },
      ]),
    )
    const rows = expectOk(
      await CrmHealthService.listCustomerHealth('u', 'ws', {
        level: 'HIGH',
        limit: 5,
      }),
    )
    expect(rows[0]).toMatchObject({ companyName: 'Acme', level: 'HIGH' })
    expect(repo.listCustomerHealth).toHaveBeenCalledWith('ws', {
      level: 'HIGH',
      limit: 5,
    })

    repo.listCustomerHealth.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.listCustomerHealth('u', 'ws', { limit: 5 }),
      'DATABASE_ERROR',
    )
  })

  it('recompute alerts the account owner when the customer enters the high band', async () => {
    repo.findCompany.mockResolvedValue(ok(company))
    signalsRepo.customerSignals.mockResolvedValue(ok(silentCustomer))
    repo.upsertCustomerHealth.mockResolvedValue(
      upserted(createFakeCrmCustomerHealth({ riskScore: 80, level: 'HIGH' }), [
        40,
        'MEDIUM',
      ]),
    )
    expectOk(
      await CrmHealthService.recomputeCustomerHealth('u', 'ws', 'c1', now),
    )
    expect(notifyCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'owner1',
        company: { id: 'c1', name: 'Acme' },
        riskScore: 80,
        levelLabel: 'Risco alto',
        nextAction: 'Retomar o contato com o cliente',
        computedAt: now,
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_customer_health',
        targetId: 'c1',
      }),
    )
  })

  it('does not alert again when it was already high', async () => {
    repo.findCompany.mockResolvedValue(ok(company))
    signalsRepo.customerSignals.mockResolvedValue(ok(silentCustomer))
    repo.upsertCustomerHealth.mockResolvedValue(
      upserted(createFakeCrmCustomerHealth({ riskScore: 80, level: 'HIGH' }), [
        80,
        'HIGH',
      ]),
    )
    expectOk(
      await CrmHealthService.recomputeCustomerHealth('u', 'ws', 'c1', now),
    )
    expect(notifyCustomer).not.toHaveBeenCalled()
  })

  it('recompute fails for a company that is gone', async () => {
    repo.findCompany.mockResolvedValue(ok(null))
    expectErr(
      await CrmHealthService.recomputeCustomerHealth('u', 'ws', 'c1'),
      'CRM_COMPANY_NOT_FOUND',
    )
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('opportunity health', () => {
  it('returns the stored score of an open deal', async () => {
    repo.findOpportunity.mockResolvedValue(ok(deal))
    repo.getOpportunityHealth.mockResolvedValue(
      ok(createFakeCrmOpportunityHealth({ opportunityId: 'o1' })),
    )
    const dto = expectOk(
      await CrmHealthService.getOpportunityHealth('u', 'ws', 'o1'),
    )
    expect(dto).toMatchObject({ opportunityName: 'Renovação', level: 'MEDIUM' })
  })

  it('computes on the first look, without alerting', async () => {
    repo.findOpportunity.mockResolvedValue(ok(deal))
    repo.getOpportunityHealth.mockResolvedValue(ok(null))
    signalsRepo.opportunitySignals.mockResolvedValue(ok(stalledDeal))
    repo.upsertOpportunityHealth.mockResolvedValue(
      upserted(
        createFakeCrmOpportunityHealth({ riskScore: 100, level: 'HIGH' }),
        [null, null],
      ),
    )
    const dto = expectOk(
      await CrmHealthService.getOpportunityHealth('u', 'ws', 'o1', now),
    )
    expect(dto.riskScore).toBe(100)
    expect(notifyDeal).not.toHaveBeenCalled()
  })

  it('refuses deals that are missing or already closed', async () => {
    repo.findOpportunity.mockResolvedValue(ok(null))
    expectErr(
      await CrmHealthService.getOpportunityHealth('u', 'ws', 'o1'),
      'CRM_OPPORTUNITY_NOT_FOUND',
    )
    repo.findOpportunity.mockResolvedValue(ok({ ...deal, isOpen: false }))
    expectErr(
      await CrmHealthService.getOpportunityHealth('u', 'ws', 'o1'),
      'CRM_HEALTH_NOT_APPLICABLE',
    )
    repo.deleteOpportunityHealth.mockResolvedValue(ok(undefined))
    expectErr(
      await CrmHealthService.recomputeOpportunityHealth('u', 'ws', 'o1'),
      'CRM_HEALTH_NOT_APPLICABLE',
    )
    expect(repo.deleteOpportunityHealth).toHaveBeenCalledWith('o1')
  })

  it('propagates repository failures', async () => {
    repo.findOpportunity.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.getOpportunityHealth('u', 'ws', 'o1'),
      'DATABASE_ERROR',
    )

    repo.findOpportunity.mockResolvedValue(ok(deal))
    repo.getOpportunityHealth.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.getOpportunityHealth('u', 'ws', 'o1'),
      'DATABASE_ERROR',
    )

    repo.getOpportunityHealth.mockResolvedValue(ok(null))
    signalsRepo.opportunitySignals.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.getOpportunityHealth('u', 'ws', 'o1'),
      'DATABASE_ERROR',
    )

    signalsRepo.opportunitySignals.mockResolvedValue(ok(stalledDeal))
    repo.upsertOpportunityHealth.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.getOpportunityHealth('u', 'ws', 'o1'),
      'DATABASE_ERROR',
    )

    repo.deleteOpportunityHealth.mockResolvedValue(err(databaseError('x')))
    repo.findOpportunity.mockResolvedValue(ok({ ...deal, isOpen: false }))
    expectErr(
      await CrmHealthService.recomputeOpportunityHealth('u', 'ws', 'o1'),
      'DATABASE_ERROR',
    )
  })

  it('lists the badges of a board', async () => {
    repo.listOpportunityHealth.mockResolvedValue(
      ok([
        {
          ...createFakeCrmOpportunityHealth({ opportunityId: 'o1' }),
          opportunity: { name: 'Renovação', ownerId: null },
        },
      ]),
    )
    const rows = expectOk(
      await CrmHealthService.listOpportunityHealth('u', 'ws', {
        pipelineId: 'p1',
        limit: 10,
      }),
    )
    expect(rows).toHaveLength(1)

    repo.listOpportunityHealth.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmHealthService.listOpportunityHealth('u', 'ws', { limit: 10 }),
      'DATABASE_ERROR',
    )
  })

  it('recompute alerts the owner only when the deal enters the high band', async () => {
    repo.findOpportunity.mockResolvedValue(ok(deal))
    signalsRepo.opportunitySignals.mockResolvedValue(ok(stalledDeal))
    repo.upsertOpportunityHealth.mockResolvedValue(
      upserted(
        createFakeCrmOpportunityHealth({ riskScore: 100, level: 'HIGH' }),
        [45, 'MEDIUM'],
      ),
    )
    expectOk(
      await CrmHealthService.recomputeOpportunityHealth('u', 'ws', 'o1', now),
    )
    expect(notifyDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'rep1',
        opportunity: { id: 'o1', name: 'Renovação' },
        levelLabel: 'Risco alto',
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_opportunity_health' }),
    )

    notifyDeal.mockClear()
    repo.upsertOpportunityHealth.mockResolvedValue(
      upserted(
        createFakeCrmOpportunityHealth({ riskScore: 100, level: 'HIGH' }),
        [100, 'HIGH'],
      ),
    )
    expectOk(
      await CrmHealthService.recomputeOpportunityHealth('u', 'ws', 'o1', now),
    )
    expect(notifyDeal).not.toHaveBeenCalled()
  })
})

describe('recomputeTick', () => {
  function stubWorkspace() {
    repo.deleteClosedOpportunityHealth.mockResolvedValue(ok(2))
    repo.listOpportunitiesToCompute.mockResolvedValue(ok(['o1', 'o2']))
    repo.listCompaniesToCompute.mockResolvedValue(ok(['c1']))
    repo.findOpportunity.mockResolvedValue(ok(deal))
    repo.findCompany.mockResolvedValue(ok(company))
    signalsRepo.opportunitySignals.mockResolvedValue(ok(stalledDeal))
    signalsRepo.customerSignals.mockResolvedValue(ok(healthyCustomer))
    repo.upsertOpportunityHealth.mockResolvedValue(
      upserted(createFakeCrmOpportunityHealth(), [null, null]),
    )
    repo.upsertCustomerHealth.mockResolvedValue(
      upserted(createFakeCrmCustomerHealth(), [null, null]),
    )
  }

  it('scores deals then companies of every CRM workspace and counts alerts', async () => {
    repo.listCrmWorkspaceIds.mockResolvedValue(ok(['ws1', 'ws2']))
    stubWorkspace()
    const result = expectOk(await CrmHealthService.recomputeTick({}, now))
    expect(result).toEqual({
      workspaces: 2,
      opportunities: 4,
      companies: 2,
      // each deal enters HIGH (previous null): 4 deal alerts; customers are healthy.
      notified: 4,
      removed: 4,
      errors: 0,
    })
  })

  it('can be scoped to one workspace', async () => {
    stubWorkspace()
    const result = expectOk(
      await CrmHealthService.recomputeTick({ workspaceId: 'ws9' }, now),
    )
    expect(result.workspaces).toBe(1)
    expect(repo.listCrmWorkspaceIds).not.toHaveBeenCalled()
    expect(repo.deleteClosedOpportunityHealth).toHaveBeenCalledWith('ws9')
  })

  it('fails when the workspaces cannot be listed', async () => {
    repo.listCrmWorkspaceIds.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmHealthService.recomputeTick({}, now), 'DATABASE_ERROR')
  })

  it('skips closed deals and counts failing records without aborting', async () => {
    stubWorkspace()
    repo.findOpportunity
      .mockResolvedValueOnce(ok({ ...deal, isOpen: false }))
      .mockResolvedValueOnce(err(databaseError('x')))
    repo.deleteOpportunityHealth.mockResolvedValue(ok(undefined))
    repo.findCompany.mockResolvedValue(err(databaseError('x')))
    const result = expectOk(
      await CrmHealthService.recomputeTick({ workspaceId: 'ws1' }, now),
    )
    expect(result).toMatchObject({
      opportunities: 0,
      companies: 0,
      errors: 2,
    })
  })

  it('counts worklist and cleanup failures', async () => {
    repo.deleteClosedOpportunityHealth.mockResolvedValue(
      err(databaseError('x')),
    )
    repo.listOpportunitiesToCompute.mockResolvedValue(err(databaseError('x')))
    repo.listCompaniesToCompute.mockResolvedValue(err(databaseError('x')))
    const result = expectOk(
      await CrmHealthService.recomputeTick({ workspaceId: 'ws1' }, now),
    )
    expect(result.errors).toBe(3)
    expect(result.removed).toBe(0)
  })

  it('logs and goes on when a whole workspace blows up', async () => {
    repo.listCrmWorkspaceIds.mockResolvedValue(ok(['ws1', 'ws2']))
    repo.deleteClosedOpportunityHealth
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce('plain')
    const result = expectOk(await CrmHealthService.recomputeTick({}, now))
    expect(result).toMatchObject({ workspaces: 2, errors: 2 })
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'crm.health.workspace_failed',
      expect.objectContaining({ workspaceId: 'ws1', message: 'boom' }),
    )
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'crm.health.workspace_failed',
      expect.objectContaining({ workspaceId: 'ws2', message: 'plain' }),
    )
  })
})
