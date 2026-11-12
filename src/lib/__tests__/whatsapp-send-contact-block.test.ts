import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, whatsappContactBlocked } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const { client } = vi.hoisted(() => ({
  client: {
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    sendTemplate: vi.fn(),
    sendContact: vi.fn(),
    sendReaction: vi.fn(),
    sendButtons: vi.fn(),
    sendList: vi.fn(),
    sendFlow: vi.fn(),
  },
}))

vi.mock('@/src/lib/rate-limit', () => ({
  whatsappSendLimiter: {},
  consume: vi.fn(async () => ({ ok: true, value: undefined })),
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async () => 'secret'),
}))
vi.mock('../whatsapp/zapi-client', () => ({
  createZapiClient: vi.fn(() => client),
}))
vi.mock('../whatsapp/meta-client', () => ({
  createMetaClient: vi.fn(() => client),
}))
vi.mock('@/src/services/whatsapp-usage.service', () => ({
  WhatsAppUsageService: {
    assertCanSend: vi.fn(async () => ok(undefined)),
    record: vi.fn(async () => undefined),
  },
}))
vi.mock('@/src/services/whatsapp-cost.service', () => ({
  WhatsAppCostService: { record: vi.fn(async () => undefined) },
}))
vi.mock('@/src/services/whatsapp-contact-block.service', () => ({
  WhatsAppContactBlockService: { assertCanSend: vi.fn() },
}))

import { consume } from '@/src/lib/rate-limit'
import { WhatsAppContactBlockService } from '@/src/services/whatsapp-contact-block.service'
import { WhatsAppUsageService } from '@/src/services/whatsapp-usage.service'
import { WhatsAppSend } from '../whatsapp/send'

const guard = vi.mocked(WhatsAppContactBlockService.assertCanSend)

const zapi = createFakeWhatsAppConnection({ id: 'conn-zapi', provider: 'ZAPI' })
const meta = createFakeWhatsAppConnection({
  id: 'conn-meta',
  provider: 'META',
  metaPhoneNumberId: 'pn',
  metaWabaId: 'waba',
  encryptedMetaAccessToken: 'enc',
})
const TO = '5511988887777'

const sends = [
  ['text', () => WhatsAppSend.text(zapi, { to: TO, text: 'oi' })],
  [
    'media',
    () =>
      WhatsAppSend.media(zapi, { to: TO, mediaUrl: 'https://x', type: 'image' }),
  ],
  [
    'template',
    () =>
      WhatsAppSend.template(meta, {
        to: TO,
        templateName: 't',
        language: 'pt_BR',
      }),
  ],
  [
    'contact',
    () => WhatsAppSend.contact(zapi, { to: TO, name: 'Ana', waId: '55' }),
  ],
  [
    'buttons',
    () => WhatsAppSend.buttons(zapi, { to: TO, text: 'oi', buttons: [] }),
  ],
  [
    'list',
    () =>
      WhatsAppSend.list(meta, {
        to: TO,
        text: 'oi',
        buttonLabel: 'Ver',
        rows: [],
      }),
  ],
  [
    'flow',
    () =>
      WhatsAppSend.flow(meta, {
        to: TO,
        flowId: 'f',
        flowToken: 'tk',
        bodyText: 'oi',
        ctaLabel: 'Abrir',
        screen: 'S1',
      }),
  ],
  [
    'reaction',
    () =>
      WhatsAppSend.reaction(zapi, {
        to: TO,
        providerMessageId: 'm',
        emoji: '👍',
      }),
  ],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of Object.values(client)) {
    fn.mockResolvedValue({ providerMessageId: 'wamid.1' })
  }
  guard.mockResolvedValue(ok(undefined))
})

describe('WhatsAppSend — blocked contacts (zap-block-contacts)', () => {
  it.each(sends)(
    '%s() refuses a blocked recipient before the provider, the meter and the rate limit',
    async (_name, run) => {
      guard.mockResolvedValue(err(whatsappContactBlocked()))
      expectErr(await run(), 'WHATSAPP_CONTACT_BLOCKED')
      expect(guard).toHaveBeenCalledWith(expect.anything(), TO)
      for (const fn of Object.values(client)) {
        expect(fn).not.toHaveBeenCalled()
      }
      expect(consume).not.toHaveBeenCalled()
      expect(WhatsAppUsageService.assertCanSend).not.toHaveBeenCalled()
    },
  )

  it.each(sends)('%s() goes out when nobody is blocked', async (_name, run) => {
    expectOk(await run())
    expect(guard).toHaveBeenCalledTimes(1)
  })

  it('propagates a failed block lookup', async () => {
    guard.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppSend.text(zapi, { to: TO, text: 'oi' }),
      'DATABASE_ERROR',
    )
    expect(client.sendText).not.toHaveBeenCalled()
  })

  it('checks the connection the message goes through', async () => {
    await WhatsAppSend.text(meta, { to: TO, text: 'oi' })
    expect(guard).toHaveBeenCalledWith(meta, TO)
  })
})
