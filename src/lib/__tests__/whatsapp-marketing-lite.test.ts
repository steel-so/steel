import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async () => 'token'),
}))

import {
  describeMarketingLiteError,
  fetchMarketingLiteAnalytics,
  MarketingLiteTemplateNotFoundError,
  metaCredentialsOf,
} from '@/src/lib/whatsapp/marketing-lite'
import { createMetaClient, MetaApiError } from '@/src/lib/whatsapp/meta-client'

const credentials = { phoneNumberId: 'phone', wabaId: 'waba', accessToken: 't' }

function stubFetch(...bodies: unknown[]) {
  const spy = vi.fn()
  for (const body of bodies) {
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Meta sendTemplate() through Marketing Messages Lite', () => {
  const template = {
    to: '5511999990000',
    templateName: 'promo',
    language: 'pt_BR',
  }

  it('should post to /marketing_messages with the Cloud API fallback policy', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.1' }] })
    const client = createMetaClient(credentials)

    const sent = await client.sendTemplate({
      ...template,
      marketingLite: { cloudApiFallback: true },
    })

    expect(sent).toEqual({ providerMessageId: 'wamid.1' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/phone/marketing_messages')
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        type: 'template',
        product_policy: 'CLOUD_API_FALLBACK',
      }),
    )
  })

  it('should omit the fallback policy when it is off', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.2' }] })

    await createMetaClient(credentials).sendTemplate({
      ...template,
      marketingLite: { cloudApiFallback: false },
    })

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/phone/marketing_messages')
    expect(JSON.parse(String(init.body))).not.toHaveProperty('product_policy')
  })

  it('should keep using /messages without the Lite option', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.3' }] })

    await createMetaClient(credentials).sendTemplate(template)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/phone\/messages$/)
    expect(JSON.parse(String(init.body))).not.toHaveProperty('product_policy')
  })
})

describe('metaCredentialsOf()', () => {
  it('should return null for Z-API or incomplete Meta connections', async () => {
    expect(
      await metaCredentialsOf(
        createFakeWhatsAppConnection({ provider: 'ZAPI' }),
      ),
    ).toBeNull()
    expect(
      await metaCredentialsOf(
        createFakeWhatsAppConnection({
          provider: 'META',
          metaPhoneNumberId: null,
        }),
      ),
    ).toBeNull()
  })

  it('should decrypt the token of a Meta connection', async () => {
    expect(
      await metaCredentialsOf(
        createFakeWhatsAppConnection({
          provider: 'META',
          metaPhoneNumberId: 'p1',
          metaWabaId: 'w1',
          encryptedMetaAccessToken: 'enc',
        }),
      ),
    ).toEqual({ phoneNumberId: 'p1', wabaId: 'w1', accessToken: 'token' })
  })
})

