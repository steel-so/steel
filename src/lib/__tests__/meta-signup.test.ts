import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { evaluateMetaPhoneHealth } from '../whatsapp/meta-client'
import {
  exchangeSignupCode,
  fetchPhoneInfo,
  generateRegistrationPin,
  mapMetaSignupError,
  registerPhoneNumber,
  subscribeAppToWaba,
} from '../whatsapp/meta-signup'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('generateRegistrationPin', () => {
  it('returns six digits', () => {
    for (let i = 0; i < 20; i++)
      expect(generateRegistrationPin()).toMatch(/^\d{6}$/)
  })
})

describe('mapMetaSignupError', () => {
  it('maps payment, display name, permission and generic errors', () => {
    expect(mapMetaSignupError({ error: { code: 141006 } }, 'x').code).toBe(
      'WHATSAPP_SIGNUP_PAYMENT_REQUIRED',
    )
    expect(
      mapMetaSignupError(
        { error: { message: 'Display name not approved' } },
        'x',
      ).code,
    ).toBe('WHATSAPP_SIGNUP_NAME_NOT_APPROVED')
    expect(mapMetaSignupError({ error: { code: 200 } }, 'x').code).toBe(
      'WHATSAPP_SIGNUP_PERMISSION_DENIED',
    )
    expect(mapMetaSignupError(null, 'x').code).toBe('WHATSAPP_PROVIDER_ERROR')
  })
})

describe('Graph signup calls', () => {
  it('exchanges the code for a token', async () => {
    const fetchMock = mockFetch(200, { access_token: 'tok' })
    const result = await exchangeSignupCode({ appId: '1', appSecret: 's' }, 'c')
    expect(expectOk(result)).toBe('tok')
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('/oauth/access_token?')
  })

  it('fails the exchange on Graph errors, missing token and network errors', async () => {
    mockFetch(400, { error: { code: 190 } })
    expect(
      expectErr(await exchangeSignupCode({ appId: '1', appSecret: 's' }, 'c'))
        .code,
    ).toBe('WHATSAPP_SIGNUP_PERMISSION_DENIED')
    mockFetch(200, {})
    expectErr(await exchangeSignupCode({ appId: '1', appSecret: 's' }, 'c'))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    expectErr(await exchangeSignupCode({ appId: '1', appSecret: 's' }, 'c'))
  })

  it('subscribes the app to the WABA', async () => {
    mockFetch(200, { success: true })
    expectOk(await subscribeAppToWaba('t', 'waba'))
    mockFetch(400, { error: { code: 100 } })
    expectErr(await subscribeAppToWaba('t', 'waba'))
  })

  it('registers the number and treats "already registered" as success', async () => {
    const fetchMock = mockFetch(200, { success: true })
    expectOk(await registerPhoneNumber('t', 'pn', '123456'))
    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1]
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      pin: '123456',
    })
    mockFetch(400, { error: { message: 'Phone number is already registered' } })
    expectOk(await registerPhoneNumber('t', 'pn', '123456'))
    mockFetch(400, { error: { code: 141006 } })
    expect(expectErr(await registerPhoneNumber('t', 'pn', '123456')).code).toBe(
      'WHATSAPP_SIGNUP_PAYMENT_REQUIRED',
    )
  })

  it('reads the phone display data', async () => {
    mockFetch(200, {
      display_phone_number: '+55 11 99999-9999',
      verified_name: 'Fidelizza',
    })
    expect(expectOk(await fetchPhoneInfo('t', 'pn'))).toEqual({
      displayPhoneNumber: '5511999999999',
      verifiedName: 'Fidelizza',
    })
    mockFetch(200, {})
    expectErr(await fetchPhoneInfo('t', 'pn'))
    mockFetch(500, null)
    expectErr(await fetchPhoneInfo('t', 'pn'))
  })
})

describe('evaluateMetaPhoneHealth', () => {
  it('is connected for a CONNECTED number', () => {
    expect(evaluateMetaPhoneHealth({ status: 'CONNECTED' }).connected).toBe(
      true,
    )
  })
  it('flags blocked numbers with the known pt-BR reason', () => {
    const r = evaluateMetaPhoneHealth({
      status: 'CONNECTED',
      health_status: {
        can_send_message: 'BLOCKED',
        entities: [{ errors: [{ error_code: 141006 }] }],
      },
    })
    expect(r.failed).toBe(true)
    expect(r.error).toContain('pagamento')
  })
  it('falls back to the Meta description or a default for blocked numbers', () => {
    expect(
      evaluateMetaPhoneHealth({
        status: 'BANNED',
        health_status: {
          entities: [{ errors: [{ error_code: 1, error_description: 'x' }] }],
        },
      }).error,
    ).toBe('x')
    expect(evaluateMetaPhoneHealth({ status: 'BANNED' }).error).toContain(
      'BANNED',
    )
  })
  it('is disconnected (not failed) when not registered yet', () => {
    const r = evaluateMetaPhoneHealth({
      status: 'PENDING',
      health_status: { entities: [{ errors: [{ error_code: 141000 }] }] },
    })
    expect(r).toMatchObject({ connected: false })
    expect(r.failed).toBeUndefined()
    expect(r.error).toContain('registrado')
    expect(evaluateMetaPhoneHealth({}).error).toContain('ainda não')
  })
})
