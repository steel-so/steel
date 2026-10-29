import { createHmac } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Route-level proof that the provider status webhooks (Meta and Z-API, with
// their real payload shapes) reach the newsletter receipts through the real
// `WhatsAppWebhookService.ingestStatusUpdate` (slice nl3-whatsapp-receipts).

vi.mock('@/lib/axiom/server', () => ({
  withAxiom: (handler: unknown) => handler,
}))
vi.mock('@/lib/axiom/logger')
vi.mock('@/lib/env/server', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  WHATSAPP_META_APP_SECRET: 'meta-secret',
  WHATSAPP_META_VERIFY_TOKEN: 'verify',
}))
vi.mock('@/src/lib/rate-limit', () => ({
  consume: vi.fn(async () => ({ ok: true, value: undefined })),
  whatsappWebhookLimiter: {},
}))
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/services/authz', () => ({
  assertModuleEnabled: vi.fn(async () => ({ ok: true, value: undefined })),
}))
vi.mock('@/src/services/whatsapp-connection-health.service', () => ({
  metaConnectionError: vi.fn(() => null),
  WhatsAppConnectionHealthService: { markUp: vi.fn(), markDown: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-template.service', () => ({
  WhatsAppTemplateService: { applyWebhookUpdate: vi.fn() },
}))
vi.mock('@/src/services/crm-campaign-tracking.service', () => ({
  CrmCampaignTrackingService: { onWhatsAppStatus: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-whatsapp-receipts.service', () => ({
  CrmNewsletterWhatsAppReceiptsService: { onWhatsAppStatus: vi.fn() },
}))

import { POST as metaPost } from '@/app/api/whatsapp/webhook/meta/route'
import { POST as zapiPost } from '@/app/api/whatsapp/webhook/zapi/route'
import {
  metaStatusPayload,
  zapiStatusPayload,
} from '@/src/__tests__/factories/newsletter3-whatsapp-receipts.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { ok } from '@/src/lib/result'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { CrmNewsletterWhatsAppReceiptsService } from '@/src/services/crm-newsletter-whatsapp-receipts.service'

type Handler = (req: NextRequest) => Promise<Response>
const receipts = vi.mocked(
  CrmNewsletterWhatsAppReceiptsService.onWhatsAppStatus,
)
const connections = vi.mocked(WhatsAppConnectionRepository)
const messages = vi.mocked(WhatsAppMessageRepository)

const connection = createFakeWhatsAppConnection({
  webhookSecret: 'zapi-secret',
  module: 'COMMUNICATION',
})

function postMeta(body: unknown) {
  const raw = JSON.stringify(body)
  const signature = createHmac('sha256', 'meta-secret')
    .update(raw, 'utf8')
    .digest('hex')
  const request = new Request('http://localhost/api/whatsapp/webhook/meta', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body: raw,
  })
  return (metaPost as unknown as Handler)(request as NextRequest)
}

function postZapi(body: unknown) {
  const request = new Request(
    'http://localhost/api/whatsapp/webhook/zapi?secret=zapi-secret',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  return (zapiPost as unknown as Handler)(request as NextRequest)
}

beforeEach(() => {
  vi.clearAllMocks()
  connections.findByMetaPhoneNumberId.mockResolvedValue(ok(connection))
  connections.findByZapiInstanceId.mockResolvedValue(ok(connection))
  messages.updateStatusByProviderMessageId.mockResolvedValue(ok(null))
  receipts.mockResolvedValue(true)
})

describe('Meta status webhook → newsletter receipts', () => {
  it.each([
    ['delivered', 'DELIVERED'],
    ['read', 'READ'],
  ] as const)('forwards %s', async (status, mapped) => {
    const res = await postMeta(metaStatusPayload(status, 'wamid.A'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('STATUS_RECEIVED')
    expect(receipts).toHaveBeenCalledWith({
      providerMessageId: 'wamid.A',
      status: mapped,
      at: expect.any(Date),
      error: null,
    })
  })

  it('forwards a failure with the provider error detail', async () => {
    await postMeta(
      metaStatusPayload('failed', 'wamid.B', [
        { code: 131026, title: 'Message undeliverable' },
      ]),
    )
    expect(receipts).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error: '131026: Message undeliverable',
      }),
    )
    await postMeta(
      metaStatusPayload('failed', 'wamid.C', [
        { code: 131049, message: 'Healthy ecosystem', title: 'ignored' },
      ]),
    )
    expect(receipts).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: '131049: Healthy ecosystem' }),
    )
    await postMeta(metaStatusPayload('failed', 'wamid.D', [{ code: 1 }]))
    expect(receipts).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: '1' }),
    )
    await postMeta(
      metaStatusPayload('failed', 'wamid.E', [{ title: 'Sem código' }]),
    )
    expect(receipts).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: 'Sem código' }),
    )
    await postMeta(metaStatusPayload('failed', 'wamid.F', [{}]))
    expect(receipts).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: null }),
    )
  })

  it('still answers 200 when the receipts side reports nothing', async () => {
    receipts.mockResolvedValue(false)
    const res = await postMeta(metaStatusPayload('read'))
    expect(res.status).toBe(200)
  })
})

describe('Z-API status webhook → newsletter receipts', () => {
  it.each([
    ['RECEIVED', 'DELIVERED'],
    ['READ', 'READ'],
    ['PLAYED', 'READ'],
  ] as const)('forwards MessageStatusCallback %s', async (status, mapped) => {
    const res = await postZapi(zapiStatusPayload(status, ['3EB0A', '3EB0B']))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('STATUS_RECEIVED')
    expect(receipts).toHaveBeenCalledTimes(2)
    for (const id of ['3EB0A', '3EB0B']) {
      expect(receipts).toHaveBeenCalledWith({
        providerMessageId: id,
        status: mapped,
        at: expect.any(Date),
        error: undefined,
      })
    }
  })

  it('keeps accepting the legacy StatusCallback with messageId', async () => {
    await postZapi({
      instanceId: 'zapi-instance-1',
      type: 'StatusCallback',
      status: 'RECEIVED',
      messageId: '3EB0C',
      ids: ['3EB0C', ''],
    })
    expect(receipts).toHaveBeenCalledTimes(1)
    expect(receipts).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: '3EB0C',
        status: 'DELIVERED',
      }),
    )
  })

  it('ignores statuses it does not map (READ_BY_ME) and missing ids', async () => {
    await postZapi(zapiStatusPayload('READ_BY_ME'))
    await postZapi({ ...zapiStatusPayload('READ'), ids: undefined })
    expect(receipts).not.toHaveBeenCalled()
  })
})
