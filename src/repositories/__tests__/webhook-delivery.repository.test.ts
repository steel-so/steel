import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import {
  seedWebhookDelivery,
  seedWebhookEndpoint,
} from '@/src/__tests__/factories/webhook.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WebhookDeliveryRepository } from '../webhook-delivery.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const endpoint = await seedWebhookEndpoint({
    workspaceId: workspace.id,
    createdById: user.id,
  })
  return { workspace, user, endpoint }
}

describe('WebhookDeliveryRepository', () => {
  it('should create many rows at once and none for an empty list', async () => {
    const { workspace, endpoint } = await setup()
    expect(expectOk(await WebhookDeliveryRepository.createMany([]))).toEqual([])
    const rows = expectOk(
      await WebhookDeliveryRepository.createMany([
        {
          workspaceId: workspace.id,
          endpointId: endpoint.id,
          eventId: 'evt_1',
          eventType: 'crm.lead.created',
          body: '{"a":1}',
        },
      ]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      body: '{"a":1}',
    })
  })

  it('should find within the workspace and load with the endpoint', async () => {
    const { workspace, endpoint } = await setup()
    const other = await seedWorkspace()
    const delivery = await seedWebhookDelivery({
      workspaceId: workspace.id,
      endpointId: endpoint.id,
    })
    expect(
      expectOk(
        await WebhookDeliveryRepository.findById(delivery.id, workspace.id),
      ).id,
    ).toBe(delivery.id)
    expectErr(
      await WebhookDeliveryRepository.findById(delivery.id, other.id),
      'WEBHOOK_DELIVERY_NOT_FOUND',
    )
    const loaded = expectOk(
      await WebhookDeliveryRepository.findWithEndpoint(delivery.id),
    )
    expect(loaded?.endpoint.id).toBe(endpoint.id)
    expect(
      expectOk(await WebhookDeliveryRepository.findWithEndpoint('missing')),
    ).toBeNull()
  })

  it('should page newest first with a cursor and filters', async () => {
    const { workspace, endpoint, user } = await setup()
    const second = await seedWebhookEndpoint({
      workspaceId: workspace.id,
      createdById: user.id,
    })
    const base = Date.parse('2026-10-18T12:00:00.000Z')
    const rows = []
    for (let i = 0; i < 5; i++) {
      rows.push(
        await seedWebhookDelivery({
          workspaceId: workspace.id,
          endpointId: endpoint.id,
          status: i === 0 ? 'FAILED' : 'SUCCEEDED',
          createdAt: new Date(base + i * 1000),
        }),
      )
    }
    await seedWebhookDelivery({
      workspaceId: workspace.id,
      endpointId: second.id,
    })

    const first = expectOk(
      await WebhookDeliveryRepository.list(workspace.id, {
        endpointId: endpoint.id,
        limit: 2,
      }),
    )
    expect(first.items.map((row) => row.id)).toEqual([rows[4].id, rows[3].id])
    expect(first.nextCursor).toBe(rows[3].id)

    const next = expectOk(
      await WebhookDeliveryRepository.list(workspace.id, {
        endpointId: endpoint.id,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      }),
    )
    expect(next.items.map((row) => row.id)).toEqual([rows[2].id, rows[1].id])

    const last = expectOk(
      await WebhookDeliveryRepository.list(workspace.id, {
        endpointId: endpoint.id,
        limit: 10,
        cursor: rows[1].id,
      }),
    )
    expect(last).toEqual({
      items: [expect.objectContaining({ id: rows[0].id })],
      nextCursor: null,
    })

    const failed = expectOk(
      await WebhookDeliveryRepository.list(workspace.id, {
        status: 'FAILED',
        limit: 10,
      }),
    )
    expect(failed.items.map((row) => row.id)).toEqual([rows[0].id])

    expect(
      expectOk(
        await WebhookDeliveryRepository.list(workspace.id, { limit: 10 }),
      ).items,
    ).toHaveLength(6)

    const foreign = await seedWorkspace()
    expect(
      expectOk(
        await WebhookDeliveryRepository.list(foreign.id, {
          limit: 10,
          cursor: rows[1].id,
        }),
      ),
    ).toEqual({ items: [], nextCursor: null })
  })

  it('should record attempts, skip and reset', async () => {
    const { workspace, endpoint } = await setup()
    const delivery = await seedWebhookDelivery({
      workspaceId: workspace.id,
      endpointId: endpoint.id,
    })
    const at = new Date('2026-10-18T12:00:00.000Z')
    const failed = expectOk(
      await WebhookDeliveryRepository.recordAttempt(delivery.id, {
        status: 'RETRYING',
        responseStatus: 500,
        responseBody: 'boom',
        durationMs: 12,
        error: 'http_500',
        at,
      }),
    )
    expect(failed).toMatchObject({
      attempts: 1,
      status: 'RETRYING',
      deliveredAt: null,
      lastAttemptAt: at,
    })
    const ok = expectOk(
      await WebhookDeliveryRepository.recordAttempt(delivery.id, {
        status: 'SUCCEEDED',
        responseStatus: 200,
        responseBody: null,
        durationMs: 5,
        error: null,
        at,
      }),
    )
    expect(ok).toMatchObject({
      attempts: 2,
      status: 'SUCCEEDED',
      deliveredAt: at,
    })

    expect(
      expectOk(await WebhookDeliveryRepository.markPending(delivery.id)),
    ).toMatchObject({
      status: 'PENDING',
      error: null,
    })
    expectOk(
      await WebhookDeliveryRepository.markSkipped(
        delivery.id,
        'endpoint_disabled',
      ),
    )
    expect(
      (
        await prisma.webhookDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
      ).status,
    ).toBe('SKIPPED')
  })

  it('should return DATABASE_ERROR on failures', async () => {
    expectErr(
      await WebhookDeliveryRepository.createMany([
        {
          workspaceId: 'missing',
          endpointId: 'missing',
          eventId: 'e',
          eventType: 't',
          body: '{}',
        },
      ]),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookDeliveryRepository.markSkipped('missing', 'x'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookDeliveryRepository.markPending('missing'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookDeliveryRepository.recordAttempt('missing', {
        status: 'FAILED',
        responseStatus: null,
        responseBody: null,
        durationMs: null,
        error: 'x',
        at: new Date(),
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.webhookDelivery, 'findFirst').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await WebhookDeliveryRepository.findById('d', 'w'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.webhookDelivery, 'findUnique').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await WebhookDeliveryRepository.findWithEndpoint('d'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.webhookDelivery, 'findMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await WebhookDeliveryRepository.list('w', { limit: 5 }),
      'DATABASE_ERROR',
    )
  })
})
