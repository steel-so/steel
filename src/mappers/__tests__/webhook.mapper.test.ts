import { describe, expect, it } from 'vitest'
import {
  createFakeWebhookDelivery,
  createFakeWebhookEndpoint,
} from '@/src/__tests__/factories/webhook.factory'
import { webhookEventDefinition } from '@/src/lib/webhooks/events'
import {
  toWebhookDeliveryDTO,
  toWebhookEndpointDTO,
  toWebhookEventTypeDTO,
} from '@/src/mappers/webhook.mapper'

describe('webhook mappers', () => {
  it('should map an endpoint without ever exposing the secret', () => {
    const at = new Date('2026-10-18T10:00:00.000Z')
    const endpoint = createFakeWebhookEndpoint({
      failingSince: at,
      lastFailureAt: at,
      disabledAt: at,
      disabledReason: 'auto',
      active: false,
    })
    const dto = toWebhookEndpointDTO(endpoint)
    expect(dto).toMatchObject({
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      active: false,
      secretHint: 'whsec_…a1b2',
      disabledAt: at.toISOString(),
      disabledReason: 'auto',
      failingSince: at.toISOString(),
      lastSuccessAt: null,
      createdAt: endpoint.createdAt.toISOString(),
    })
    expect(JSON.stringify(dto)).not.toContain('encrypted')
    expect(dto).not.toHaveProperty('deletedAt')
  })

  it('should map a delivery with the exact body sent', () => {
    const at = new Date('2026-10-18T10:00:00.000Z')
    const delivery = createFakeWebhookDelivery({
      status: 'SUCCEEDED',
      attempts: 2,
      responseStatus: 200,
      durationMs: 120,
      lastAttemptAt: at,
      deliveredAt: at,
    })
    expect(toWebhookDeliveryDTO(delivery)).toEqual({
      id: delivery.id,
      endpointId: delivery.endpointId,
      eventId: delivery.eventId,
      eventType: 'crm.lead.created',
      status: 'SUCCEEDED',
      attempts: 2,
      responseStatus: 200,
      responseBody: null,
      durationMs: 120,
      error: null,
      requestBody: delivery.body,
      lastAttemptAt: at.toISOString(),
      deliveredAt: at.toISOString(),
      createdAt: delivery.createdAt.toISOString(),
    })
  })

  it('should map a catalog entry', () => {
    expect(
      toWebhookEventTypeDTO(webhookEventDefinition('crm.deal.won')),
    ).toEqual({
      type: 'crm.deal.won',
      module: 'CRM',
      description: expect.any(String),
      subscribable: true,
    })
  })
})
