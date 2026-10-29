import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async () => 'token'),
}))

import {
  fetchMarketingLiteAnalytics,
  metaCredentialsOf,
} from '@/src/lib/whatsapp/marketing-lite'
import { createMetaClient } from '@/src/lib/whatsapp/meta-client'

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

  it('should return zeros when Meta has no template with that language', async () => {
    stubFetch({ data: [{ id: 'x', language: 'en_US' }] })
    expect(
      await fetchMarketingLiteAnalytics(credentials, template, period),
    ).toEqual({ sent: 0, delivered: 0, read: 0, clicked: 0 })
  })

  it('should tolerate empty responses', async () => {
    stubFetch({}, {})
    expect(
      await fetchMarketingLiteAnalytics(credentials, template, period),
    ).toEqual({ sent: 0, delivered: 0, read: 0, clicked: 0 })
    stubFetch({ data: [{ id: 'tpl', language: 'pt_BR' }] }, {})
    expect(
      await fetchMarketingLiteAnalytics(credentials, template, period),
    ).toEqual({ sent: 0, delivered: 0, read: 0, clicked: 0 })
  })
})
