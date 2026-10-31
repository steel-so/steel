import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedEcomFixtures } from '@/src/__tests__/factories/nov-zap-ecom.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  WhatsAppEcomEventRepository,
  WhatsAppEcomTriggerRepository,
  WhatsAppStoreIntegrationRepository,
} from '../whatsapp-store.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function seed() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const { connection } = await seedEcomFixtures(workspace.id, user.id)
  const store = expectOk(
    await WhatsAppStoreIntegrationRepository.create({
      workspaceId: workspace.id,
      provider: 'TRAY',
      name: 'Loja',
      connectionId: connection.id,
      encryptedWebhookSecret: 'enc',
      enabled: true,
    }),
  )
  return { workspace, store }
}

const eventData = (workspaceId: string, integrationId: string, over = {}) => ({
  workspaceId,
  integrationId,
  kind: 'CART_ABANDONED' as const,
  externalId: 'c1',
  waId: '5511988887777',
  data: {},
  scheduledAt: new Date('2026-11-04T12:00:00Z'),
  ...over,
})

describe('WhatsAppStoreIntegrationRepository', () => {
  it('creates, finds, lists, updates, touches and deletes', async () => {
    const { workspace, store } = await seed()
    const other = await seedWorkspace()
    expect(expectOk(await WhatsAppStoreIntegrationRepository.list(workspace.id))).toHaveLength(1)
    expect(expectOk(await WhatsAppStoreIntegrationRepository.list(other.id))).toEqual([])
    expect(
      expectOk(await WhatsAppStoreIntegrationRepository.findById(store.id, workspace.id))?.name,
    ).toBe('Loja')
    expect(
      expectOk(await WhatsAppStoreIntegrationRepository.findById(store.id, other.id)),
    ).toBeNull()
    // Without a workspace (the public webhook) it still finds the store.
    expect(expectOk(await WhatsAppStoreIntegrationRepository.findById(store.id))?.id).toBe(
      store.id,
    )
    const updated = expectOk(
      await WhatsAppStoreIntegrationRepository.update(store.id, { name: 'Nova' }),
    )
    expect(updated.name).toBe('Nova')
    const at = new Date('2026-11-04T12:00:00Z')
    expectOk(await WhatsAppStoreIntegrationRepository.touch(store.id, at))
    expect(
      expectOk(await WhatsAppStoreIntegrationRepository.findById(store.id))?.lastEventAt,
    ).toEqual(at)
    expectOk(await WhatsAppStoreIntegrationRepository.delete(store.id))
    expect(expectOk(await WhatsAppStoreIntegrationRepository.findById(store.id))).toBeNull()
  })

  it('wraps database errors', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppStoreIntegration, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppStoreIntegration, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppStoreIntegration, 'create').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppStoreIntegration, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppStoreIntegration, 'delete').mockRejectedValue(boom)
    expectErr(await WhatsAppStoreIntegrationRepository.list('w'), 'DATABASE_ERROR')
    expectErr(await WhatsAppStoreIntegrationRepository.findById('i'), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppStoreIntegrationRepository.create({
        workspaceId: 'w',
        provider: 'TRAY',
        name: 'x',
        connectionId: 'c',
        encryptedWebhookSecret: 'e',
      }),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppStoreIntegrationRepository.update('i', {}), 'DATABASE_ERROR')
    expectErr(await WhatsAppStoreIntegrationRepository.delete('i'), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppStoreIntegrationRepository.touch('i', new Date()),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppEcomTriggerRepository', () => {
  it('keeps one trigger per kind', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await WhatsAppEcomTriggerRepository.findByKind(workspace.id, 'ORDER_SHIPPED')),
    ).toBeNull()
    const created = expectOk(
      await WhatsAppEcomTriggerRepository.upsert(workspace.id, 'ORDER_SHIPPED', {
        enabled: true,
        delayMinutes: 5,
      }),
    )
    expect(created.delayMinutes).toBe(5)
    const again = expectOk(
      await WhatsAppEcomTriggerRepository.upsert(workspace.id, 'ORDER_SHIPPED', {
        delayMinutes: 10,
      }),
    )
    expect(again.id).toBe(created.id)
    expect(again.enabled).toBe(true)
    expect(expectOk(await WhatsAppEcomTriggerRepository.list(workspace.id))).toHaveLength(1)
  })

  it('wraps database errors', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppEcomTrigger, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppEcomTrigger, 'findUnique').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppEcomTrigger, 'upsert').mockRejectedValue(boom)
    expectErr(await WhatsAppEcomTriggerRepository.list('w'), 'DATABASE_ERROR')
    expectErr(await WhatsAppEcomTriggerRepository.findByKind('w', 'ORDER_SHIPPED'), 'DATABASE_ERROR')
    expectErr(await WhatsAppEcomTriggerRepository.upsert('w', 'ORDER_SHIPPED', {}), 'DATABASE_ERROR')
  })
})

