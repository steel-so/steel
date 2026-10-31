import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const env = vi.hoisted(() => ({
  BOLETO_PROVIDER: 'mock' as string | undefined,
  BOLETO_WEBHOOK_SECRET: 'secret-secret-secret' as string | undefined,
  ABACATE_PAY: 'abc_dev_key' as string | undefined,
  ABACATE_PAY_CANCEL_PATH: undefined,
}))
vi.mock('@/lib/env/server', () => env)

import { signAbacatePayBody } from '../abacatepay-webhook'
import {
  ABACATEPAY_BOLETO_PROVIDER_ID,
  createAbacatePayBoletoProvider,
} from '../boleto/abacatepay-provider'
import {
  createMockBoletoProvider,
  MOCK_BOLETO_SIGNATURE_HEADER,
  signMockBoletoBody,
} from '../boleto/mock-provider'
import { getActiveBoletoProvider, getBoletoProviderById } from '../boleto/registry'

const SECRET = 'secret-secret-secret'
const fetchMock = vi.fn()
const res = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

const input = {
  reference: 'ref-123456789',
  amount: 250,
  description: 'Proposta 42',
  payer: { name: 'Maria', taxId: '111.444.777-35', email: 'm@x.com', cellphone: '11999999999' },
  dueDate: '2026-12-10',
}

describe('mock boleto provider', () => {
  const provider = createMockBoletoProvider(SECRET)

  it('issues a fake charge and stays pending', async () => {
    expect(provider.isTest).toBe(true)
    const charge = expectOk(await provider.createCharge(input))
    expect(charge.providerChargeId).toBe(input.reference)
    expect(charge.dueAt?.toISOString()).toBe('2026-12-10T23:59:59.999Z')
    expect(
      expectOk(await provider.createCharge({ ...input, dueDate: undefined })).dueAt,
    ).toBeNull()
    expect(expectOk(await provider.getChargeStatus('x'))).toBe('PENDING')
  })

  it('parses signed webhooks and rejects the rest', () => {
    const body = JSON.stringify({ kind: 'PAID', providerChargeId: 'b1', amount: 10, at: '2026-10-31T10:00:00.000Z' })
    const headers = new Headers({
      [MOCK_BOLETO_SIGNATURE_HEADER]: signMockBoletoBody(SECRET, body),
    })
    expect(expectOk(provider.parseWebhook(headers, body))[0]).toEqual({
      kind: 'PAID',
      providerChargeId: 'b1',
      amount: 10,
      at: new Date('2026-10-31T10:00:00.000Z'),
    })
    const bare = JSON.stringify({ kind: 'EXPIRED', providerChargeId: 'b2' })
    const [n] = expectOk(
      provider.parseWebhook(
        new Headers({ [MOCK_BOLETO_SIGNATURE_HEADER]: signMockBoletoBody(SECRET, bare) }),
        bare,
      ),
    )
    expect(n.amount).toBeNull()
    expectErr(provider.parseWebhook(new Headers(), body), 'BOLETO_WEBHOOK_INVALID')
    expectErr(
      createMockBoletoProvider(undefined).parseWebhook(headers, body),
      'BOLETO_WEBHOOK_INVALID',
    )
    for (const raw of ['nope', '{"kind":"X"}']) {
      expectErr(
        provider.parseWebhook(
          new Headers({ [MOCK_BOLETO_SIGNATURE_HEADER]: signMockBoletoBody(SECRET, raw) }),
          raw,
        ),
        'BOLETO_WEBHOOK_INVALID',
      )
    }
  })
})

