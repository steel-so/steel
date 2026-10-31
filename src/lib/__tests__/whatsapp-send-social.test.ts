import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSocialConnection } from '@/src/__tests__/factories/nov-meta-channels.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

const { client, createSocial } = vi.hoisted(() => {
  const client = {
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    sendTemplate: vi.fn(),
    sendContact: vi.fn(),
    sendReaction: vi.fn(),
    sendButtons: vi.fn(),
  }
  return { client, createSocial: vi.fn(() => client) }
})

vi.mock('@/src/lib/rate-limit', () => ({
  whatsappSendLimiter: {},
  consume: vi.fn(async () => ({ ok: true, value: undefined })),
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async () => 'page-token'),
}))
vi.mock('../whatsapp/meta-social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp/meta-social')>()),
  createMetaSocialClient: createSocial,
}))
vi.mock('@/src/services/whatsapp-usage.service', () => ({
  WhatsAppUsageService: { assertCanSend: vi.fn(), record: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-cost.service', () => ({
  WhatsAppCostService: { record: vi.fn() },
}))

import { WhatsAppUsageService } from '@/src/services/whatsapp-usage.service'
import { WhatsAppSend } from '../whatsapp/send'

const mockedUsage = vi.mocked(WhatsAppUsageService)

beforeEach(() => {
  vi.clearAllMocks()
  mockedUsage.assertCanSend.mockResolvedValue(ok(undefined))
  client.sendText.mockResolvedValue({ providerMessageId: 'mid1' })
})

describe('WhatsAppSend — Instagram and Messenger connections', () => {
  it('builds the social client from the page id and the decrypted token', async () => {
    const connection = createFakeSocialConnection({ channel: 'INSTAGRAM' })
    const sent = await WhatsAppSend.text(connection, {
      to: 'ig:55',
      text: 'oi',
    })
    expect(expectOk(sent)).toEqual({ providerMessageId: 'mid1' })
    expect(createSocial).toHaveBeenCalledWith({
      pageId: '100200',
      accessToken: 'page-token',
    })
  })

  it('fails with a provider error when the page credentials are missing', async () => {
    const connection = createFakeSocialConnection({ metaPageId: null })
    const sent = await WhatsAppSend.text(connection, { to: 'fb:1', text: 'oi' })
    expectErr(sent, 'WHATSAPP_PROVIDER_ERROR')
    expect(createSocial).not.toHaveBeenCalled()

    const noToken = createFakeSocialConnection({
      encryptedMetaAccessToken: null,
    })
    expectErr(
      await WhatsAppSend.text(noToken, { to: 'fb:1', text: 'oi' }),
      'WHATSAPP_PROVIDER_ERROR',
    )
  })
})