describe('WhatsAppEcomEventRepository', () => {
  it('ignores a repeated event', async () => {
    const { workspace, store } = await seed()
    const first = expectOk(
      await WhatsAppEcomEventRepository.createIfNew(eventData(workspace.id, store.id)),
    )
    expect(first?.status).toBe('PENDING')
    expect(
      expectOk(await WhatsAppEcomEventRepository.createIfNew(eventData(workspace.id, store.id))),
    ).toBeNull()
  })

  it('claims only due events once, and takes stale claims back', async () => {
    const { workspace, store } = await seed()
    const now = new Date('2026-11-04T12:00:00Z')
    const due = expectOk(
      await WhatsAppEcomEventRepository.createIfNew(
        eventData(workspace.id, store.id, { externalId: 'due' }),
      ),
    )
    expectOk(
      await WhatsAppEcomEventRepository.createIfNew(
        eventData(workspace.id, store.id, {
          externalId: 'later',
          scheduledAt: new Date('2026-11-04T13:00:00Z'),
        }),
      ),
    )
    const stale = new Date(now.getTime() - 600_000)
    const claimed = expectOk(await WhatsAppEcomEventRepository.claimDue(now, stale, 10))
    expect(claimed.map((e) => e.id)).toEqual([due?.id])
    expect(claimed[0].integration.id).toBe(store.id)
    // Already claimed: not handed out again.
    expect(expectOk(await WhatsAppEcomEventRepository.claimDue(now, stale, 10))).toEqual([])
    // A claim older than the stale window returns.
    const later = new Date(now.getTime() + 700_000)
    const retaken = expectOk(
      await WhatsAppEcomEventRepository.claimDue(later, new Date(later.getTime() - 600_000), 10),
    )
    expect(retaken.map((e) => e.id)).toContain(due?.id)
  })

  it('finishes, reschedules and measures the throttle window', async () => {
    const { workspace, store } = await seed()
    const now = new Date('2026-11-04T12:00:00Z')
    const event = expectOk(
      await WhatsAppEcomEventRepository.createIfNew(eventData(workspace.id, store.id)),
    )
    const id = event?.id as string
    const at = new Date(now.getTime() + 900_000)
    expectOk(await WhatsAppEcomEventRepository.reschedule(id, at))
    expect(
      expectOk(await WhatsAppEcomEventRepository.hasSentSince(workspace.id, '5511988887777', new Date(0))),
    ).toBe(false)
    expectOk(
      await WhatsAppEcomEventRepository.finish(id, 'SENT', { providerMessageId: 'w1' }, now),
    )
    expect(
      expectOk(
        await WhatsAppEcomEventRepository.hasSentSince(
          workspace.id,
          '5511988887777',
          new Date(now.getTime() - 1000),
        ),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await WhatsAppEcomEventRepository.hasSentSince(
          workspace.id,
          '5511988887777',
          new Date(now.getTime() + 1000),
        ),
      ),
    ).toBe(false)
    const skipped = expectOk(
      await WhatsAppEcomEventRepository.createIfNew(
        eventData(workspace.id, store.id, { externalId: 'c2' }),
      ),
    )
    expectOk(
      await WhatsAppEcomEventRepository.finish(skipped?.id as string, 'SKIPPED', { skipReason: 'x' }, now),
    )
  })

  it('skips pending carts of a contact and lists newest first', async () => {
    const { workspace, store } = await seed()
    const now = new Date('2026-11-04T12:00:00Z')
    expectOk(
      await WhatsAppEcomEventRepository.createIfNew(
        eventData(workspace.id, store.id, { externalId: 'a' }),
      ),
    )
    expectOk(
      await WhatsAppEcomEventRepository.createIfNew(
        eventData(workspace.id, store.id, { externalId: 'b', waId: '5511000000000' }),
      ),
    )
    expect(
      expectOk(
        await WhatsAppEcomEventRepository.skipPending(
          workspace.id,
          '5511988887777',
          'CART_ABANDONED',
          'Comprou',
          now,
        ),
      ),
    ).toBe(1)
    const list = expectOk(await WhatsAppEcomEventRepository.list(workspace.id))
    expect(list).toHaveLength(2)
    expect(list.find((e) => e.externalId === 'a')?.skipReason).toBe('Comprou')
    expect(list[0].integration.name).toBe('Loja')
  })

  it('wraps database errors', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppEcomEvent, 'findUnique').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppEcomEvent, 'updateMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppEcomEvent, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppEcomEvent, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppEcomEvent, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(boom)
    const now = new Date()
    expectErr(await WhatsAppEcomEventRepository.createIfNew(eventData('w', 'i')), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppEcomEventRepository.skipPending('w', 'x', 'CART_ABANDONED', 'r', now),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppEcomEventRepository.claimDue(now, now, 1), 'DATABASE_ERROR')
    expectErr(await WhatsAppEcomEventRepository.finish('e', 'SENT', {}, now), 'DATABASE_ERROR')
    expectErr(await WhatsAppEcomEventRepository.reschedule('e', now), 'DATABASE_ERROR')
    expectErr(await WhatsAppEcomEventRepository.hasSentSince('w', 'x', now), 'DATABASE_ERROR')
    expectErr(await WhatsAppEcomEventRepository.list('w'), 'DATABASE_ERROR')
  })
})
