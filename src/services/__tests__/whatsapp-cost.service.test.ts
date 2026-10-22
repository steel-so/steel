import type { WhatsAppPrice } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/whatsapp-cost.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('../whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
  whatsAppAdminIds: vi.fn(async () => ['admin1']),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppCostRepository } from '@/src/repositories/whatsapp-cost.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WhatsAppCostService } from '../whatsapp-cost.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'

const memberships = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const costs = vi.mocked(WhatsAppCostRepository)
const settingsRepo = vi.mocked(WhatsAppSettingsRepository)
const notify = vi.mocked(notifyWhatsAppUsers)

const NOW = new Date('2026-10-15T15:00:00.000Z')
const meta = createFakeWhatsAppConnection({
  id: 'conn-meta',
  workspaceId: 'ws1',
  provider: 'META',
})
const zapi = createFakeWhatsAppConnection({
  id: 'conn-zapi',
  workspaceId: 'ws1',
  provider: 'ZAPI',
})

function asRole(role: 'VIEWER' | 'MEMBER' | 'ADMIN' | 'OWNER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function priceRow(category: string, unitPrice: number): WhatsAppPrice {
  return {
    id: `p-${category}`,
    workspaceId: 'ws1',
    category,
    country: 'BR',
    currency: 'BRL',
    unitPrice,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    reference: false,
    createdById: null,
    createdAt: NOW,
  } as unknown as WhatsAppPrice
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  asRole('OWNER')
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  costs.listPrices.mockResolvedValue(
    ok([
      priceRow('MARKETING', 0.4),
      priceRow('UTILITY', 0.05),
      priceRow('AUTHENTICATION', 0.2),
    ]),
  )
  costs.createEntry.mockResolvedValue(ok({} as never))
  settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WhatsAppCostService.record()', () => {
  it.each([
    ['BROADCAST', { source: 'BROADCAST' as const, broadcastId: 'b1' }],
    ['AI_CAMPAIGN', { source: 'AI_CAMPAIGN' as const, aiCampaignId: 'a1' }],
    ['CRM_CAMPAIGN', { source: 'CRM_CAMPAIGN' as const }],
    ['AGENT', { source: 'AGENT' as const, userId: 'u1', conversationId: 'c1' }],
    ['BUTTON', { source: 'BUTTON' as const, conversationId: 'c1' }],
  ])('writes a priced template entry for %s', async (source, context) => {
    await WhatsAppCostService.record({
      connection: meta,
      kind: 'TEMPLATE',
      to: '5511999990000',
      context: { ...context, templateCategory: 'UTILITY' },
      now: NOW,
    })

    expect(costs.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        connectionId: 'conn-meta',
        provider: 'META',
        category: 'UTILITY',
        kind: 'TEMPLATE',
        source,
        country: 'BR',
        quantity: 1,
        unitPrice: 0.05,
        estimatedCost: 0.05,
        broadcastId: context.source === 'BROADCAST' ? 'b1' : null,
        aiCampaignId: context.source === 'AI_CAMPAIGN' ? 'a1' : null,
      }),
    )
  })

  it('prices MARKETING for an unknown template category', async () => {
    await WhatsAppCostService.record({
      connection: meta,
      kind: 'TEMPLATE',
      to: '5511999990000',
      context: { source: 'BROADCAST', templateCategory: null },
      now: NOW,
    })
    expect(costs.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'MARKETING', estimatedCost: 0.4 }),
    )
  })

  it('records a free-form Meta message as SERVICE with zero cost', async () => {
    await WhatsAppCostService.record({
      connection: meta,
      kind: 'SERVICE',
      to: '5511999990000',
      now: NOW,
    })
    expect(costs.listPrices).not.toHaveBeenCalled()
    expect(costs.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'SERVICE',
        kind: 'SERVICE',
        source: 'OTHER',
        unitPrice: 0,
        estimatedCost: 0,
      }),
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('counts Z-API volume without any per-message price', async () => {
    await WhatsAppCostService.record({
      connection: zapi,
      kind: 'TEMPLATE',
      to: '5511999990000',
      context: { source: 'AGENT', templateCategory: 'MARKETING' },
      now: NOW,
    })
    expect(costs.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ZAPI',
        category: 'SERVICE',
        kind: 'SERVICE',
        estimatedCost: 0,
      }),
    )
  })

  it('uses the labeled reference prices while the workspace has none', async () => {
    costs.listPrices.mockResolvedValue(ok([]))
    await WhatsAppCostService.record({
      connection: meta,
      kind: 'TEMPLATE',
      to: '5511999990000',
      context: { source: 'BROADCAST', templateCategory: 'MARKETING' },
      now: NOW,
    })
    expect(costs.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ unitPrice: 0.3625 }),
    )
  })

  it('also falls back to the reference when the price lookup fails', async () => {
    costs.listPrices.mockResolvedValue(err(databaseError('x')))
    await WhatsAppCostService.record({
      connection: meta,
      kind: 'TEMPLATE',
      to: '5511999990000',
      context: { source: 'BROADCAST', templateCategory: 'UTILITY' },
      now: NOW,
    })
    expect(costs.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ unitPrice: 0.04 }),
    )
  })

  it('skips the ServiceDesk line entirely', async () => {
    await WhatsAppCostService.record({
      connection: { ...meta, module: 'SERVICE_DESK' },
      kind: 'TEMPLATE',
      to: '5511999990000',
    })
    expect(costs.createEntry).not.toHaveBeenCalled()
  })

  it('never throws when the ledger write fails or blows up', async () => {
    costs.createEntry.mockResolvedValueOnce(err(databaseError('down')))
    await expect(
      WhatsAppCostService.record({
        connection: meta,
        kind: 'TEMPLATE',
        to: '5511999990000',
      }),
    ).resolves.toBeUndefined()

    costs.createEntry.mockRejectedValueOnce(new Error('boom'))
    await expect(
      WhatsAppCostService.record({
        connection: meta,
        kind: 'TEMPLATE',
        to: '5511999990000',
      }),
    ).resolves.toBeUndefined()

    costs.createEntry.mockRejectedValueOnce('weird')
    await expect(
      WhatsAppCostService.record({
        connection: meta,
        kind: 'TEMPLATE',
        to: '5511999990000',
      }),
    ).resolves.toBeUndefined()
  })
})

