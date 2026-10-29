import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const env = vi.hoisted(() => ({
  PIX_PROVIDER: 'mock',
  PIX_WEBHOOK_SECRET: 'secret-secret-secret' as string | undefined,
}))
vi.mock('@/lib/env/server', () => env)

import { isValidBrCode } from '../pix/br-code'
import {
  createMockPixProvider,
  MOCK_PIX_PROVIDER_ID,
  MOCK_PIX_SIGNATURE_HEADER,
  signMockPixBody,
} from '../pix/mock-provider'
import { getActivePixProvider, getPixProviderById } from '../pix/registry'

const SECRET = 'secret-secret-secret'

function signedHeaders(body: string, secret = SECRET): Headers {
  return new Headers({
    [MOCK_PIX_SIGNATURE_HEADER]: signMockPixBody(secret, body),
  })
}

describe('mock Pix provider', () => {
  const provider = createMockPixProvider(SECRET)

  it('is a test provider that issues a valid BR Code', async () => {
    expect(provider.id).toBe(MOCK_PIX_PROVIDER_ID)
    expect(provider.isTest).toBe(true)
    const charge = expectOk(
      await provider.createCharge({
        txid: 'a'.repeat(32),
        amount: 150,
        description: 'Mensalidade',
        expiresAt: new Date(),
      }),
    )
    expect(charge.providerChargeId).toBe('a'.repeat(32))
    expect(isValidBrCode(charge.brCode)).toBe(true)
    expect(charge.brCode).toContain('150.00')
  })

  it('cancels without side effects', async () => {
    expectOk(await provider.cancelCharge('x'))
  })

  describe('parseWebhook()', () => {
    const body = JSON.stringify({
      providerChargeId: 'tx1',
      paidAmount: 150,
      paidAt: '2026-11-12T12:00:00.000Z',
      endToEndId: 'E1',
      payerName: 'Maria',
    })

    it('accepts a correctly signed payment', () => {
      const [notice] = expectOk(
        provider.parseWebhook(signedHeaders(body), body),
      )
      expect(notice).toEqual({
        providerChargeId: 'tx1',
        paidAmount: 150,
        paidAt: new Date('2026-11-12T12:00:00.000Z'),
        endToEndId: 'E1',
        payerName: 'Maria',
      })
    })

    it('defaults the optional fields', () => {
      const minimal = JSON.stringify({ providerChargeId: 'tx1', paidAmount: 5 })
      const [notice] = expectOk(
        provider.parseWebhook(signedHeaders(minimal), minimal),
      )
      expect(notice.endToEndId).toBeNull()
      expect(notice.payerName).toBeNull()
      expect(notice.paidAt).toBeInstanceOf(Date)
    })

    it('refuses a missing, wrong or foreign signature', () => {
      expectErr(
        provider.parseWebhook(new Headers(), body),
        'PIX_WEBHOOK_INVALID',
      )
      expectErr(
        provider.parseWebhook(
          new Headers({ [MOCK_PIX_SIGNATURE_HEADER]: 'abc' }),
          body,
        ),
        'PIX_WEBHOOK_INVALID',
      )
      expectErr(
        provider.parseWebhook(signedHeaders(body, 'other-secret-here!'), body),
        'PIX_WEBHOOK_INVALID',
      )
    })

    it('refuses a signed body that is not valid JSON or not a payment', () => {
      expectErr(
        provider.parseWebhook(signedHeaders('nope'), 'nope'),
        'PIX_WEBHOOK_INVALID',
      )
      const wrong = JSON.stringify({ hello: 'world' })
      expectErr(
        provider.parseWebhook(signedHeaders(wrong), wrong),
        'PIX_WEBHOOK_INVALID',
      )
    })

    it('refuses everything when no secret is configured', () => {
      const open = createMockPixProvider(undefined)
      expectErr(
        open.parseWebhook(signedHeaders(body, ''), body),
        'PIX_WEBHOOK_INVALID',
      )
    })
  })
})

describe('Pix provider registry', () => {
  beforeEach(() => {
    env.PIX_PROVIDER = 'mock'
    env.PIX_WEBHOOK_SECRET = SECRET
  })

  it('resolves the mock provider by id and as the active one', () => {
    expect(expectOk(getPixProviderById('mock')).id).toBe('mock')
    expect(expectOk(getActivePixProvider()).id).toBe('mock')
  })

  it('wires the webhook secret from the environment', () => {
    const body = JSON.stringify({ providerChargeId: 't', paidAmount: 1 })
    const provider = expectOk(getPixProviderById('mock'))
    expectOk(provider.parseWebhook(signedHeaders(body), body))
  })

  it('rejects an unknown provider', () => {
    expectErr(getPixProviderById('acme'), 'PIX_PROVIDER_ERROR')
    env.PIX_PROVIDER = 'acme'
    expectErr(getActivePixProvider(), 'PIX_PROVIDER_ERROR')
  })
})
