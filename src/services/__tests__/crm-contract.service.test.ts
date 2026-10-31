import { Prisma, type Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeCrmContract } from '@/src/__tests__/factories/nov-crm-deals.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/crm-contract.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-health.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-pipeline.repository')
vi.mock('../crm-deals-settings.service')
vi.mock('../crm-notifications')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmContractRepository } from '@/src/repositories/crm-contract.repository'
import { CrmHealthRepository } from '@/src/repositories/crm-health.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import {
  CrmPipelineRepository,
  CrmPipelineStageRepository,
} from '@/src/repositories/crm-pipeline.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmContractService as Service } from '../crm-contract.service'
import { CrmDealsSettingsService } from '../crm-deals-settings.service'
import { notifyCrmContractExpiring } from '../crm-notifications'

const members = vi.mocked(MembershipRepository)
const access = vi.mocked(WorkspaceModuleAccessRepository)
const contracts = vi.mocked(CrmContractRepository)
const companies = vi.mocked(CrmCompanyRepository)
const health = vi.mocked(CrmHealthRepository)
const deals = vi.mocked(CrmOpportunityRepository)
const pipelines = vi.mocked(CrmPipelineRepository)
const stages = vi.mocked(CrmPipelineStageRepository)
const settings = vi.mocked(CrmDealsSettingsService)
const notify = vi.mocked(notifyCrmContractExpiring)

const NOW = new Date('2026-10-30T12:00:00.000Z')
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const withSettings = (overrides = {}) =>
  settings.resolve.mockResolvedValue(
    ok({
      proposalPaymentEnabled: false,
      proposalSignatureEnabled: false,
      renewalLeadDays: 60,
      renewalAutoCreate: true,
      ...overrides,
    }),
  )

function stage(id: string, category: 'OPEN' | 'WON' | 'LOST') {
  const now = new Date()
  return {
    id,
    pipelineId: 'pipe',
    name: id,
    position: 0,
    probability: 0,
    category,
    color: null,
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  access.isEnabled.mockResolvedValue(ok(true))
  asRole('OWNER')
  withSettings()
  notify.mockResolvedValue(1)
})

describe('list / get', () => {
  it('lists contracts with the renewal state against the workspace window', async () => {
    contracts.list.mockResolvedValue(
      // Relative to the real clock: the mapper reads "now" itself.
      ok([createFakeCrmContract({ endDate: new Date(Date.now() + 20 * 86_400_000) })]),
    )
    const rows = expectOk(await Service.list('u', 'ws', {}))
    expect(rows[0]?.renewalState).toBe('EXPIRING')
  })

  it('turns endsWithinDays into an active-only window', async () => {
    contracts.list.mockResolvedValue(ok([]))
    expectOk(await Service.list('u', 'ws', { endsWithinDays: 30 }))
    expect(contracts.list).toHaveBeenCalledWith(
      'ws',
      expect.objectContaining({ status: 'ACTIVE', endsBefore: expect.any(Date) }),
    )
    expectOk(await Service.list('u', 'ws', { status: 'EXPIRED', companyId: 'c1' }))
    expect(contracts.list).toHaveBeenLastCalledWith(
      'ws',
      expect.objectContaining({ status: 'EXPIRED', companyId: 'c1', endsBefore: undefined }),
    )
  })

  it('propagates failures and checks access', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.list('u', 'ws', {}), 'FORBIDDEN')
    asRole('OWNER')
    settings.resolve.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.list('u', 'ws', {}), 'DATABASE_ERROR')
    withSettings()
    contracts.list.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.list('u', 'ws', {}), 'DATABASE_ERROR')
  })

  it('reads one contract', async () => {
    contracts.findById.mockResolvedValue(ok(createFakeCrmContract({ id: 'k1' })))
    expect(expectOk(await Service.get('u', 'ws', 'k1')).id).toBe('k1')
    contracts.findById.mockResolvedValue(
      err({ code: 'CRM_CONTRACT_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.get('u', 'ws', 'k1'), 'CRM_CONTRACT_NOT_FOUND')
    settings.resolve.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.get('u', 'ws', 'k1'), 'DATABASE_ERROR')
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.get('u', 'ws', 'k1'), 'FORBIDDEN')
  })
})

