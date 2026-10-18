import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWebhookEndpoint } from '@/src/__tests__/factories/webhook.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WebhookEndpointRepository } from '../webhook-endpoint.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

describe('WebhookEndpointRepository', () => {
  it('should create, find, list and count live endpoints of the workspace only', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const created = expectOk(
      await WebhookEndpointRepository.create({
        workspaceId: workspace.id,
        url: 'https://hooks.example.com/a',
        description: 'ERP',
        events: ['crm.lead.created'],
        encryptedSecret: 'enc',
        secretHint: 'abcd',
        active: true,
        createdById: user.id,
      }),
    )
    expect(created.disabledAt).toBeNull()
    await seedWebhookEndpoint({
      workspaceId: workspace.id,
      createdById: user.id,
      deletedAt: new Date(),
    })
    await seedWebhookEndpoint({ workspaceId: other.id, createdById: user.id })

    const list = expectOk(
      await WebhookEndpointRepository.listByWorkspace(workspace.id),
    )
    expect(list.map((row) => row.id)).toEqual([created.id])
    expect(
      expectOk(await WebhookEndpointRepository.countByWorkspace(workspace.id)),
    ).toBe(1)
    expect(
      expectOk(
        await WebhookEndpointRepository.findById(created.id, workspace.id),
      ).url,
    ).toBe('https://hooks.example.com/a')
    expectErr(
      await WebhookEndpointRepository.findById(created.id, other.id),
      'WEBHOOK_ENDPOINT_NOT_FOUND',
    )
  })

  it('should stamp a manual switch-off when created inactive', async () => {
    const { workspace, user } = await setup()
    const created = expectOk(
      await WebhookEndpointRepository.create({
        workspaceId: workspace.id,
        url: 'https://hooks.example.com/b',
        description: null,
        events: ['*'],
        encryptedSecret: 'enc',
        secretHint: 'abcd',
        active: false,
        createdById: user.id,
      }),
    )
    expect(created.disabledReason).toBe('manual')
    expect(created.disabledAt).toBeInstanceOf(Date)
  })

  it('should list only active endpoints subscribed to the type or to *', async () => {
    const { workspace, user } = await setup()
    const exact = await seedWebhookEndpoint({
      workspaceId: workspace.id,
      createdById: user.id,
      events: ['crm.deal.won'],
    })
    const all = await seedWebhookEndpoint({
      workspaceId: workspace.id,
      createdById: user.id,
      events: ['*'],
    })
    await seedWebhookEndpoint({
      workspaceId: workspace.id,
      createdById: user.id,
      events: ['crm.lead.created'],
    })
    await seedWebhookEndpoint({
      workspaceId: workspace.id,
      createdById: user.id,
      events: ['*'],
      active: false,
    })
    await seedWebhookEndpoint({
      workspaceId: workspace.id,
      createdById: user.id,
      events: ['*'],
      deletedAt: new Date(),
    })

    const ids = expectOk(
      await WebhookEndpointRepository.listSubscribed(
        workspace.id,
        'crm.deal.won',
      ),
    ).map((row) => row.id)
    expect(ids.sort()).toEqual([exact.id, all.id].sort())
  })

  it('should update, soft-delete and track health', async () => {
    const { workspace, user } = await setup()
    const endpoint = await seedWebhookEndpoint({
      workspaceId: workspace.id,
      createdById: user.id,
    })
    expect(
      expectOk(
        await WebhookEndpointRepository.update(endpoint.id, {
          events: ['*'],
          description: 'x',
        }),
      ).events,
    ).toEqual(['*'])

    const first = new Date('2026-10-15T12:00:00.000Z')
    const second = new Date('2026-10-16T12:00:00.000Z')
    expect(
      expectOk(await WebhookEndpointRepository.markFailure(endpoint.id, first))
        .failingSince,
    ).toEqual(first)
    const again = expectOk(
      await WebhookEndpointRepository.markFailure(endpoint.id, second),
    )
    expect(again.failingSince).toEqual(first)
    expect(again.lastFailureAt).toEqual(second)

    expectOk(await WebhookEndpointRepository.markSuccess(endpoint.id, second))
    const healthy = await prisma.webhookEndpoint.findUniqueOrThrow({
      where: { id: endpoint.id },
    })
    expect(healthy.failingSince).toBeNull()
    expect(healthy.lastSuccessAt).toEqual(second)

    expect(
      expectOk(
        await WebhookEndpointRepository.disable(endpoint.id, second, 'auto'),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await WebhookEndpointRepository.disable(endpoint.id, second, 'auto'),
      ),
    ).toBe(false)

    expectOk(await WebhookEndpointRepository.softDelete(endpoint.id))
    expectErr(
      await WebhookEndpointRepository.findById(endpoint.id, workspace.id),
      'WEBHOOK_ENDPOINT_NOT_FOUND',
    )
  })

  it('should return DATABASE_ERROR on failures', async () => {
    expectErr(
      await WebhookEndpointRepository.update('missing', { active: true }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookEndpointRepository.softDelete('missing'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookEndpointRepository.markSuccess('missing', new Date()),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookEndpointRepository.markFailure('missing', new Date()),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookEndpointRepository.create({
        workspaceId: 'missing',
        url: 'https://h.example.com',
        description: null,
        events: ['*'],
        encryptedSecret: 'enc',
        secretHint: 'abcd',
        active: true,
        createdById: 'missing',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.webhookEndpoint, 'findMany').mockRejectedValue(
      new Error('x'),
    )
    expectErr(
      await WebhookEndpointRepository.listByWorkspace('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WebhookEndpointRepository.listSubscribed('w', 'crm.deal.won'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.webhookEndpoint, 'count').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await WebhookEndpointRepository.countByWorkspace('w'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.webhookEndpoint, 'findFirst').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await WebhookEndpointRepository.findById('e', 'w'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.webhookEndpoint, 'updateMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await WebhookEndpointRepository.disable('e', new Date(), 'auto'),
      'DATABASE_ERROR',
    )
  })
})