describe('WhatsAppCostService.evaluateBudget()', () => {
  function budget(value: number | null) {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeWhatsAppSettings({
          workspaceId: 'ws1',
          monthlyCostBudget: value as never,
        }),
      ),
    )
  }
  function spend(variable: number, fee: number | null = null) {
    costs.sumCost.mockResolvedValue(ok(variable))
    costs.listConnections.mockResolvedValue(
      ok([{ id: 'conn-zapi', label: 'Z', provider: 'ZAPI', monthlyFee: fee }]),
    )
  }

  it('does nothing without a budget', async () => {
    budget(null)
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBeNull()
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('stays quiet below 80%', async () => {
    budget(100)
    spend(79)
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('warns the admins at 80% with a month-scoped idempotency key', async () => {
    budget(100)
    spend(30, 50)
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBe(80)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_COST_BUDGET_WARNING',
        userIds: ['admin1'],
        dedupeKey: 'whatsapp-cost-budget:ws1:2026-10:80',
      }),
    )
  })

  it('reports the budget as reached at 100% with its own key', async () => {
    budget(100)
    spend(120)
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBe(100)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_COST_BUDGET_REACHED',
        dedupeKey: 'whatsapp-cost-budget:ws1:2026-10:100',
      }),
    )
  })

  it('is idempotent: repeated evaluations reuse the same key', async () => {
    budget(100)
    spend(85)
    await WhatsAppCostService.evaluateBudget('ws1', NOW)
    await WhatsAppCostService.evaluateBudget('ws1', NOW)
    const keys = notify.mock.calls.map((call) => call[0].dedupeKey)
    expect(new Set(keys).size).toBe(1)
  })

  it('starts over in the next month', async () => {
    budget(100)
    spend(90)
    await WhatsAppCostService.evaluateBudget('ws1', NOW)
    await WhatsAppCostService.evaluateBudget(
      'ws1',
      new Date('2026-11-03T15:00:00Z'),
    )
    const keys = notify.mock.calls.map((call) => call[0].dedupeKey)
    expect(keys).toEqual([
      'whatsapp-cost-budget:ws1:2026-10:80',
      'whatsapp-cost-budget:ws1:2026-11:80',
    ])
  })

  it('swallows lookup failures', async () => {
    budget(100)
    costs.sumCost.mockResolvedValue(err(databaseError('x')))
    costs.listConnections.mockResolvedValue(ok([]))
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBeNull()

    settingsRepo.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBeNull()

    settingsRepo.findByWorkspace.mockRejectedValue(new Error('boom'))
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBeNull()
    settingsRepo.findByWorkspace.mockRejectedValue('weird')
    expect(await WhatsAppCostService.evaluateBudget('ws1', NOW)).toBeNull()
  })

  it('runs after a priced entry only', async () => {
    budget(100)
    spend(95)
    await WhatsAppCostService.record({
      connection: meta,
      kind: 'TEMPLATE',
      to: '5511999990000',
      context: { source: 'BROADCAST', templateCategory: 'MARKETING' },
      now: NOW,
    })
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe('authorization', () => {
  const query = { from: '2026-10-01', to: '2026-10-15' }
  const calls: [string, () => Promise<{ ok: boolean }>][] = [
    ['report', () => WhatsAppCostService.report('u1', 'ws1', query)],
    ['exportCsv', () => WhatsAppCostService.exportCsv('u1', 'ws1', query)],
    ['listPrices', () => WhatsAppCostService.listPrices('u1', 'ws1')],
    [
      'createPrice',
      () =>
        WhatsAppCostService.createPrice('u1', 'ws1', {
          category: 'UTILITY',
          country: 'BR',
          unitPrice: 0.1,
        }),
    ],
    ['deletePrice', () => WhatsAppCostService.deletePrice('u1', 'ws1', 'p1')],
    ['getSettings', () => WhatsAppCostService.getSettings('u1', 'ws1')],
    [
      'updateSettings',
      () => WhatsAppCostService.updateSettings('u1', 'ws1', {}),
    ],
  ]

  it.each(calls)(
    '%s refuses MEMBER and VIEWER (money is admin-only)',
    async (_n, call) => {
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        asRole(role)
        expectErr((await call()) as never, 'FORBIDDEN')
      }
    },
  )

  it.each(calls)('%s refuses non-members', async (_n, call) => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr((await call()) as never, 'FORBIDDEN')
  })

  it.each(calls)(
    '%s refuses a workspace without the module',
    async (_n, call) => {
      moduleAccess.isEnabled.mockResolvedValue(ok(false))
      expectErr((await call()) as never, 'MODULE_DISABLED')
    },
  )
})

