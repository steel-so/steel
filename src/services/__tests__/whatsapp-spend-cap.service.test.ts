import type {
  WhatsAppMetaSpendSnapshot,
  WhatsAppSpendCap,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-spend-cap.repository')
vi.mock('@/src/repositories/whatsapp-cost.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/cache/whatsapp-meta-spend.cache', () => ({
  WhatsAppMetaSpendCache: { claim: vi.fn(), release: vi.fn() },
}))
vi.mock('../whatsapp-meta-spend.service', () => ({
  WhatsAppMetaSpendService: { refresh: vi.fn() },
}))
vi.mock('../whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
  whatsAppAdminIds: vi.fn(async () => ['admin1']),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppMetaSpendCache } from '@/src/cache/whatsapp-meta-spend.cache'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppCostRepository } from '@/src/repositories/whatsapp-cost.repository'
import { WhatsAppSpendCapRepository } from '@/src/repositories/whatsapp-spend-cap.repository'
import { WhatsAppMetaSpendService } from '../whatsapp-meta-spend.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'
import {
  type SpendCapCheck,
  WhatsAppSpendCapService,
} from '../whatsapp-spend-cap.service'

const memberships = vi.mocked(MembershipRepository)
const repo = vi.mocked(WhatsAppSpendCapRepository)
const costs = vi.mocked(WhatsAppCostRepository)
const connections = vi.mocked(WhatsAppConnectionRepository)
const metaSpend = vi.mocked(WhatsAppMetaSpendService)
const notify = vi.mocked(notifyWhatsAppUsers)

const NOW = new Date('2026-11-11T15:00:00Z')
const meta = createFakeWhatsAppConnection({
  id: 'conn-meta',
  workspaceId: 'ws1',
  provider: 'META',
  label: 'Fidelizza+',
})