describe('create', () => {
  const dto = {
    name: 'Plano',
    companyId: 'c1',
    startDate: inDays(-300),
    endDate: inDays(65),
    autoRenews: false,
  }

  beforeEach(() => {
    companies.findById.mockResolvedValue(
      ok(createFakeCrmCompany({ id: 'c1', accountOwnerId: 'acct' })),
    )
    contracts.create.mockImplementation(async (data) =>
      ok(
        createFakeCrmContract({
          ...data,
          value: data.value === null ? null : new Prisma.Decimal(data.value),
        }),
      ),
    )
  })

  it('defaults the owner to the account owner and audits', async () => {
    expectOk(await Service.create('u', 'ws', dto))
    expect(contracts.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'acct', createdById: 'u', value: null }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_contract', action: 'create' }),
    )
  })

  it('checks the deal and the owner when given', async () => {
    deals.findById.mockResolvedValue(ok(createFakeCrmOpportunity()))
    expectOk(
      await Service.create('u', 'ws', { ...dto, opportunityId: 'o1', ownerId: 'u' }),
    )
    deals.findById.mockResolvedValue(
      err({ code: 'RESOURCE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await Service.create('u', 'ws', { ...dto, opportunityId: 'o1' }),
      'RESOURCE_NOT_FOUND',
    )
    deals.findById.mockResolvedValue(ok(createFakeCrmOpportunity()))
    members.findByUserAndWorkspace.mockImplementation(async (userId) =>
      ok(userId === 'u' ? createFakeMembership({ role: 'OWNER' }) : null),
    )
    expectErr(
      await Service.create('u', 'ws', { ...dto, ownerId: 'stranger' }),
      'FORBIDDEN',
    )
  })

  it('propagates failures and denies a viewer', async () => {
    companies.findById.mockResolvedValue(
      err({ code: 'RESOURCE_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.create('u', 'ws', dto), 'RESOURCE_NOT_FOUND')
    companies.findById.mockResolvedValue(ok(createFakeCrmCompany()))
    contracts.create.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.create('u', 'ws', dto), 'DATABASE_ERROR')
    settings.resolve.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.create('u', 'ws', dto), 'DATABASE_ERROR')
    asRole('VIEWER')
    expectErr(await Service.create('u', 'ws', dto), 'FORBIDDEN')
  })
})

describe('update', () => {
  const existing = createFakeCrmContract({
    id: 'k1',
    startDate: inDays(-100),
    endDate: inDays(30),
    alertedAt: inDays(-5),
  })

  beforeEach(() => {
    contracts.findById.mockResolvedValue(ok(existing))
    contracts.update.mockImplementation(async () => ok(existing))
  })

  it('reopens the alert window when the end date moves', async () => {
    expectOk(await Service.update('u', 'ws', 'k1', { endDate: inDays(400) }))
    expect(contracts.update).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({ alertedAt: null }),
    )
  })

  it('keeps the alert when the end date is the same and writes only given fields', async () => {
    expectOk(
      await Service.update('u', 'ws', 'k1', {
        endDate: existing.endDate,
        name: 'Novo',
        ownerId: 'u',
        value: 10,
        startDate: inDays(-200),
        autoRenews: true,
        status: 'CANCELED',
        notes: 'x',
      }),
    )
    const data = contracts.update.mock.calls[0]?.[1] as Record<string, unknown>
    expect(data).not.toHaveProperty('alertedAt')
    expect(data).toMatchObject({ name: 'Novo', status: 'CANCELED', autoRenews: true })
    expectOk(await Service.update('u', 'ws', 'k1', {}))
    expect(contracts.update.mock.calls[1]?.[1]).toEqual({})
  })

  it('refuses an end before the start', async () => {
    expectErr(
      await Service.update('u', 'ws', 'k1', { endDate: inDays(-300) }),
      'BAD_REQUEST',
    )
  })

  it('checks the new owner, the contract and the write', async () => {
    members.findByUserAndWorkspace.mockImplementation(async (userId) =>
      ok(userId === 'u' ? createFakeMembership({ role: 'OWNER' }) : null),
    )
    expectErr(
      await Service.update('u', 'ws', 'k1', { ownerId: 'stranger' }),
      'FORBIDDEN',
    )
    asRole('OWNER')
    contracts.findById.mockResolvedValue(
      err({ code: 'CRM_CONTRACT_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.update('u', 'ws', 'k1', {}), 'CRM_CONTRACT_NOT_FOUND')
    contracts.findById.mockResolvedValue(ok(existing))
    contracts.update.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.update('u', 'ws', 'k1', {}), 'DATABASE_ERROR')
    settings.resolve.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.update('u', 'ws', 'k1', {}), 'DATABASE_ERROR')
    asRole('VIEWER')
    expectErr(await Service.update('u', 'ws', 'k1', {}), 'FORBIDDEN')
  })
})

describe('remove', () => {
  it('soft-deletes and audits', async () => {
    contracts.findById.mockResolvedValue(ok(createFakeCrmContract({ id: 'k1' })))
    contracts.softDelete.mockResolvedValue(ok(undefined))
    expectOk(await Service.remove('u', 'ws', 'k1'))
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    )
  })

  it('propagates failures and denies a viewer', async () => {
    contracts.findById.mockResolvedValue(
      err({ code: 'CRM_CONTRACT_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.remove('u', 'ws', 'k1'), 'CRM_CONTRACT_NOT_FOUND')
    contracts.findById.mockResolvedValue(ok(createFakeCrmContract()))
    contracts.softDelete.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.remove('u', 'ws', 'k1'), 'DATABASE_ERROR')
    asRole('VIEWER')
    expectErr(await Service.remove('u', 'ws', 'k1'), 'FORBIDDEN')
  })
})

describe('renew', () => {
  const contract = createFakeCrmContract({
    id: 'k1',
    workspaceId: 'ws',
    companyId: 'c1',
    opportunityId: 'origin',
    ownerId: 'owner',
  })

  beforeEach(() => {
    contracts.findById.mockResolvedValue(ok(contract))
    deals.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ id: 'origin', pipelineId: 'pipe' })),
    )
    stages.listByPipeline.mockResolvedValue(
      ok([stage('s-won', 'WON'), stage('s-open', 'OPEN')]),
    )
    deals.create.mockResolvedValue(ok(createFakeCrmOpportunity({ id: 'renewal' })))
    contracts.update.mockResolvedValue(ok(contract))
  })

  it('opens the renewal deal in the pipeline of the original sale', async () => {
    expectOk(await Service.renew('u', 'ws', 'k1'))
    expect(deals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renovação — Plano anual',
        pipelineId: 'pipe',
        stageId: 's-open',
        companyId: 'c1',
        ownerId: 'owner',
        createdById: 'u',
        amount: 24000,
        source: 'Renovação',
        closeDate: contract.endDate,
      }),
    )
    expect(contracts.update).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({ renewalOpportunityId: 'renewal' }),
    )
  })

  it('falls back to the default pipeline and the account owner, with no amount', async () => {
    const bare = createFakeCrmContract({
      id: 'k2',
      opportunityId: null,
      ownerId: null,
      value: null,
    })
    contracts.findById.mockResolvedValue(ok(bare))
    pipelines.findDefault.mockResolvedValue(
      ok({ id: 'pipe' } as never),
    )
    expectOk(await Service.renew('u', 'ws', 'k2'))
    expect(deals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: undefined,
        ownerId: bare.company.accountOwnerId,
      }),
    )
  })

  it('uses the first pipeline when none is marked as default', async () => {
    deals.findById.mockResolvedValue(err(databaseError('x')))
    pipelines.findDefault.mockResolvedValue(ok(null))
    pipelines.listByWorkspace.mockResolvedValue(ok([{ id: 'first' } as never]))
    stages.listByPipeline.mockResolvedValue(ok([stage('s-open', 'OPEN')]))
    expectOk(await Service.renew('u', 'ws', 'k1'))
    expect(stages.listByPipeline).toHaveBeenCalledWith('first')
  })

  it('falls back to the default pipeline when the original deal is gone', async () => {
    deals.findById.mockResolvedValue(err(databaseError('x')))
    pipelines.findDefault.mockResolvedValue(ok({ id: 'pipe' } as never))
    expectOk(await Service.renew('u', 'ws', 'k1'))
  })

  it('needs a pipeline with an open stage', async () => {
    deals.findById.mockResolvedValue(err(databaseError('x')))
    pipelines.findDefault.mockResolvedValue(ok(null))
    pipelines.listByWorkspace.mockResolvedValue(ok([]))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'CRM_CONTRACT_INVALID')
    pipelines.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'DATABASE_ERROR')
    pipelines.findDefault.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'DATABASE_ERROR')
    deals.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ pipelineId: 'pipe' })),
    )
    stages.listByPipeline.mockResolvedValue(ok([stage('s-won', 'WON')]))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'CRM_CONTRACT_INVALID')
    stages.listByPipeline.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'DATABASE_ERROR')
  })

  it('refuses inactive or already renewed contracts', async () => {
    contracts.findById.mockResolvedValue(
      ok(createFakeCrmContract({ status: 'EXPIRED' })),
    )
    expectErr(await Service.renew('u', 'ws', 'k1'), 'CRM_CONTRACT_INVALID')
    contracts.findById.mockResolvedValue(
      ok(createFakeCrmContract({ renewalOpportunityId: 'x' })),
    )
    expectErr(await Service.renew('u', 'ws', 'k1'), 'CRM_CONTRACT_INVALID')
    expect(deals.create).not.toHaveBeenCalled()
  })

  it('propagates failures and denies a viewer', async () => {
    deals.create.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'DATABASE_ERROR')
    deals.create.mockResolvedValue(ok(createFakeCrmOpportunity()))
    contracts.update.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'DATABASE_ERROR')
    contracts.update.mockResolvedValue(ok(contract))
    contracts.findById
      .mockResolvedValueOnce(ok(contract))
      .mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'DATABASE_ERROR')
    contracts.findById.mockResolvedValue(
      err({ code: 'CRM_CONTRACT_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.renew('u', 'ws', 'k1'), 'CRM_CONTRACT_NOT_FOUND')
    settings.resolve.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.renew('u', 'ws', 'k1'), 'DATABASE_ERROR')
    asRole('VIEWER')
    expectErr(await Service.renew('u', 'ws', 'k1'), 'FORBIDDEN')
  })
})

