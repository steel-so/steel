import { describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { jsonResponse, mockFetch } from '@/src/__tests__/helpers/fetch.helpers'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async () => 'token'),
}))
vi.mock('@/src/lib/rate-limit', () => ({
  consume: vi.fn(async () => ({ ok: true, value: undefined })),
  whatsappSendLimiter: {},
}))
vi.mock('@/src/services/whatsapp-cost.service', () => ({
  WhatsAppCostService: { record: vi.fn(async () => undefined) },
}))
vi.mock('@/src/services/whatsapp-usage.service', () => ({
  WhatsAppUsageService: {
    assertCanSend: vi.fn(async () => ({ ok: true, value: undefined })),
    record: vi.fn(async () => undefined),
  },
}))

import { WhatsAppSend } from '../whatsapp/send'

const input = {
  to: '5511999999999',
  flowId: 'f1',
  flowToken: 'stlf.f.n',
  bodyText: 'Preencha',
  ctaLabel: 'Abrir',
  screen: 'SCREEN_A',
}

describe('WhatsAppSend.flow', () => {
  it('posts the interactive flow message through the Meta client', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({ messages: [{ id: 'wamid.1' }] }),
    )
    const connection = createFakeWhatsAppConnection({
      provider: 'META',
      metaPhoneNumberId: 'phone1',
      metaWabaId: 'waba1',
      encryptedMetaAccessToken: 'enc',
    })
    const result = expectOk(await WhatsAppSend.flow(connection, input))
    expect(result.providerMessageId).toBe('wamid.1')
    const [call] = fetchMock.calls()
    expect(call.url).toContain('/phone1/messages')
    const body = JSON.parse(call.init?.body as string)
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'interactive',
      interactive: { type: 'flow' },
    })
  })

  it('explains that Z-API connections cannot send flows', async () => {
    const error = expectErr(
      await WhatsAppSend.flow(
        createFakeWhatsAppConnection({ provider: 'ZAPI' }),
        input,
      ),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(error.message).toContain('API oficial da Meta')
  })
})