describe('AbacatePay boleto provider', () => {
  const provider = createAbacatePayBoletoProvider(SECRET)

  beforeEach(() => {
    env.ABACATE_PAY = 'abc_dev_key'
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('creates a BOLETO charge in cents with interest and fine', async () => {
    fetchMock.mockResolvedValue(
      res({
        success: true,
        data: { id: 'bol_1', barCode: '1111', url: 'https://u', brCode: 'br', expiresAt: '2026-12-10T23:59:59.000Z' },
      }),
    )
    const charge = expectOk(
      await provider.createCharge({
        ...input,
        interestPercent: 1,
        fine: { type: 'PERCENTAGE', value: 2 },
      }),
    )
    expect(provider.id).toBe(ABACATEPAY_BOLETO_PROVIDER_ID)
    expect(charge).toMatchObject({ providerChargeId: 'bol_1', barCode: '1111', url: 'https://u', brCode: 'br' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.method).toBe('BOLETO')
    expect(body.data).toMatchObject({
      amount: 25000,
      dueDate: '2026-12-10',
      externalId: input.reference,
      interest: { value: 100 },
      fine: { type: 'PERCENTAGE', value: 200 },
      customer: { name: 'Maria', email: 'm@x.com', cellphone: '11999999999' },
    })
  })

  it('omits optional fields and tolerates missing links', async () => {
    fetchMock.mockResolvedValue(res({ success: true, data: { id: 'b', barCode: '1' } }))
    const charge = expectOk(
      await provider.createCharge({
        reference: 'r',
        amount: 10,
        description: 'd',
        payer: { name: 'A', taxId: '1' },
      }),
    )
    expect(charge).toMatchObject({ url: null, brCode: null, dueAt: null })
    const data = JSON.parse(fetchMock.mock.calls[0][1].body).data
    expect(data.dueDate).toBeUndefined()
    expect(data.interest).toBeUndefined()
    expect(data.customer.email).toBeUndefined()
    fetchMock.mockResolvedValue(
      res({ success: true, data: { id: 'b', barCode: '1' } }),
    )
    await provider.createCharge({
      reference: 'r', amount: 10, description: 'd', payer: { name: 'A', taxId: '1' },
      fine: { type: 'FIXED', value: 10 },
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).data.fine).toEqual({ type: 'FIXED', value: 1000 })
  })

  it('fails cleanly', async () => {
    env.ABACATE_PAY = undefined
    expectErr(await provider.createCharge(input), 'BOLETO_PROVIDER_ERROR')
    env.ABACATE_PAY = 'abc_dev_key'
    expectErr(await provider.createCharge({ ...input, amount: 0.5 }), 'BOLETO_PROVIDER_ERROR')
    fetchMock.mockResolvedValueOnce(res({ error: 'taxId inválido' }, false, 400))
    expectErr(await provider.createCharge(input), 'BOLETO_PROVIDER_ERROR')
    fetchMock.mockResolvedValueOnce(res({ success: true, data: { id: 'x' } }))
    expectErr(await provider.createCharge(input), 'BOLETO_PROVIDER_ERROR')
    fetchMock.mockResolvedValueOnce(res({ success: false, data: null, error: null }))
    expectErr(await provider.createCharge(input), 'BOLETO_PROVIDER_ERROR')
    fetchMock.mockRejectedValueOnce(new Error('net'))
    expectErr(await provider.createCharge(input), 'BOLETO_PROVIDER_ERROR')
  })

  it('maps the charge status', async () => {
    for (const [raw, mapped] of [
      ['PAID', 'PAID'], ['EXPIRED', 'EXPIRED'], ['CANCELLED', 'CANCELLED'],
      ['REFUNDED', 'REFUNDED'], ['PENDING', 'PENDING'], ['FAILED', 'PENDING'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(res({ success: true, data: { id: 'b', status: raw } }))
      expect(expectOk(await provider.getChargeStatus('bol_1'))).toBe(mapped)
    }
    fetchMock.mockResolvedValueOnce(res({ success: false, data: null }))
    expectErr(await provider.getChargeStatus('x'), 'BOLETO_PROVIDER_ERROR')
    fetchMock.mockRejectedValueOnce(new Error('net'))
    expectErr(await provider.getChargeStatus('x'), 'BOLETO_PROVIDER_ERROR')
  })

  describe('parseWebhook', () => {
    const call = (body: unknown, secret: string | null = SECRET, sig?: string) => {
      const raw = JSON.stringify(body)
      const headers = new Headers({ 'x-webhook-signature': sig ?? signAbacatePayBody(raw) })
      const query = new URLSearchParams(secret ? { webhookSecret: secret } : {})
      return provider.parseWebhook(headers, raw, query)
    }
    const data = { transparent: { id: 'bol_1', amount: 25000 } }

    it('maps paid, refunded and expired', () => {
      expect(expectOk(call({ event: 'transparent.completed', data }))[0]).toMatchObject({ kind: 'PAID', providerChargeId: 'bol_1', amount: 250 })
      expect(expectOk(call({ event: 'transparent.refunded', data }))[0].kind).toBe('REFUNDED')
      expect(expectOk(call({ event: 'transparent.expired', data }))[0].kind).toBe('EXPIRED')
      expect(expectOk(call({ event: 'transparent.completed', data: { id: 'x' } }))[0].amount).toBeNull()
    })

    it('ignores other events and rejects bad calls', () => {
      expect(expectOk(call({ event: 'transparent.disputed', data }))).toEqual([])
      expectErr(call({ event: 'transparent.completed', data: {} }), 'BOLETO_WEBHOOK_INVALID')
      expectErr(call({ event: 'transparent.completed', data }, null), 'BOLETO_WEBHOOK_INVALID')
      expectErr(call({ event: 'transparent.completed', data }, SECRET, 'AAAA'), 'BOLETO_WEBHOOK_INVALID')
    })
  })

  it('is registered', () => {
    expect(expectOk(getBoletoProviderById('abacatepay')).id).toBe('abacatepay')
    expect(expectOk(getBoletoProviderById('mock')).id).toBe('mock')
    expectErr(getBoletoProviderById('zzz'), 'BOLETO_PROVIDER_ERROR')
    expect(expectOk(getActiveBoletoProvider()).id).toBe('mock')
    env.BOLETO_PROVIDER = undefined
    expect(expectOk(getActiveBoletoProvider()).id).toBe('mock')
  })
})