describe('upsell', () => {
  const rows = [
    { productId: 'crm', name: 'CRM', unitPrice: 100, companyId: 'c1' },
    { productId: 'crm', name: 'CRM', unitPrice: 100, companyId: 'c2' },
    { productId: 'zap', name: 'Zap', unitPrice: 50, companyId: 'c2' },
  ]

  beforeEach(() => {
    companies.findById.mockResolvedValue(ok(createFakeCrmCompany({ id: 'c1' })))
    contracts.wonProductRows.mockResolvedValue(ok(rows))
    contracts.latestSatisfaction.mockResolvedValue(
      ok({ kind: 'NPS', score: 10, answeredAt: NOW }),
    )
    contracts.customerHealthLevel.mockResolvedValue(ok('LOW'))
  })

  it('suggests what similar customers bought and says it is a good time', async () => {
    const dto = expectOk(await Service.upsell('u', 'ws', 'c1'))
    expect(dto.timing).toBe('GO')
    expect(dto.suggestions).toEqual([
      expect.objectContaining({ productId: 'zap', buyers: 1, peers: 1, adoptionPct: 100 }),
    ])
    expect(dto.satisfaction).toEqual({
      kind: 'NPS',
      score: 10,
      answeredAt: NOW.toISOString(),
    })
    expect(dto.healthLevel).toBe('LOW')
  })

  it('tells the seller to wait on a churn risk and tolerates no survey', async () => {
    contracts.customerHealthLevel.mockResolvedValue(ok('HIGH'))
    contracts.latestSatisfaction.mockResolvedValue(ok(null))
    const dto = expectOk(await Service.upsell('u', 'ws', 'c1'))
    expect(dto.timing).toBe('WAIT')
    expect(dto.satisfaction).toBeNull()
  })

  it('propagates failures and denies a stranger', async () => {
    companies.findById.mockResolvedValue(
      err({ code: 'RESOURCE_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.upsell('u', 'ws', 'c1'), 'RESOURCE_NOT_FOUND')
    companies.findById.mockResolvedValue(ok(createFakeCrmCompany()))
    contracts.wonProductRows.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.upsell('u', 'ws', 'c1'), 'DATABASE_ERROR')
    contracts.wonProductRows.mockResolvedValue(ok(rows))
    contracts.latestSatisfaction.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.upsell('u', 'ws', 'c1'), 'DATABASE_ERROR')
    contracts.latestSatisfaction.mockResolvedValue(ok(null))
    contracts.customerHealthLevel.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.upsell('u', 'ws', 'c1'), 'DATABASE_ERROR')
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.upsell('u', 'ws', 'c1'), 'FORBIDDEN')
  })
})