function cap(
  amount: number,
  capMode: 'WARN' | 'BLOCK' = 'BLOCK',
): WhatsAppSpendCap {
  return {
    id: 'cap1',
    workspaceId: 'ws1',
    connectionId: 'conn-meta',
    monthlyCapAmount: amount as never,
    capMode,
    updatedById: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function snapshot(cost: number): WhatsAppMetaSpendSnapshot {
  return {
    id: 's1',
    workspaceId: 'ws1',
    connectionId: 'conn-meta',
    month: '2026-11',
    cost: cost as never,
    currency: 'BRL',
    source: 'META_VOLUME',
    byCategory: [],
    periodStart: new Date('2026-11-01T00:00:00Z'),
    periodEnd: new Date('2026-11-11T00:00:00Z'),
    fetchedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function asRole(role: 'VIEWER' | 'MEMBER' | 'ADMIN' | 'OWNER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const fresh = { snapshot: null, refreshed: true, stale: false, reason: null }

beforeEach(() => {
  vi.clearAllMocks()
  asRole('OWNER')
  repo.findCap.mockResolvedValue(ok(cap(1500)))
  repo.findSnapshot.mockResolvedValue(ok(snapshot(1400)))
  repo.sumLedgerSince.mockResolvedValue(ok(50))
  repo.listCaps.mockResolvedValue(ok([cap(1500)]))
  repo.listMetaConnections.mockResolvedValue(ok([meta]))
  repo.listCappedConnections.mockResolvedValue(ok([meta]))
  repo.reverseFailedEntries.mockResolvedValue(ok(1))
  costs.listPrices.mockResolvedValue(ok([]))
  connections.findById.mockResolvedValue(ok(meta))
  metaSpend.refresh.mockResolvedValue(ok(fresh))
})

describe('checkSend() — the hot path', () => {
  const send = { to: '5511999990000', templateCategory: 'MARKETING' }

  it('lets a number without a cap send', async () => {
    repo.findCap.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppSpendCapService.checkSend(meta, send, NOW)),
    ).toBeNull()
    expect(repo.findSnapshot).not.toHaveBeenCalled()
  })

  it('adds the Meta snapshot and the ledger since its end', async () => {
    const check = expectOk(
      await WhatsAppSpendCapService.checkSend(meta, send, NOW),
    )
    expect(check).toEqual({
      connectionId: 'conn-meta',
      workspaceId: 'ws1',
      label: 'Fidelizza+',
      period: '2026-11',
      cap: 1500,
      capMode: 'BLOCK',
      spent: 1450,
      nextCost: 0.3217,
    })
    expect(repo.sumLedgerSince).toHaveBeenCalledWith(
      'conn-meta',
      new Date('2026-11-11T00:00:00Z'),
    )
  })

  it('uses the ledger since the month start while Meta was never read', async () => {
    repo.findSnapshot.mockResolvedValue(ok(null))
    const check = expectOk(
      await WhatsAppSpendCapService.checkSend(meta, send, NOW),
    )
    expect(check?.spent).toBe(50)
    expect(repo.sumLedgerSince).toHaveBeenCalledWith(
      'conn-meta',
      new Date('2026-11-01T00:00:00Z'),
    )
  })

  it('refuses a BLOCK send that would cross the cap', async () => {
    repo.sumLedgerSince.mockResolvedValue(ok(99.8))
    const error = expectErr(
      await WhatsAppSpendCapService.checkSend(meta, send, NOW),
      'WHATSAPP_SPEND_CAP_REACHED',
    )
    expect(error.message).toContain('1.499,80')
    expect(error.details).toEqual({ cap: 1500, spent: 1499.8 })
    expect(logger.info).toHaveBeenCalledWith(
      'whatsapp.spend_cap.send_blocked',
      expect.anything(),
    )
  })

  it('still lets a cheaper utility template fit under the cap', async () => {
    repo.sumLedgerSince.mockResolvedValue(ok(99.8))
    const check = await WhatsAppSpendCapService.checkSend(
      meta,
      { to: '5511999990000', templateCategory: 'UTILITY' },
      NOW,
    )
    expect(expectOk(check)?.nextCost).toBe(0.035)
  })

  it('never blocks in WARN mode', async () => {
    repo.findCap.mockResolvedValue(ok(cap(1000, 'WARN')))
    const check = expectOk(
      await WhatsAppSpendCapService.checkSend(meta, send, NOW),
    )
    expect(check?.capMode).toBe('WARN')
  })

  it('prices with the workspace table and the Lite price', async () => {
    costs.listPrices.mockResolvedValue(
      ok([
        {
          category: 'MARKETING',
          country: 'BR',
          currency: 'BRL',
          unitPrice: 0.5,
          liteUnitPrice: 0.4,
          validFrom: new Date('2026-01-01T00:00:00Z'),
        } as never,
      ]),
    )
    const regular = await WhatsAppSpendCapService.checkSend(meta, send, NOW)
    expect(expectOk(regular)?.nextCost).toBe(0.5)
    const lite = await WhatsAppSpendCapService.checkSend(
      meta,
      { ...send, lite: true },
      NOW,
    )
    expect(expectOk(lite)?.nextCost).toBe(0.4)
  })

  it('fails closed on database errors', async () => {
    repo.findCap.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppSpendCapService.checkSend(meta, send, NOW),
      'DATABASE_ERROR',
    )
    repo.findSnapshot.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppSpendCapService.checkSend(meta, send, NOW),
      'DATABASE_ERROR',
    )
    repo.sumLedgerSince.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppSpendCapService.checkSend(meta, send, NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('afterSend() — 80/100% notices', () => {
  const check: SpendCapCheck = {
    connectionId: 'conn-meta',
    workspaceId: 'ws1',
    label: 'Fidelizza+',
    period: '2026-11',
    cap: 1500,
    capMode: 'BLOCK',
    spent: 1199.9,
    nextCost: 0.3217,
  }

  it('stays quiet under 80%', async () => {
    await WhatsAppSpendCapService.afterSend({ ...check, spent: 100 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('warns once per number, month and level at 80%', async () => {
    await WhatsAppSpendCapService.afterSend(check)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        kind: 'WHATSAPP_COST_BUDGET_WARNING',
        userIds: ['admin1'],
        title: 'Fidelizza+ em 80% do limite de gasto',
        path: '/zap/reports?aba=custos',
        dedupeKey: 'whatsapp-spend-cap:conn-meta:2026-11:80',
      }),
    )
    expect(notify.mock.calls[0][0].body).toContain('continuam normalmente')
  })

  it('says the sends are blocked at 100% in BLOCK mode', async () => {
    await WhatsAppSpendCapService.afterSend({ ...check, spent: 1500 })
    const input = notify.mock.calls[0][0]
    expect(input.kind).toBe('WHATSAPP_COST_BUDGET_REACHED')
    expect(input.dedupeKey).toBe('whatsapp-spend-cap:conn-meta:2026-11:100')
    expect(input.body).toContain('estão bloqueados')
  })

  it('keeps sending at 100% in WARN mode and never throws', async () => {
    await WhatsAppSpendCapService.afterSend({
      ...check,
      capMode: 'WARN',
      spent: 1600,
    })
    expect(notify.mock.calls[0][0].body).toContain('continuam normalmente')

    notify.mockRejectedValueOnce(new Error('inbox down'))
    await expect(
      WhatsAppSpendCapService.afterSend({ ...check, spent: 1600 }),
    ).resolves.toBeUndefined()
    notify.mockRejectedValueOnce('inbox down')
    await expect(
      WhatsAppSpendCapService.afterSend({ ...check, spent: 1600 }),
    ).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.spend_cap.notify_failed',
      expect.anything(),
    )
  })
})

describe('onMessageFailed() — ledger reversal', () => {
  it('zeroes the entry of a failed message', async () => {
    await WhatsAppSpendCapService.onMessageFailed('wamid.1', NOW)
    expect(repo.reverseFailedEntries).toHaveBeenCalledWith('wamid.1', NOW)
  })

  it('never throws, only logs', async () => {
    repo.reverseFailedEntries.mockResolvedValueOnce(err(databaseError('x')))
    await WhatsAppSpendCapService.onMessageFailed('wamid.1')
    repo.reverseFailedEntries.mockRejectedValueOnce(new Error('boom'))
    await WhatsAppSpendCapService.onMessageFailed('wamid.1')
    repo.reverseFailedEntries.mockRejectedValueOnce('boom')
    await WhatsAppSpendCapService.onMessageFailed('wamid.1')
    expect(logger.warn).toHaveBeenCalledTimes(3)
  })
})

describe('list()', () => {
  it('refreshes Meta and returns each number against its cap', async () => {
    const other = createFakeWhatsAppConnection({
      id: 'conn-2',
      workspaceId: 'ws1',
      provider: 'META',
    })
    repo.listMetaConnections.mockResolvedValue(ok([meta, other]))
    metaSpend.refresh
      .mockResolvedValueOnce(ok(fresh))
      .mockResolvedValueOnce(
        ok({ ...fresh, refreshed: false, stale: true, reason: 'Meta fora' }),
      )

    const rows = expectOk(
      await WhatsAppSpendCapService.list('u1', 'ws1', {}, NOW),
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      connectionId: 'conn-meta',
      spent: 1450,
      monthlyCapAmount: 1500,
      level: 80,
      status: 'ALLOWED',
    })
    expect(rows[1]).toMatchObject({
      connectionId: 'conn-2',
      status: 'NO_CAP',
      stale: true,
      staleReason: 'Meta fora',
    })
    expect(metaSpend.refresh).toHaveBeenCalledWith(meta, NOW)
    // 80% reached on the capped number: one (deduped) notice.
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('filters one number', async () => {
    const other = createFakeWhatsAppConnection({ id: 'conn-2' })
    repo.listMetaConnections.mockResolvedValue(ok([meta, other]))
    const rows = expectOk(
      await WhatsAppSpendCapService.list(
        'u1',
        'ws1',
        { connectionId: 'conn-2' },
        NOW,
      ),
    )
    expect(rows.map((row) => row.connectionId)).toEqual(['conn-2'])
  })

  it('is restricted to OWNER/ADMIN', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppSpendCapService.list('u1', 'ws1'), 'FORBIDDEN')
    expect(metaSpend.refresh).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    const run = () => WhatsAppSpendCapService.list('u1', 'ws1')
    repo.listMetaConnections.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await run(), 'DATABASE_ERROR')
    repo.listCaps.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await run(), 'DATABASE_ERROR')
    metaSpend.refresh.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await run(), 'DATABASE_ERROR')
    repo.findSnapshot.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await run(), 'DATABASE_ERROR')
  })
})

describe('update()', () => {
  const dto = { monthlyCapAmount: 1500, capMode: 'BLOCK' as const }

  it('saves the cap, audits it and forgets the 60 s cache', async () => {
    repo.upsertCap.mockResolvedValue(ok(cap(1500)))
    const saved = await WhatsAppSpendCapService.update(
      'u1',
      'ws1',
      'conn-meta',
      dto,
      NOW,
    )
    const status = expectOk(saved)
    expect(repo.upsertCap).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      connectionId: 'conn-meta',
      monthlyCapAmount: 1500,
      capMode: 'BLOCK',
      updatedById: 'u1',
    })
    expect(status).toMatchObject({ monthlyCapAmount: 1500, capMode: 'BLOCK' })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_spend_cap',
        action: 'update',
        targetId: 'conn-meta',
      }),
    )
    expect(WhatsAppMetaSpendCache.release).toHaveBeenCalledWith('conn-meta')
  })

  it('removes the cap with null', async () => {
    repo.deleteCap.mockResolvedValue(ok(true))
    const status = expectOk(
      await WhatsAppSpendCapService.update(
        'u1',
        'ws1',
        'conn-meta',
        { monthlyCapAmount: null, capMode: 'WARN' },
        NOW,
      ),
    )
    expect(repo.deleteCap).toHaveBeenCalledWith('ws1', 'conn-meta')
    expect(status.status).toBe('NO_CAP')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    )
  })

  it('refuses a missing, foreign or Z-API number', async () => {
    connections.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppSpendCapService.update('u1', 'ws1', 'x', dto),
      'RESOURCE_NOT_FOUND',
    )
    connections.findById.mockResolvedValueOnce(
      ok(createFakeWhatsAppConnection({ provider: 'ZAPI' })),
    )
    expectErr(
      await WhatsAppSpendCapService.update('u1', 'ws1', 'x', dto),
      'VALIDATION_ERROR',
    )
    expect(repo.upsertCap).not.toHaveBeenCalled()
  })

  it('is restricted to OWNER/ADMIN', async () => {
    asRole('VIEWER')
    expectErr(
      await WhatsAppSpendCapService.update('u1', 'ws1', 'conn-meta', dto),
      'FORBIDDEN',
    )
  })

  it('propagates database errors', async () => {
    const run = () =>
      WhatsAppSpendCapService.update('u1', 'ws1', 'conn-meta', dto)
    connections.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await run(), 'DATABASE_ERROR')
    repo.upsertCap.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await run(), 'DATABASE_ERROR')
    repo.deleteCap.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppSpendCapService.update('u1', 'ws1', 'conn-meta', {
        monthlyCapAmount: null,
        capMode: 'WARN',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('refreshTick() — worker', () => {
  it('refreshes every capped number and re-checks the levels', async () => {
    const result = await WhatsAppSpendCapService.refreshTick(NOW)
    expect(result).toEqual({ connections: 1, refreshed: 1, failed: 0 })
    expect(metaSpend.refresh).toHaveBeenCalledWith(meta, NOW)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'whatsapp-spend-cap:conn-meta:2026-11:80',
      }),
    )
  })

  it('counts failed and stale reads, still checking the stale ones', async () => {
    const other = createFakeWhatsAppConnection({
      id: 'conn-2',
      provider: 'META',
    })
    repo.listCappedConnections.mockResolvedValue(ok([meta, other]))
    metaSpend.refresh
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValueOnce(
        ok({ ...fresh, refreshed: false, stale: true, reason: 'x' }),
      )
    repo.findCap.mockResolvedValueOnce(ok(null))

    const result = await WhatsAppSpendCapService.refreshTick(NOW)
    expect(result).toEqual({ connections: 2, refreshed: 0, failed: 2 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('never throws when the listing fails', async () => {
    repo.listCappedConnections.mockResolvedValue(err(databaseError('x')))
    expect(await WhatsAppSpendCapService.refreshTick()).toEqual({
      connections: 0,
      refreshed: 0,
      failed: 0,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.spend_cap.tick_failed',
      expect.anything(),
    )
  })
})
