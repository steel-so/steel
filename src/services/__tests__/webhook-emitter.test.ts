import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/src/services/webhook-emitter')

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  publish: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))
vi.mock('@/src/lib/queue/queues', () => ({
  getWebhooksDeliveryQueue: () => ({ add: mocks.add }),
}))
vi.mock('@/src/lib/webhooks/realtime', () => ({
  publishWebhookEvent: mocks.publish,
}))
vi.mock('@/src/repositories/webhook-endpoint.repository')
vi.mock('@/src/repositories/webhook-delivery.repository')

import { createFakeWebhookDelivery } from '@/src/__tests__/factories/webhook.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { WEBHOOK_EVENT_EXAMPLES } from '@/src/lib/webhooks/events'
import { WebhookDeliveryRepository } from '@/src/repositories/webhook-delivery.repository'
import { WebhookEndpointRepository } from '@/src/repositories/webhook-endpoint.repository'
import {
  dispatchWebhookEvent,
  emitWebhookEvent,
  enqueueWebhookDelivery,
  webhookEventId,
} from '../webhook-emitter'

const endpoints = vi.mocked(WebhookEndpointRepository)
const deliveries = vi.mocked(WebhookDeliveryRepository)
const LEAD = WEBHOOK_EVENT_EXAMPLES['crm.lead.created']

beforeEach(() => {
  mocks.add.mockResolvedValue({})
  mocks.publish.mockResolvedValue(undefined)
  endpoints.listSubscribed.mockResolvedValue(ok([{ id: 'e1' }, { id: 'e2' }]))
  deliveries.createMany.mockImplementation(async (rows) =>
    ok(
      rows.map((row) =>
        createFakeWebhookDelivery({ ...row, id: `d-${row.endpointId}` }),
      ),
    ),
  )
})

describe('dispatchWebhookEvent', () => {
  it('should publish to the listeners, write one delivery per endpoint and enqueue them', async () => {
    const result = expectOk(
      await dispatchWebhookEvent('w1', 'crm.lead.created', LEAD),
    )
    expect(result.event).toMatchObject({
      type: 'crm.lead.created',
      workspaceId: 'w1',
      data: LEAD,
    })
    expect(result.event.id).toMatch(/^evt_/)
    const body = JSON.stringify(result.event)
    expect(mocks.publish).toHaveBeenCalledWith('w1', {
      id: result.event.id,
      type: 'crm.lead.created',
      body,
    })
    expect(endpoints.listSubscribed).toHaveBeenCalledWith(
      'w1',
      'crm.lead.created',
    )
    expect(deliveries.createMany).toHaveBeenCalledWith([
      {
        workspaceId: 'w1',
        endpointId: 'e1',
        eventId: result.event.id,
        eventType: 'crm.lead.created',
        body,
      },
      {
        workspaceId: 'w1',
        endpointId: 'e2',
        eventId: result.event.id,
        eventType: 'crm.lead.created',
        body,
      },
    ])
    expect(mocks.add).toHaveBeenCalledWith(
      'deliver',
      { deliveryId: 'd-e1' },
      { jobId: 'd-e1' },
    )
    expect(mocks.add).toHaveBeenCalledTimes(2)
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'webhooks.event_dispatched',
      expect.anything(),
    )
  })

  it('should target explicit endpoints, skip the listeners and the queue on request', async () => {
    const result = expectOk(
      await dispatchWebhookEvent(
        'w1',
        'steel.ping',
        { message: 'oi' },
        { endpointIds: ['e9'], broadcast: false, enqueue: false },
      ),
    )
    expect(result.deliveries).toHaveLength(1)
    expect(endpoints.listSubscribed).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('should log nothing when no endpoint is subscribed', async () => {
    endpoints.listSubscribed.mockResolvedValue(ok([]))
    const result = expectOk(
      await dispatchWebhookEvent('w1', 'crm.lead.created', LEAD),
    )
    expect(result.deliveries).toEqual([])
    expect(mocks.logger.info).not.toHaveBeenCalled()
  })

  it('should refuse data outside the event schema', async () => {
    expectErr(
      await dispatchWebhookEvent('w1', 'crm.deal.won', {} as never),
      'VALIDATION_ERROR',
    )
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('should propagate database errors', async () => {
    endpoints.listSubscribed.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await dispatchWebhookEvent('w1', 'crm.lead.created', LEAD),
      'DATABASE_ERROR',
    )
    endpoints.listSubscribed.mockResolvedValue(ok([{ id: 'e1' }]))
    deliveries.createMany.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await dispatchWebhookEvent('w1', 'crm.lead.created', LEAD),
      'DATABASE_ERROR',
    )
  })
})

describe('enqueueWebhookDelivery', () => {
  it('should enqueue a manual re-delivery as one attempt with its own job id', async () => {
    expect(
      await enqueueWebhookDelivery('d1', { manual: true, attempt: 3 }),
    ).toBe(true)
    expect(mocks.add).toHaveBeenCalledWith(
      'deliver',
      { deliveryId: 'd1', manual: true },
      { jobId: 'd1-retry-3', attempts: 1 },
    )
    await enqueueWebhookDelivery('d2', { manual: true })
    expect(mocks.add).toHaveBeenLastCalledWith(
      'deliver',
      { deliveryId: 'd2', manual: true },
      { jobId: 'd2-retry-0', attempts: 1 },
    )
  })

  it('should log and report a queue failure', async () => {
    mocks.add.mockRejectedValueOnce(new Error('redis down'))
    expect(await enqueueWebhookDelivery('d1')).toBe(false)
    mocks.add.mockRejectedValueOnce('down')
    expect(await enqueueWebhookDelivery('d1')).toBe(false)
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'webhooks.enqueue_failed',
      expect.anything(),
    )
  })
})

describe('emitWebhookEvent', () => {
  it('should dispatch the data or the result of a builder', async () => {
    await emitWebhookEvent('w1', 'crm.lead.created', () => LEAD)
    expect(deliveries.createMany).toHaveBeenCalledTimes(1)
    await emitWebhookEvent('w1', 'crm.lead.created', LEAD)
    expect(deliveries.createMany).toHaveBeenCalledTimes(2)
  })

  it('should never throw: errors and builder throws are only logged', async () => {
    endpoints.listSubscribed.mockResolvedValue(err(databaseError('x')))
    await expect(
      emitWebhookEvent('w1', 'crm.lead.created', LEAD),
    ).resolves.toBeUndefined()
    await expect(
      emitWebhookEvent('w1', 'crm.lead.created', () => {
        throw new Error('bad row')
      }),
    ).resolves.toBeUndefined()
    await expect(
      emitWebhookEvent('w1', 'crm.lead.created', () => {
        throw 'bad'
      }),
    ).resolves.toBeUndefined()
    expect(mocks.logger.warn).toHaveBeenCalledTimes(3)
  })

  it('should create evt_ ids', () => {
    expect(webhookEventId()).toMatch(/^evt_[a-z0-9]+$/)
  })
})