describe('renewalTick', () => {
  const expiring = createFakeCrmContract({
    id: 'k1',
    workspaceId: 'ws',
    name: 'Plano',
    endDate: inDays(30),
    ownerId: 'owner',
  })

  beforeEach(() => {
    health.listCrmWorkspaceIds.mockResolvedValue(ok(['ws']))
    contracts.listToAlert.mockResolvedValue(ok([expiring]))
    contracts.listToRenew.mockResolvedValue(ok([expiring]))
    contracts.listAutoRenewDue.mockResolvedValue(ok([]))
    contracts.expireEnded.mockResolvedValue(ok(2))
    contracts.update.mockResolvedValue(ok(expiring))
    deals.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ pipelineId: 'pipe' })),
    )
    pipelines.findDefault.mockResolvedValue(ok({ id: 'pipe' } as never))
    stages.listByPipeline.mockResolvedValue(ok([stage('s-open', 'OPEN')]))
    deals.create.mockResolvedValue(ok(createFakeCrmOpportunity({ id: 'renewal' })))
  })

  it('warns the owner once, opens the renewal and expires the ended', async () => {
    const result = expectOk(await Service.renewalTick({}, NOW))
    expect(result).toEqual({
      workspaces: 1,
      expired: 2,
      rolled: 0,
      alerted: 1,
      renewalsCreated: 1,
      errors: 0,
    })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'k1',
        recipientId: 'owner',
        body: expect.stringContaining('vence em 30 dia(s)'),
      }),
    )
    expect(contracts.update).toHaveBeenCalledWith('k1', { alertedAt: NOW })
    expect(contracts.listToAlert).toHaveBeenCalledWith(
      'ws',
      new Date(NOW.getTime() + 60 * 86_400_000),
    )
  })

  it('alerts the account owner when the contract has none', async () => {
    const orphan = createFakeCrmContract({ ownerId: null, endDate: inDays(5) })
    contracts.listToAlert.mockResolvedValue(ok([orphan]))
    expectOk(await Service.renewalTick({ workspaceId: 'ws' }, NOW))
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: orphan.company.accountOwnerId }),
    )
    expect(health.listCrmWorkspaceIds).not.toHaveBeenCalled()
  })

  it('skips the renewal deal when auto-create is off', async () => {
    withSettings({ renewalAutoCreate: false })
    const result = expectOk(await Service.renewalTick({}, NOW))
    expect(result.renewalsCreated).toBe(0)
    expect(contracts.listToRenew).not.toHaveBeenCalled()
  })

  it('rolls auto-renewing contracts forward one term at a time', async () => {
    const auto = createFakeCrmContract({
      id: 'k9',
      autoRenews: true,
      startDate: new Date('2025-01-01T12:00:00.000Z'),
      endDate: new Date('2026-01-01T12:00:00.000Z'),
      alertedAt: NOW,
      renewalOpportunityId: 'old',
    })
    contracts.listAutoRenewDue.mockResolvedValue(ok([auto]))
    contracts.listToAlert.mockResolvedValue(ok([]))
    contracts.listToRenew.mockResolvedValue(ok([]))
    const result = expectOk(await Service.renewalTick({}, NOW))
    expect(result.rolled).toBe(1)
    const data = contracts.update.mock.calls[0]?.[1] as {
      startDate: Date
      endDate: Date
      alertedAt: null
    }
    expect(data.startDate.toISOString()).toBe('2026-01-01T12:00:00.000Z')
    expect(data.endDate.toISOString()).toBe('2027-01-01T12:00:00.000Z')
    expect(data.alertedAt).toBeNull()
  })

  it('rolls several terms when the contract was left behind', async () => {
    const auto = createFakeCrmContract({
      autoRenews: true,
      startDate: new Date('2022-01-01T12:00:00.000Z'),
      endDate: new Date('2023-01-01T12:00:00.000Z'),
    })
    contracts.listAutoRenewDue.mockResolvedValue(ok([auto]))
    contracts.listToAlert.mockResolvedValue(ok([]))
    contracts.listToRenew.mockResolvedValue(ok([]))
    expectOk(await Service.renewalTick({}, NOW))
    const data = contracts.update.mock.calls[0]?.[1] as { endDate: Date }
    expect(data.endDate.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('counts every failure and keeps going', async () => {
    contracts.listToAlert.mockResolvedValue(err(databaseError('x')))
    contracts.listToRenew.mockResolvedValue(err(databaseError('x')))
    contracts.listAutoRenewDue.mockResolvedValue(err(databaseError('x')))
    contracts.expireEnded.mockResolvedValue(err(databaseError('x')))
    expect(expectOk(await Service.renewalTick({}, NOW)).errors).toBe(4)
  })

  it('counts a failed stamp, a failed renewal and a failed roll', async () => {
    contracts.update.mockResolvedValue(err(databaseError('x')))
    stages.listByPipeline.mockResolvedValue(ok([]))
    contracts.listAutoRenewDue.mockResolvedValue(
      ok([createFakeCrmContract({ autoRenews: true, endDate: inDays(-1) })]),
    )
    const result = expectOk(await Service.renewalTick({}, NOW))
    expect(result.errors).toBe(3)
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.contracts.renewal_failed',
      expect.objectContaining({ code: 'CRM_CONTRACT_INVALID' }),
    )
  })

  it('isolates a workspace that throws or has unreadable settings', async () => {
    health.listCrmWorkspaceIds.mockResolvedValue(ok(['bad', 'worse', 'ws']))
    settings.resolve
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockImplementationOnce(() => {
        throw new Error('boom')
      })
    withSettingsOnce()
    const result = expectOk(await Service.renewalTick({}, NOW))
    expect(result.workspaces).toBe(3)
    expect(result.errors).toBe(2)
    expect(logger.error).toHaveBeenCalledWith(
      'crm.contracts.workspace_failed',
      expect.objectContaining({ workspaceId: 'worse', message: 'boom' }),
    )
  })

  it('stringifies a non-Error throw and propagates the workspace list failing', async () => {
    health.listCrmWorkspaceIds.mockResolvedValue(ok(['ws']))
    settings.resolve.mockImplementationOnce(() => {
      throw 'plain'
    })
    expectOk(await Service.renewalTick({}, NOW))
    expect(logger.error).toHaveBeenCalledWith(
      'crm.contracts.workspace_failed',
      expect.objectContaining({ message: 'plain' }),
    )
    health.listCrmWorkspaceIds.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.renewalTick({}, NOW), 'DATABASE_ERROR')
  })

  it('defaults to the current time', async () => {
    expectOk(await Service.renewalTick())
    expect(contracts.listToAlert).toHaveBeenCalled()
  })
})

describe('scan', () => {
  it('is for admins and runs the tick on the workspace', async () => {
    health.listCrmWorkspaceIds.mockResolvedValue(ok([]))
    contracts.listToAlert.mockResolvedValue(ok([]))
    contracts.listToRenew.mockResolvedValue(ok([]))
    contracts.listAutoRenewDue.mockResolvedValue(ok([]))
    contracts.expireEnded.mockResolvedValue(ok(0))
    expect(expectOk(await Service.scan('u', 'ws')).workspaces).toBe(1)
    asRole('MEMBER')
    expectErr(await Service.scan('u', 'ws'), 'FORBIDDEN')
  })
})

function withSettingsOnce() {
  settings.resolve.mockResolvedValue(
    ok({
      proposalPaymentEnabled: false,
      proposalSignatureEnabled: false,
      renewalLeadDays: 60,
      renewalAutoCreate: true,
    }),
  )
}