describe('fetchMarketingLiteAnalytics()', () => {
  const period = {
    from: new Date('2026-10-01T00:00:00Z'),
    to: new Date('2026-10-02T00:00:00Z'),
  }
  const template = { name: 'promo', language: 'pt_BR' }

  it('should sum the data points of the matching template', async () => {
    const spy = stubFetch(
      {
        data: [
          { id: 'other', language: 'en_US' },
          { id: 'tpl-1', language: 'pt_BR' },
        ],
      },
      {
        data: [
          {
            data_points: [
              { sent: 10, delivered: 9, read: 5, clicked: [{ count: 2 }] },
              {
                sent: 4,
                delivered: 4,
                clicked: [{ count: 1 }, {}],
              },
              {},
            ],
          },
          {},
        ],
      },
    )

    const totals = await fetchMarketingLiteAnalytics(
      credentials,
      template,
      period,
    )

    expect(totals).toEqual({ sent: 14, delivered: 13, read: 5, clicked: 3 })
    const analyticsUrl = String(spy.mock.calls[1][0])
    expect(analyticsUrl).toContain('/waba/template_analytics?')
    expect(decodeURIComponent(analyticsUrl)).toContain('template_ids=["tpl-1"]')
  })

  it('should fail clearly when Meta has no template with that language', async () => {
    stubFetch({ data: [{ id: 'x', language: 'en_US' }] })
    await expect(
      fetchMarketingLiteAnalytics(credentials, template, period),
    ).rejects.toBeInstanceOf(MarketingLiteTemplateNotFoundError)
  })

  it('should fail clearly when the lookup answers without a list', async () => {
    stubFetch({})
    await expect(
      fetchMarketingLiteAnalytics(credentials, template, period),
    ).rejects.toBeInstanceOf(MarketingLiteTemplateNotFoundError)
  })

  it('should ignore malformed analytics values', async () => {
    stubFetch(
      { data: [{ id: 'tpl', language: 'pt_BR' }] },
      {
        data: [
          null,
          { data_points: 'nope' },
          {
            data_points: [
              null,
              { sent: 'x', delivered: Number.NaN, clicked: 'no' },
              { sent: 2, clicked: [null, { count: 'a' }, { count: 3 }] },
            ],
          },
        ],
      },
    )
    expect(
      await fetchMarketingLiteAnalytics(credentials, template, period),
    ).toEqual({ sent: 2, delivered: 0, read: 0, clicked: 3 })
  })

  it('should keep the window inside the 90 days Meta accepts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-01T00:00:00Z'))
    try {
      const spy = stubFetch(
        { data: [{ id: 'tpl', language: 'pt_BR' }] },
        { data: [] },
      )
      await fetchMarketingLiteAnalytics(credentials, template, {
        from: new Date('2026-10-01T00:00:00Z'),
        // In the future: clamped to now.
        to: new Date('2027-04-01T00:00:00Z'),
      })
      const query = new URL(String(spy.mock.calls[1][0])).searchParams
      const end = Number(query.get('end'))
      const start = Number(query.get('start'))
      expect(end).toBe(Date.parse('2027-03-01T00:00:00Z') / 1000)
      expect(end - start).toBe(90 * 86_400)

      // A same-instant window still spans a day, so Meta accepts it.
      stubFetch({ data: [{ id: 'tpl', language: 'pt_BR' }] }, { data: [] })
      const same = new Date('2027-02-28T00:00:00Z')
      await fetchMarketingLiteAnalytics(credentials, template, {
        from: same,
        to: same,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('should tolerate empty analytics responses', async () => {
    stubFetch({ data: [{ id: 'tpl', language: 'pt_BR' }] }, {})
    expect(
      await fetchMarketingLiteAnalytics(credentials, template, period),
    ).toEqual({ sent: 0, delivered: 0, read: 0, clicked: 0 })
    stubFetch({ data: [{ id: 'tpl', language: 'pt_BR' }] }, {})
    expect(
      await fetchMarketingLiteAnalytics(credentials, template, period),
    ).toEqual({ sent: 0, delivered: 0, read: 0, clicked: 0 })
  })
})

describe('describeMarketingLiteError()', () => {
  it.each([
    [new MarketingLiteTemplateNotFoundError(), 'não encontrou o template'],
    [new MetaApiError('x', 400, 190), 'token de acesso'],
    [new MetaApiError('x', 401), 'token de acesso'],
    [new MetaApiError('x', 400, 200), 'permissão'],
    [new MetaApiError('x', 400, 10), 'permissão'],
    [new MetaApiError('x', 403), 'permissão'],
    [new MetaApiError('x', 400, 80_004), 'limitou'],
    [new MetaApiError('x', 429), 'limitou'],
    [new MetaApiError('x', 503), 'instável'],
    [new MetaApiError('x', 400, 100), 'Não foi possível'],
    [new Error('boom'), 'Não foi possível'],
    ['weird', 'Não foi possível'],
  ])('maps %o to a pt-BR reason', (error, expected) => {
    expect(describeMarketingLiteError(error)).toContain(expected)
  })

  it('maps a request timeout to a reason', () => {
    const timeout = new DOMException('The operation timed out', 'TimeoutError')
    expect(describeMarketingLiteError(timeout)).toContain('demorou demais')
    const aborted = new DOMException('aborted', 'AbortError')
    expect(describeMarketingLiteError(aborted)).toContain('demorou demais')
  })
})

describe('Meta request errors', () => {
  it('should carry the status and Meta code on the thrown error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 190, message: 'Token expired' } }),
          { status: 401 },
        ),
      ),
    )
    const client = createMetaClient(credentials)
    const failure = await client
      .sendText({ to: '5511999990000', text: 'oi' })
      .catch((error) => error)
    expect(failure).toBeInstanceOf(MetaApiError)
    expect(failure).toMatchObject({
      message: 'Token expired',
      status: 401,
      code: 190,
    })
  })
})
