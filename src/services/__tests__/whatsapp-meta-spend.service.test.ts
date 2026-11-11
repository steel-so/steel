import type { WhatsAppMetaSpendSnapshot } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/whatsapp-spend-cap.repository')
vi.mock('@/src/repositories/whatsapp-cost.repository')
vi.mock('@/src/cache/whatsapp-meta-spend.cache', () => ({
  WhatsAppMetaSpendCache: { claim: vi.fn(), release: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/marketing-lite', () => ({
  metaCredentialsOf: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/meta-pricing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchMetaSpend: vi.fn(),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { WhatsAppMetaSpendCache } from '@/src/cache/whatsapp-meta-spend.cache'
import { metaCredentialsOf } from '@/src/lib/whatsapp/marketing-lite'
import { MetaApiError } from '@/src/lib/whatsapp/meta-client'
import { fetchMetaSpend } from '@/src/lib/whatsapp/meta-pricing'
import { WhatsAppCostRepository } from '@/src/repositories/whatsapp-cost.repository'
import { WhatsAppSpendCapRepository } from '@/src/repositories/whatsapp-spend-cap.repository'
import { WhatsAppMetaSpendService } from '../whatsapp-meta-spend.service'

const repo = vi.mocked(WhatsAppSpendCapRepository)
const costs = vi.mocked(WhatsAppCostRepository)
const cache = vi.mocked(WhatsAppMetaSpendCache)
const credentialsOf = vi.mocked(metaCredentialsOf)
const fetchSpend = vi.mocked(fetchMetaSpend)

const NOW = new Date('2026-11-11T15:00:00Z')
const meta = createFakeWhatsAppConnection({
  id: 'conn-meta',
  workspaceId: 'ws1',
  provider: 'META',
  label: 'Fidelizza+',
})

function stored(
  overrides: Partial<WhatsAppMetaSpendSnapshot> = {},
): WhatsAppMetaSpendSnapshot {
  return {
    id: 's1',
    workspaceId: 'ws1',
    connectionId: 'conn-meta',
    month: '2026-11',
    cost: 120 as never,
    currency: 'BRL',
    source: 'META_VOLUME',
    byCategory: [],
    periodStart: new Date('2026-11-01T00:00:00Z'),
    periodEnd: new Date('2026-11-10T00:00:00Z'),
    fetchedAt: new Date('2026-11-10T15:00:00Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const reading = {
  source: 'META_VOLUME' as const,
  cost: 159.5632,
  currency: 'BRL',
  byCategory: [
    { category: 'MARKETING', volume: 496, billableVolume: 496, cost: 159.56 },
  ],
  periodStart: new Date('2026-11-01T00:00:00Z'),
  periodEnd: new Date('2026-11-11T00:00:00Z'),
  costRefusal: 'Application does not have permission for this action',
}

beforeEach(() => {
  vi.clearAllMocks()
  cache.claim.mockResolvedValue(true)
  credentialsOf.mockResolvedValue({
    phoneNumberId: 'pn',
    wabaId: 'waba',
    accessToken: 't',
  })
  costs.listPrices.mockResolvedValue(ok([]))
  repo.findSnapshot.mockResolvedValue(ok(stored()))
  repo.findLatestSnapshot.mockResolvedValue(ok(null))
  repo.upsertSnapshot.mockImplementation(async (input) =>
    ok(stored({ cost: input.cost as never, source: input.source })),
  )
})

describe('WhatsAppMetaSpendService.refresh()', () => {
  it('does nothing for a non-Meta connection', async () => {
    const zapi = createFakeWhatsAppConnection({ provider: 'ZAPI' })
    const result = await WhatsAppMetaSpendService.refresh(zapi, NOW)
    expect(expectOk(result)).toEqual({
      snapshot: null,
      refreshed: false,
      stale: false,
      reason: null,
    })
    expect(cache.claim).not.toHaveBeenCalled()
  })

  it('stores Meta’s reading (volume fallback) and logs the refusal', async () => {
    fetchSpend.mockResolvedValue(reading)

    const result = expectOk(await WhatsAppMetaSpendService.refresh(meta, NOW))

    expect(result).toMatchObject({ refreshed: true, stale: false })
    expect(Number(result.snapshot?.cost)).toBe(159.5632)
    expect(repo.upsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        connectionId: 'conn-meta',
        month: '2026-11',
        source: 'META_VOLUME',
        periodEnd: reading.periodEnd,
        fetchedAt: NOW,
      }),
    )
    // The workspace has no prices: the reference table is used.
    expect(fetchSpend.mock.calls[0][1][0]).toMatchObject({
      category: 'MARKETING',
      unitPrice: 0.3217,
    })
    expect(logger.info).toHaveBeenCalledWith(
      'whatsapp.meta_spend.cost_refused',
      expect.anything(),
    )
  })

  it('prices with the workspace table when it has rows', async () => {
    costs.listPrices.mockResolvedValue(
      ok([
        {
          category: 'MARKETING',
          country: 'BR',
          currency: 'BRL',
          unitPrice: 0.5,
          liteUnitPrice: null,
          validFrom: new Date('2026-01-01T00:00:00Z'),
        } as never,
      ]),
    )
    fetchSpend.mockResolvedValue({ ...reading, costRefusal: undefined })
    expectOk(await WhatsAppMetaSpendService.refresh(meta, NOW))
    expect(fetchSpend.mock.calls[0][1]).toEqual([
      expect.objectContaining({ unitPrice: 0.5 }),
    ])
    expect(logger.info).not.toHaveBeenCalledWith(
      'whatsapp.meta_spend.cost_refused',
      expect.anything(),
    )
  })

  it('reuses the stored snapshot when Meta was read in the last 60 s', async () => {
    cache.claim.mockResolvedValue(false)
    const result = expectOk(await WhatsAppMetaSpendService.refresh(meta, NOW))
    expect(result).toEqual({
      snapshot: stored(),
      refreshed: false,
      stale: false,
      reason: null,
    })
    expect(fetchSpend).not.toHaveBeenCalled()
  })

  it('keeps the last snapshot when Meta fails (never zeroes the spend)', async () => {
    fetchSpend.mockRejectedValue(new MetaApiError('down', 503))
    const result = expectOk(await WhatsAppMetaSpendService.refresh(meta, NOW))
    expect(result).toMatchObject({
      refreshed: false,
      stale: true,
      reason: expect.stringContaining('instável'),
    })
    expect(Number(result.snapshot?.cost)).toBe(120)
    expect(repo.upsertSnapshot).not.toHaveBeenCalled()
  })

  it('treats a connection without credentials as a failed read', async () => {
    credentialsOf.mockResolvedValue(null)
    const result = expectOk(await WhatsAppMetaSpendService.refresh(meta, NOW))
    expect(result.stale).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.meta_spend.fetch_failed',
      expect.anything(),
    )

    credentialsOf.mockRejectedValue('bad secret')
    const again = await WhatsAppMetaSpendService.refresh(meta, NOW)
    expect(expectOk(again).stale).toBe(true)
  })

  it('stores a zero reading on day one, keeping the previous source', async () => {
    fetchSpend.mockResolvedValue(null)
    repo.findLatestSnapshot.mockResolvedValue(
      ok(stored({ month: '2026-10', source: 'META_COST', currency: 'USD' })),
    )
    expectOk(await WhatsAppMetaSpendService.refresh(meta, NOW))
    expect(repo.upsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        cost: 0,
        source: 'META_COST',
        currency: 'USD',
        byCategory: [],
      }),
    )

    repo.findLatestSnapshot.mockResolvedValue(err(databaseError('x')))
    expectOk(await WhatsAppMetaSpendService.refresh(meta, NOW))
    expect(repo.upsertSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'META_VOLUME', currency: 'BRL' }),
    )
  })

  it('propagates database errors', async () => {
    const run = () => WhatsAppMetaSpendService.refresh(meta, NOW)
    cache.claim.mockResolvedValue(false)
    repo.findSnapshot.mockResolvedValue(err(databaseError('x')))
    expectErr(await run(), 'DATABASE_ERROR')

    cache.claim.mockResolvedValue(true)
    fetchSpend.mockRejectedValue(new Error('down'))
    expectErr(await run(), 'DATABASE_ERROR')

    fetchSpend.mockResolvedValue(reading)
    repo.upsertSnapshot.mockResolvedValue(err(databaseError('x')))
    expectErr(await run(), 'DATABASE_ERROR')
  })

  it('shares one in-flight read per number', async () => {
    let release: (value: typeof reading) => void = () => undefined
    fetchSpend.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const first = WhatsAppMetaSpendService.refresh(meta, NOW)
    const second = WhatsAppMetaSpendService.refresh(meta, NOW)
    await vi.waitFor(() => expect(fetchSpend).toHaveBeenCalled())
    release(reading)
    expect(await first).toEqual(await second)
    expect(cache.claim).toHaveBeenCalledTimes(1)
    expect(fetchSpend).toHaveBeenCalledTimes(1)
  })
})
