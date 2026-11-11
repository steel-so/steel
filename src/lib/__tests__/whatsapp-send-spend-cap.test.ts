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
  WhatsAppUsageService: {
    assertCanSend: vi.fn(async () => ok(undefined)),
    record: vi.fn(async () => undefined),
  },
}))
vi.mock('@/src/services/whatsapp-cost.service', () => ({
  WhatsAppCostService: { record: vi.fn(async () => undefined) },
}))
vi.mock('@/src/services/whatsapp-spend-cap.service', () => ({
  WhatsAppSpendCapService: {
    checkSend: vi.fn(),
    afterSend: vi.fn(async () => undefined),
  },
}))

import { whatsappSpendCapReached } from '@/src/errors'
import { WhatsAppCostService } from '@/src/services/whatsapp-cost.service'
import { WhatsAppSpendCapService } from '@/src/services/whatsapp-spend-cap.service'
import { WhatsAppSend } from '../whatsapp/send'

const cap = vi.mocked(WhatsAppSpendCapService)
const cost = vi.mocked(WhatsAppCostService)

const meta = createFakeWhatsAppConnection({
  id: 'conn-meta',
  workspaceId: 'ws1',
  provider: 'META',
  module: 'COMMUNICATION',
  metaPhoneNumberId: 'pn',
  metaWabaId: 'waba',
  encryptedMetaAccessToken: 'enc',
})
const template = { to: '5511999990000', templateName: 't', language: 'pt_BR' }
const check = {
  connectionId: 'conn-meta',
  workspaceId: 'ws1',
  label: 'Oficial',
  period: '2026-11',
  cap: 1500,
  capMode: 'BLOCK' as const,
  spent: 1200,
  nextCost: 0.3217,
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of Object.values(client)) {
    fn.mockResolvedValue({ providerMessageId: 'wamid.1' })
  }
  cap.checkSend.mockResolvedValue(ok(check))
})

describe('WhatsAppSend — monthly spending cap (ADR 0064)', () => {
  it('checks the cap before a paid Meta template and notifies after it', async () => {
    expectOk(
      await WhatsAppSend.template(meta, template, {
        cost: {
          source: 'BROADCAST',
          templateCategory: 'UTILITY',
          viaMarketingLite: true,
        },
      }),
    )
    expect(cap.checkSend).toHaveBeenCalledWith(meta, {
      to: '5511999990000',
      templateCategory: 'UTILITY',
      lite: true,
    })
    expect(cap.afterSend).toHaveBeenCalledWith(check)
    expect(cost.record).toHaveBeenCalledWith(
      expect.objectContaining({ providerMessageId: 'wamid.1' }),
    )
  })

  it('refuses the send without calling Meta when the cap blocks it', async () => {
    cap.checkSend.mockResolvedValue(err(whatsappSpendCapReached(1500, 1500)))
    expectErr(
      await WhatsAppSend.template(meta, template),
      'WHATSAPP_SPEND_CAP_REACHED',
    )
    expect(client.sendTemplate).not.toHaveBeenCalled()
    expect(cost.record).not.toHaveBeenCalled()
  })

  it('skips the notice for a number without a cap', async () => {
    cap.checkSend.mockResolvedValue(ok(null))
    expectOk(await WhatsAppSend.template(meta, template))
    expect(cap.afterSend).not.toHaveBeenCalled()
  })

  it('never checks free sends, Z-API or the ServiceDesk line', async () => {
    expectOk(await WhatsAppSend.text(meta, { to: '55', text: 'oi' }))
    const zapi = createFakeWhatsAppConnection({ provider: 'ZAPI' })
    expectOk(await WhatsAppSend.template(zapi, template))
    const desk = createFakeWhatsAppConnection({
      provider: 'META',
      module: 'SERVICE_DESK',
      metaPhoneNumberId: 'pn',
      metaWabaId: 'waba',
      encryptedMetaAccessToken: 'enc',
    })
    expectOk(await WhatsAppSend.template(desk, template))
    expect(cap.checkSend).not.toHaveBeenCalled()
  })

  it('records nothing when the provider returns no message id', async () => {
    client.sendTemplate.mockResolvedValue({ providerMessageId: '' })
    expectOk(await WhatsAppSend.template(meta, template))
    client.sendTemplate.mockResolvedValue(null)
    expectOk(await WhatsAppSend.template(meta, template))
    expect(cost.record).not.toHaveBeenCalled()
    expect(cap.afterSend).not.toHaveBeenCalled()
  })
})