describe('prices', () => {
  it('seeds the labeled reference rows on the first read', async () => {
    costs.listPrices
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(
        ok([{ ...priceRow('MARKETING', 0.3625), reference: true }]),
      )
    costs.seedPrices.mockResolvedValue(ok(3))

    const prices = expectOk(await WhatsAppCostService.listPrices('u1', 'ws1'))

    const rows = costs.seedPrices.mock.calls[0][0]
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.reference === true && r.country === 'BR')).toBe(
      true,
    )
    expect(prices[0]).toMatchObject({ reference: true, unitPrice: 0.3625 })
  })

  it('does not seed again once the workspace has rows', async () => {
    const prices = expectOk(await WhatsAppCostService.listPrices('u1', 'ws1'))
    expect(prices).toHaveLength(3)
    expect(costs.seedPrices).not.toHaveBeenCalled()
  })

  it('propagates repository errors while listing', async () => {
    costs.listPrices.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.listPrices('u1', 'ws1'),
      'DATABASE_ERROR',
    )

    costs.listPrices.mockResolvedValueOnce(ok([]))
    costs.seedPrices.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.listPrices('u1', 'ws1'),
      'DATABASE_ERROR',
    )

    costs.listPrices
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(err(databaseError('x')))
    costs.seedPrices.mockResolvedValue(ok(3))
    expectErr(
      await WhatsAppCostService.listPrices('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })

  it('creates a price valid from now by default and audits it', async () => {
    costs.upsertPrice.mockResolvedValue(ok(priceRow('UTILITY', 0.07)))
    const dto = expectOk(
      await WhatsAppCostService.createPrice('u1', 'ws1', {
        category: 'UTILITY',
        country: 'BR',
        unitPrice: 0.07,
      }),
    )
    expect(dto.unitPrice).toBe(0.07)
    expect(costs.upsertPrice).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        validFrom: NOW,
        reference: false,
        createdById: 'u1',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_cost_price',
        action: 'create',
      }),
    )
  })

  it('accepts an explicit start date and surfaces database errors', async () => {
    costs.upsertPrice.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.createPrice('u1', 'ws1', {
        category: 'MARKETING',
        country: 'US',
        unitPrice: 1,
        validFrom: '2026-12-01T00:00:00.000Z',
      }),
      'DATABASE_ERROR',
    )
    expect(costs.upsertPrice).toHaveBeenCalledWith(
      expect.objectContaining({ validFrom: new Date('2026-12-01T00:00:00Z') }),
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('deletes only prices of the workspace', async () => {
    costs.deletePrice.mockResolvedValueOnce(ok(true))
    expectOk(await WhatsAppCostService.deletePrice('u1', 'ws1', 'p1'))
    expect(costs.deletePrice).toHaveBeenCalledWith('ws1', 'p1')

    costs.deletePrice.mockResolvedValueOnce(ok(false))
    expectErr(
      await WhatsAppCostService.deletePrice('u1', 'ws1', 'other-ws-price'),
      'WHATSAPP_PRICE_NOT_FOUND',
    )

    costs.deletePrice.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.deletePrice('u1', 'ws1', 'p1'),
      'DATABASE_ERROR',
    )
  })
})

