import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

const { client } = vi.hoisted(() => ({
  client: {
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    sendTemplate: vi.fn(),
    sendContact: vi.fn(),
    sendReaction: vi.fn(),
    sendButtons: vi.fn(),
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
  WhatsAppUsageService: { assertCanSend: vi.fn(), record: vi.fn() },
}))

vi.mock('@/src/services/whatsapp-cost.service', () => ({
  WhatsAppCostService: { record: vi.fn() },
}))

import { whatsappMessageLimitReached } from '@/src/errors'
import { WhatsAppCostService } from '@/src/services/whatsapp-cost.service'
import { WhatsAppUsageService } from '@/src/services/whatsapp-usage.service'
import { WhatsAppSend } from '../whatsapp/send'

const mockedUsage = vi.mocked(WhatsAppUsageService)
const mockedCost = vi.mocked(WhatsAppCostService)
const SENT = { providerMessageId: 'p1' }

beforeEach(() => {
  vi.clearAllMocks()
  mockedUsage.assertCanSend.mockResolvedValue(ok(undefined))
  mockedUsage.record.mockResolvedValue(undefined)
  mockedCost.record.mockResolvedValue(undefined)
  for (const fn of Object.values(client)) fn.mockResolvedValue(SENT)
})

const communication = createFakeWhatsAppConnection({
  workspaceId: 'ws1',
  module: 'COMMUNICATION',
})

describe('WhatsAppSend — monthly Communication limits', () => {
  it.each([
    ['text', () => WhatsAppSend.text(communication, { to: '55', text: 'oi' })],
    [
      'media',
      () =>
        WhatsAppSend.media(communication, {
          to: '55',
          type: 'image',
          mediaUrl: 'https://x/y.png',
        }),
    ],
    [
      'template',
      () =>
        WhatsAppSend.template(communication, {
          to: '55',
          templateName: 't',
          language: 'pt_BR',
        }),
    ],
    [
      'contact',
      () =>
        WhatsAppSend.contact(communication, {
          to: '55',
          name: 'Ana',
          waId: '5511',
        }),
    ],
    [
      'buttons',
      () =>
        WhatsAppSend.buttons(communication, {
          to: '55',
          text: 'Confirma?',
          buttons: [{ type: 'REPLY', id: 'stl:q:q1:b1', label: 'Sim' }],
        }),
    ],
  ] as const)(
    '%s: checks the limit first and counts a successful send',
    async (_name, send) => {
      expectOk(await (send as () => Promise<never>)())

      expect(mockedUsage.assertCanSend).toHaveBeenCalledWith('ws1', 'messages')
      expect(mockedUsage.record).toHaveBeenCalledWith('ws1', 'messages')
    },
  )

  it('refuses the send at the limit without calling the provider', async () => {
    mockedUsage.assertCanSend.mockResolvedValue(
      err(whatsappMessageLimitReached(10, 10)),
    )

    expectErr(
      await WhatsAppSend.text(communication, { to: '55', text: 'oi' }),
      'WHATSAPP_MESSAGE_LIMIT_REACHED',
    )
    expect(client.sendText).not.toHaveBeenCalled()
    expect(mockedUsage.record).not.toHaveBeenCalled()
  })

  it('does not count a send the provider rejected', async () => {
    client.sendText.mockRejectedValue(new Error('provider down'))

    expectErr(
      await WhatsAppSend.text(communication, { to: '55', text: 'oi' }),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(mockedUsage.record).not.toHaveBeenCalled()
  })

  it('never meters reactions', async () => {
    expectOk(
      await WhatsAppSend.reaction(communication, {
        to: '55',
        providerMessageId: 'm1',
        emoji: '👍',
      }),
    )
    expect(mockedUsage.assertCanSend).not.toHaveBeenCalled()
    expect(mockedUsage.record).not.toHaveBeenCalled()
  })

  it('never meters ServiceDesk connections', async () => {
    const serviceDesk = createFakeWhatsAppConnection({
      workspaceId: 'ws1',
      module: 'SERVICE_DESK',
    })
    expectOk(await WhatsAppSend.text(serviceDesk, { to: '55', text: 'oi' }))
    expect(mockedUsage.assertCanSend).not.toHaveBeenCalled()
    expect(mockedUsage.record).not.toHaveBeenCalled()
  })

  it('skips the limit for an unmetered (compliance) send', async () => {
    mockedUsage.assertCanSend.mockResolvedValue(
      err(whatsappMessageLimitReached(10, 10)),
    )
    expectOk(
      await WhatsAppSend.text(
        communication,
        { to: '55', text: 'Você não receberá mais mensagens.' },
        { unmetered: true },
      ),
    )
    expect(mockedUsage.assertCanSend).not.toHaveBeenCalled()
    expect(mockedUsage.record).not.toHaveBeenCalled()
  })
})

describe('WhatsAppSend — cost ledger (ADR 0050)', () => {
  it('records a template send with the caller context', async () => {
    const cost = { source: 'BROADCAST' as const, broadcastId: 'b1' }
    expectOk(
      await WhatsAppSend.template(
        communication,
        { to: '5511999990000', templateName: 't', language: 'pt_BR' },
        { cost },
      ),
    )
    expect(mockedCost.record).toHaveBeenCalledWith({
      connection: communication,
      kind: 'TEMPLATE',
      to: '5511999990000',
      context: cost,
    })
  })

  it.each([
    ['text', () => WhatsAppSend.text(communication, { to: '55', text: 'oi' })],
    [
      'contact',
      () =>
        WhatsAppSend.contact(communication, {
          to: '55',
          name: 'Ana',
          waId: '5511',
        }),
    ],
  ])('records a %s send as service volume', async (_name, send) => {
    expectOk(await send())
    expect(mockedCost.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SERVICE', to: '55' }),
    )
  })

  it('records nothing for a failed send or a reaction', async () => {
    client.sendText.mockRejectedValueOnce(new Error('down'))
    expectErr(await WhatsAppSend.text(communication, { to: '55', text: 'x' }))
    expectOk(
      await WhatsAppSend.reaction(communication, {
        to: '55',
        providerMessageId: 'p',
        emoji: '👍',
      } as never),
    )
    expect(mockedCost.record).not.toHaveBeenCalled()
  })
})
