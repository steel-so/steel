import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const env = vi.hoisted(() => ({
  PIX_PROVIDER: 'abacatepay' as string | undefined,
  PIX_WEBHOOK_SECRET: 'secret-secret-secret' as string | undefined,
  ABACATE_PAY: 'abc_dev_key' as string | undefined,
  ABACATE_PAY_CANCEL_PATH: undefined,
}))
vi.mock('@/lib/env/server', () => env)

import {
  ABACATEPAY_SIGNATURE_HEADER,
  signAbacatePayBody,
} from '../abacatepay-webhook'
import {
  ABACATEPAY_PIX_PROVIDER_ID,
  createAbacatePayPixProvider,
} from '../pix/abacatepay-provider'
import { getActivePixProvider, getPixProviderById } from '../pix/registry'

const SECRET = 'secret-secret-secret'
const fetchMock = vi.fn()

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

function call(body: unknown, opts: { secret?: string | null; sig?: string | null } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const headers = new Headers()
  const sig = opts.sig === undefined ? signAbacatePayBody(raw) : opts.sig
  if (sig) headers.set(ABACATEPAY_SIGNATURE_HEADER, sig)
  const query = new URLSearchParams()
  const secret = opts.secret === undefined ? SECRET : opts.secret
  if (secret) query.set('webhookSecret', secret)
  return { headers, raw, query }
}

describe('AbacatePay Pix provider', () => {
  const provider = createAbacatePayPixProvider(SECRET)
  const input = {
    txid: 'a'.repeat(32),
    amount: 150.5,
    description: 'Mensalidade',
    expiresAt: new Date(Date.now() + 3_600_000),
  }

  beforeEach(() => {
    env.ABACATE_PAY = 'abc_dev_key'
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is a real provider', () => {
    expect(provider.id).toBe(ABACATEPAY_PIX_PROVIDER_ID)
    expect(provider.isTest).toBe(false)
  })

  it('creates a charge in cents with the txid as externalId', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 'pix_char_1', brCode: '000201' } }),
    )
    const charge = expectOk(await provider.createCharge(input))
    expect(charge).toEqual({ providerChargeId: 'pix_char_1', brCode: '000201' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.abacatepay.com/v2/transparents/create')
    expect(init.headers.Authorization).toBe('Bearer abc_dev_key')
    const body = JSON.parse(init.body)
    expect(body.method).toBe('PIX')
    expect(body.data.amount).toBe(15050)
    expect(body.data.externalId).toBe(input.txid)
    expect(body.data.expiresIn).toBeGreaterThan(3500)
  })

  it('refuses a missing key, a tiny amount and PSP failures', async () => {
    env.ABACATE_PAY = undefined
    expectErr(await provider.createCharge(input), 'PIX_PROVIDER_ERROR')
    env.ABACATE_PAY = 'abc_dev_key'
    expectErr(
      await provider.createCharge({ ...input, amount: 0.5 }),
      'PIX_PROVIDER_ERROR',
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, data: null }))
    expectErr(await provider.createCharge(input), 'PIX_PROVIDER_ERROR')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 'x' } }),
    )
    expectErr(await provider.createCharge(input), 'PIX_PROVIDER_ERROR')
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, false, 401))
    expectErr(await provider.createCharge(input), 'PIX_PROVIDER_ERROR')
  })

  it('clamps a past expiry to one minute', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 'p', brCode: 'b' } }),
    )
    await provider.createCharge({ ...input, expiresAt: new Date(0) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).data.expiresIn).toBe(60)
  })

  it('cancel is a no-op (no cancel route at AbacatePay)', async () => {
    expectOk(await provider.cancelCharge('pix_char_1'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the charge status', async () => {
    const check = provider.getChargeStatus
    if (!check) throw new Error('getChargeStatus missing')
    for (const [raw, mapped] of [
      ['PAID', 'PAID'],
      ['EXPIRED', 'EXPIRED'],
      ['CANCELLED', 'CANCELLED'],
      ['PENDING', 'PENDING'],
      ['REFUNDED', 'PENDING'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, data: { id: 'p', status: raw } }),
      )
      expect(expectOk(await check('pix_char_1'))).toBe(mapped)
    }
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.abacatepay.com/v2/transparents/check?id=pix_char_1',
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, data: null }))
    expectErr(await check('x'), 'PIX_PROVIDER_ERROR')
    fetchMock.mockRejectedValueOnce(new Error('network'))
    expectErr(await check('x'), 'PIX_PROVIDER_ERROR')
  })

  describe('parseWebhook', () => {
    const paid = {
      id: 'log_1',
      event: 'transparent.completed',
      apiVersion: 2,
      devMode: true,
      data: {
        transparent: { id: 'pix_char_1', amount: 15050, updatedAt: '2026-10-31T12:00:00.000Z' },
        payerInformation: { method: 'PIX', PIX: { name: 'Maria' } },
      },
    }

    it('settles a paid event', () => {
      const c = call(paid)
      const [n] = expectOk(provider.parseWebhook(c.headers, c.raw, c.query))
      expect(n).toEqual({
        providerChargeId: 'pix_char_1',
        paidAmount: 150.5,
        paidAt: new Date('2026-10-31T12:00:00.000Z'),
        endToEndId: null,
        payerName: 'Maria',
      })
    })

    it('accepts a flat payload and paidAmount, with defaults', () => {
      const c = call({
        event: 'transparent.completed',
        data: { id: 'pix_char_2', amount: 100, paidAmount: 200, updatedAt: 'bad' },
      })
      const [n] = expectOk(provider.parseWebhook(c.headers, c.raw, c.query))
      expect(n.providerChargeId).toBe('pix_char_2')
      expect(n.paidAmount).toBe(2)
      expect(n.payerName).toBeNull()
      expect(Number.isNaN(n.paidAt.getTime())).toBe(false)
      const d = call({
        event: 'transparent.completed',
        data: { checkout: { id: 'c', amount: 100 } },
      })
      expect(expectOk(provider.parseWebhook(d.headers, d.raw, d.query))[0].providerChargeId).toBe('c')
    })

    it('ignores other events once authenticated', () => {
      const c = call({ event: 'transparent.refunded', data: {} })
      expect(expectOk(provider.parseWebhook(c.headers, c.raw, c.query))).toEqual([])
    })

    it('rejects bad secret, bad signature and bad bodies', () => {
      const bad = (c: ReturnType<typeof call>, p = provider) =>
        expectErr(p.parseWebhook(c.headers, c.raw, c.query), 'PIX_WEBHOOK_INVALID')
      bad(call(paid), createAbacatePayPixProvider(undefined))
      bad(call(paid, { secret: null }))
      bad(call(paid, { secret: 'other-secret-value' }))
      bad(call(paid, { sig: null }))
      bad(call(paid, { sig: 'AAAA' }))
      expectErr(
        provider.parseWebhook(call(paid).headers, call(paid).raw),
        'PIX_WEBHOOK_INVALID',
      )
      bad(call('not json'))
      bad(call({ foo: 1 }))
      bad(call({ event: 'transparent.completed', data: { amount: 100 } }))
      bad(call({ event: 'transparent.completed', data: { id: 'x' } }))
    })
  })

  it('is registered', () => {
    expect(expectOk(getPixProviderById('abacatepay')).id).toBe('abacatepay')
    expect(expectOk(getActivePixProvider()).id).toBe('abacatepay')
  })
})