describe('settings', () => {
  beforeEach(() => {
    costs.listConnections.mockResolvedValue(
      ok([
        { id: 'conn-zapi', label: 'Z-API', provider: 'ZAPI', monthlyFee: 199 },
      ]),
    )
  })

  it('reads the budget and the fees', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeWhatsAppSettings({
          workspaceId: 'ws1',
          monthlyCostBudget: '500.5' as never,
        }),
      ),
    )
    const dto = expectOk(await WhatsAppCostService.getSettings('u1', 'ws1'))
    expect(dto).toEqual({
      monthlyCostBudget: 500.5,
      connections: [
        { id: 'conn-zapi', label: 'Z-API', provider: 'ZAPI', monthlyFee: 199 },
      ],
    })
  })

  it('has no budget by default', async () => {
    const dto = expectOk(await WhatsAppCostService.getSettings('u1', 'ws1'))
    expect(dto.monthlyCostBudget).toBeNull()
  })

  it('propagates read errors', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.getSettings('u1', 'ws1'),
      'DATABASE_ERROR',
    )
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    costs.listConnections.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.getSettings('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })

  it('saves fees and budget, audits and re-evaluates the budget', async () => {
    costs.setConnectionFee.mockResolvedValue(ok(true))
    settingsRepo.upsert.mockResolvedValue(ok(createFakeWhatsAppSettings()))
    costs.sumCost.mockResolvedValue(ok(0))

    expectOk(
      await WhatsAppCostService.updateSettings('u1', 'ws1', {
        monthlyCostBudget: 300,
        connectionFees: [{ connectionId: 'conn-zapi', monthlyFee: 199 }],
      }),
    )
    expect(costs.setConnectionFee).toHaveBeenCalledWith('ws1', 'conn-zapi', 199)
    expect(settingsRepo.upsert).toHaveBeenCalledWith('ws1', {
      monthlyCostBudget: 300,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'whatsapp_cost_settings' }),
    )
  })

  it('leaves the budget alone when omitted and clears it with null', async () => {
    settingsRepo.upsert.mockResolvedValue(ok(createFakeWhatsAppSettings()))
    expectOk(await WhatsAppCostService.updateSettings('u1', 'ws1', {}))
    expect(settingsRepo.upsert).not.toHaveBeenCalled()

    expectOk(
      await WhatsAppCostService.updateSettings('u1', 'ws1', {
        monthlyCostBudget: null,
      }),
    )
    expect(settingsRepo.upsert).toHaveBeenCalledWith('ws1', {
      monthlyCostBudget: null,
    })
  })

  it('refuses a fee for a connection of another workspace', async () => {
    costs.setConnectionFee.mockResolvedValue(ok(false))
    expectErr(
      await WhatsAppCostService.updateSettings('u1', 'ws1', {
        connectionFees: [{ connectionId: 'foreign', monthlyFee: 10 }],
      }),
      'RESOURCE_NOT_FOUND',
    )
    expect(settingsRepo.upsert).not.toHaveBeenCalled()
  })

  it('propagates write errors', async () => {
    costs.setConnectionFee.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.updateSettings('u1', 'ws1', {
        connectionFees: [{ connectionId: 'c', monthlyFee: 1 }],
      }),
      'DATABASE_ERROR',
    )
    settingsRepo.upsert.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.updateSettings('u1', 'ws1', {
        monthlyCostBudget: 1,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('report() aggregation math', () => {
  const query = { from: '2026-10-01', to: '2026-10-10' }

  function fixtures(overrides?: { zapiVolume?: number }) {
    const zapiVolume = overrides?.zapiVolume ?? 200
    costs.totals.mockResolvedValue(
      ok({ messages: 100 + zapiVolume, templateMessages: 100, cost: 36.25 }),
    )
    costs.trend.mockResolvedValue(
      ok([
        { date: '2026-10-01', cost: 10.126, messages: 40 },
        { date: '2026-10-02', cost: 26.124, messages: 60 },
      ]),
    )
    costs.groupBy.mockImplementation(async (_f, field) => {
      switch (field) {
        case 'connectionId':
          return ok([
            { key: 'conn-meta', messages: 100, cost: 36.25 },
            { key: 'conn-zapi', messages: zapiVolume, cost: 0 },
          ])
        case 'category':
          return ok([
            { key: 'MARKETING', messages: 100, cost: 36.25 },
            { key: 'SERVICE', messages: zapiVolume, cost: 0 },
          ])
        case 'broadcastId':
          return ok([
            { key: 'b1', messages: 80, cost: 29 },
            { key: null, messages: 220, cost: 7.25 },
          ])
        case 'aiCampaignId':
          return ok([{ key: 'gone', messages: 20, cost: 7.25 }])
        case 'userId':
          return ok([{ key: 'u9', messages: 5, cost: 1 }])
        default:
          return ok([{ key: 'BROADCAST', messages: 80, cost: 29 }])
      }
    })
    costs.conversationCounts.mockResolvedValue(
      ok([
        { connectionId: 'conn-meta', conversations: 10, resolved: 5 },
        { connectionId: 'conn-zapi', conversations: 40, resolved: 20 },
      ]),
    )
    costs.listConnections.mockResolvedValue(
      ok([
        {
          id: 'conn-meta',
          label: 'Meta oficial',
          provider: 'META',
          monthlyFee: null,
        },
        {
          id: 'conn-zapi',
          label: 'Z-API vendas',
          provider: 'ZAPI',
          monthlyFee: 310,
        },
      ]),
    )
    costs.broadcastNames.mockResolvedValue(
      ok(new Map([['b1', 'Black Friday']])),
    )
    costs.aiCampaignNames.mockResolvedValue(ok(new Map()))
    costs.userNames.mockResolvedValue(ok(new Map([['u9', 'Ana']])))
    costs.sumCost.mockResolvedValue(ok(30))
  }

  it('computes totals, per-unit ratios and the Meta vs Z-API comparison', async () => {
    fixtures()
    const report = expectOk(
      await WhatsAppCostService.report('u1', 'ws1', query, NOW),
    )

    // Z-API fee: 310 / 31 days x 10 days = 100.
    const zapiRow = report.byConnection.find((r) => r.provider === 'ZAPI')
    expect(zapiRow).toMatchObject({
      messages: 200,
      conversations: 40,
      variableCost: 0,
      fee: 100,
      totalCost: 100,
      costPerMessage: 0.5,
      costPerConversation: 2.5,
    })
    const [metaProvider, zapiProvider] = report.byProvider
    expect(metaProvider).toMatchObject({
      provider: 'META',
      totalCost: 36.25,
      costPerMessage: 0.36,
      costPerConversation: 3.63,
    })
    expect(zapiProvider).toMatchObject({
      provider: 'ZAPI',
      connections: 1,
      totalCost: 100,
    })

    expect(report.totals).toMatchObject({
      messages: 300,
      templateMessages: 100,
      serviceMessages: 200,
      variableCost: 36.25,
      fees: 100,
      totalCost: 136.25,
      conversations: 50,
      resolvedConversations: 25,
      costPerConversation: 2.73,
      costPerResolvedConversation: 5.45,
    })
    expect(report.currency).toBe('BRL')
    expect(report.trend[0]).toEqual({
      date: '2026-10-01',
      cost: 10.13,
      messages: 40,
    })
  })

  it('names the breakdowns and drops rows without the dimension', async () => {
    fixtures()
    const report = expectOk(
      await WhatsAppCostService.report('u1', 'ws1', query, NOW),
    )
    expect(report.byBroadcast).toEqual([
      { key: 'b1', label: 'Black Friday', messages: 80, cost: 29 },
    ])
    expect(report.byAiCampaign[0].label).toBe('Campanha removida')
    expect(report.byAgent[0].label).toBe('Ana')
    expect(report.byCategory.map((r) => r.label)).toEqual([
      'Marketing',
      'Atendimento (janela de 24 h)',
    ])
    expect(report.bySource[0].label).toBe('Transmissões')
  })

  it('projects the month from the run-rate and reads the budget', async () => {
    fixtures()
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeWhatsAppSettings({
          workspaceId: 'ws1',
          monthlyCostBudget: '400' as never,
        }),
      ),
    )
    const report = expectOk(
      await WhatsAppCostService.report('u1', 'ws1', query, NOW),
    )
    // 15 Oct: 30 to date / 15 x 31 = 62 + 310 fees.
    expect(report.projection).toEqual({
      period: '2026-10',
      monthCost: 372,
      variableToDate: 30,
      fees: 310,
      daysElapsed: 15,
      daysInMonth: 31,
    })
    expect(report.budget).toEqual({
      monthlyCostBudget: 400,
      spent: 340,
      percent: 85,
      level: 80,
    })
  })

  it('has no budget percent when none is set', async () => {
    fixtures()
    const report = expectOk(
      await WhatsAppCostService.report('u1', 'ws1', query, NOW),
    )
    expect(report.budget).toMatchObject({
      monthlyCostBudget: null,
      percent: null,
      level: null,
    })
  })

  it('shows the effective Z-API cost with zero volume (no division by zero)', async () => {
    fixtures({ zapiVolume: 0 })
    costs.totals.mockResolvedValue(
      ok({ messages: 0, templateMessages: 0, cost: 0 }),
    )
    costs.conversationCounts.mockResolvedValue(ok([]))
    costs.groupBy.mockResolvedValue(ok([]))
    costs.trend.mockResolvedValue(ok([]))
    costs.sumCost.mockResolvedValue(ok(0))

    const report = expectOk(
      await WhatsAppCostService.report('u1', 'ws1', query, NOW),
    )
    const zapi = report.byProvider[1]
    expect(zapi).toMatchObject({
      messages: 0,
      fee: 100,
      totalCost: 100,
      costPerMessage: 0,
      costPerConversation: 0,
    })
    expect(report.totals).toMatchObject({
      costPerConversation: 0,
      costPerResolvedConversation: 0,
    })
    expect(Number.isFinite(report.projection.monthCost)).toBe(true)
  })

  it('filters by connection', async () => {
    fixtures()
    const report = expectOk(
      await WhatsAppCostService.report(
        'u1',
        'ws1',
        { ...query, connectionId: 'conn-meta' },
        NOW,
      ),
    )
    expect(report.byConnection.map((r) => r.connectionId)).toEqual([
      'conn-meta',
    ])
    expect(report.connectionId).toBe('conn-meta')
    expect(costs.totals).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-meta' }),
    )
  })

  it('propagates a failure from any aggregation', async () => {
    const steps: (() => void)[] = [
      () => costs.totals.mockResolvedValue(err(databaseError('x'))),
      () => costs.trend.mockResolvedValue(err(databaseError('x'))),
      () => costs.conversationCounts.mockResolvedValue(err(databaseError('x'))),
      () => costs.listConnections.mockResolvedValue(err(databaseError('x'))),
      () => costs.sumCost.mockResolvedValue(err(databaseError('x'))),
      () =>
        settingsRepo.findByWorkspace.mockResolvedValue(err(databaseError('x'))),
      () => costs.broadcastNames.mockResolvedValue(err(databaseError('x'))),
      () => costs.aiCampaignNames.mockResolvedValue(err(databaseError('x'))),
      () => costs.userNames.mockResolvedValue(err(databaseError('x'))),
    ]
    for (const fail of steps) {
      fixtures()
      fail()
      expectErr(
        await WhatsAppCostService.report('u1', 'ws1', query, NOW),
        'DATABASE_ERROR',
      )
    }

    for (const field of [
      'connectionId',
      'category',
      'broadcastId',
      'aiCampaignId',
      'userId',
      'source',
    ]) {
      fixtures()
      const original = costs.groupBy.getMockImplementation()
      costs.groupBy.mockImplementation(async (f, by) =>
        by === field
          ? err(databaseError('x'))
          : (original as (f: unknown, by: string) => unknown)(f, by),
      )
      expectErr(
        await WhatsAppCostService.report('u1', 'ws1', query, NOW),
        'DATABASE_ERROR',
      )
    }
  })

  it('exports a pt-BR CSV with the same sections', async () => {
    fixtures()
    const csv = expectOk(
      await WhatsAppCostService.exportCsv('u1', 'ws1', query, NOW),
    )
    expect(csv.startsWith('﻿Seção;Item;Mensagens;Custo (R$);Observação')).toBe(
      true,
    )
    expect(csv).toContain('Total;2026-10-01 a 2026-10-10;300;136,25')
    expect(csv).toContain('Conexão;Z-API vendas (Z-API);200;100;')
    expect(csv).toContain('Transmissão;Black Friday;80;29;')
    expect(csv).toContain('Dia;2026-10-02;60;26,12;')
    expect(csv).toContain('Estimativa;')
  })

  it('quotes CSV cells that hold separators or quotes', async () => {
    fixtures()
    costs.broadcastNames.mockResolvedValue(
      ok(new Map([['b1', 'Promo; "50%"']])),
    )
    const csv = expectOk(
      await WhatsAppCostService.exportCsv('u1', 'ws1', query, NOW),
    )
    expect(csv).toContain('"Promo; ""50%"""')
  })

  it('does not export when the report fails', async () => {
    fixtures()
    costs.totals.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCostService.exportCsv('u1', 'ws1', query, NOW),
      'DATABASE_ERROR',
    )
  })
})
