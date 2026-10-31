import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedEcomFixtures } from '@/src/__tests__/factories/nov-zap-ecom.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  WhatsAppCatalogOrderRepository,
  WhatsAppCatalogProductRepository,
  WhatsAppCommerceSettingsRepository,
} from '../whatsapp-catalog.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

const product = (retailerId: string, over = {}) => ({
  externalId: `e-${retailerId}`,
  retailerId,
  name: `Produto ${retailerId}`,
  description: null,
  price: 10,
  currency: 'BRL',
  imageUrl: null,
  url: null,
  available: true,
  ...over,
})

describe('WhatsAppCommerceSettingsRepository', () => {
  it('upserts one row per workspace', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await WhatsAppCommerceSettingsRepository.findByWorkspace(workspace.id)),
    ).toBeNull()
    const created = expectOk(
      await WhatsAppCommerceSettingsRepository.upsert(workspace.id, {
        catalogEnabled: true,
      }),
    )
    expect(created.catalogEnabled).toBe(true)
    expect(created.throttleHours).toBe(24)
    const updated = expectOk(
      await WhatsAppCommerceSettingsRepository.upsert(workspace.id, {
        throttleHours: 6,
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.throttleHours).toBe(6)
  })

  it('wraps database errors', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppCommerceSettings, 'findUnique').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppCommerceSettings, 'upsert').mockRejectedValue(boom)
    expectErr(await WhatsAppCommerceSettingsRepository.findByWorkspace('w'), 'DATABASE_ERROR')
    expectErr(await WhatsAppCommerceSettingsRepository.upsert('w', {}), 'DATABASE_ERROR')
  })
})

describe('WhatsAppCatalogProductRepository', () => {
  it('syncs a source: creates, updates and retires what left', async () => {
    const workspace = await seedWorkspace()
    const other = await seedWorkspace()
    const first = expectOk(
      await WhatsAppCatalogProductRepository.syncSource(workspace.id, 'CRM', [
        product('A'),
        product('B'),
      ]),
    )
    expect(first).toEqual({ created: 2, updated: 0, removed: 0 })

    const second = expectOk(
      await WhatsAppCatalogProductRepository.syncSource(workspace.id, 'CRM', [
        product('A', { name: 'Novo nome', price: 12 }),
        product('C'),
      ]),
    )
    expect(second).toEqual({ created: 1, updated: 1, removed: 1 })

    const all = expectOk(await WhatsAppCatalogProductRepository.list(workspace.id))
    expect(all.map((p) => [p.retailerId, p.available])).toEqual([
      ['A', true],
      ['C', true],
      ['B', false],
    ])
    expect(all.find((p) => p.retailerId === 'A')?.name).toBe('Novo nome')

    // Another source is left alone, and another workspace sees nothing.
    expect(expectOk(await WhatsAppCatalogProductRepository.list(other.id))).toEqual([])
    expectOk(
      await WhatsAppCatalogProductRepository.syncSource(workspace.id, 'TRAY', [product('T')]),
    )
    expectOk(await WhatsAppCatalogProductRepository.syncSource(workspace.id, 'CRM', []))
    const tray = expectOk(
      await WhatsAppCatalogProductRepository.list(workspace.id, { available: true }),
    )
    expect(tray.map((p) => p.retailerId)).toEqual(['T'])
  })

  it('filters by name and finds by ids and retailer ids', async () => {
    const workspace = await seedWorkspace()
    expectOk(
      await WhatsAppCatalogProductRepository.syncSource(workspace.id, 'CRM', [
        product('A', { name: 'Camiseta azul' }),
        product('B', { name: 'Boné' }),
      ]),
    )
    const found = expectOk(
      await WhatsAppCatalogProductRepository.list(workspace.id, { search: 'CAMI' }),
    )
    expect(found.map((p) => p.retailerId)).toEqual(['A'])
    const byRetailer = expectOk(
      await WhatsAppCatalogProductRepository.findManyByRetailerIds(workspace.id, ['B', 'zz']),
    )
    expect(byRetailer).toHaveLength(1)
    const byIds = expectOk(
      await WhatsAppCatalogProductRepository.findManyByIds(workspace.id, [
        found[0].id,
        'nope',
      ]),
    )
    expect(byIds).toHaveLength(1)
    const other = await seedWorkspace()
    expect(
      expectOk(await WhatsAppCatalogProductRepository.findManyByIds(other.id, [found[0].id])),
    ).toEqual([])
  })

  it('toggles availability inside the workspace only', async () => {
    const workspace = await seedWorkspace()
    const other = await seedWorkspace()
    expectOk(
      await WhatsAppCatalogProductRepository.syncSource(workspace.id, 'CRM', [product('A')]),
    )
    const [row] = expectOk(await WhatsAppCatalogProductRepository.list(workspace.id))
    expect(
      expectOk(await WhatsAppCatalogProductRepository.setAvailable(other.id, row.id, false)),
    ).toBeNull()
    expect(
      expectOk(await WhatsAppCatalogProductRepository.setAvailable(workspace.id, row.id, false))
        ?.available,
    ).toBe(false)
  })

  it('wraps database errors', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppCatalogProduct, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppCatalogProduct, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma, '$transaction').mockRejectedValue(boom)
    expectErr(await WhatsAppCatalogProductRepository.list('w'), 'DATABASE_ERROR')
    expectErr(await WhatsAppCatalogProductRepository.findManyByIds('w', []), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppCatalogProductRepository.findManyByRetailerIds('w', []),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppCatalogProductRepository.setAvailable('w', 'p', true), 'DATABASE_ERROR')
    expectErr(await WhatsAppCatalogProductRepository.syncSource('w', 'CRM', []), 'DATABASE_ERROR')
  })
})

describe('WhatsAppCatalogOrderRepository', () => {
  it('stores a cart once per provider message and lists newest first', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const { contact } = await seedEcomFixtures(workspace.id, user.id)
    const data = {
      workspaceId: workspace.id,
      contactId: contact.id,
      providerMessageId: 'wamid.1',
      items: [{ retailerId: 'A', name: 'A', quantity: 1, unitPrice: 10 }],
      total: 10,
    }
    const created = expectOk(await WhatsAppCatalogOrderRepository.create(data))
    expect(created?.currency).toBe('BRL')
    expect(expectOk(await WhatsAppCatalogOrderRepository.create(data))).toBeNull()
    expectOk(
      await WhatsAppCatalogOrderRepository.create({ ...data, providerMessageId: 'wamid.2' }),
    )
    const updated = expectOk(
      await WhatsAppCatalogOrderRepository.update(created?.id as string, {
        leadId: 'lead1',
      }),
    )
    expect(updated.leadId).toBe('lead1')
    const list = expectOk(await WhatsAppCatalogOrderRepository.list(workspace.id))
    expect(list).toHaveLength(2)
    expect(list[0].contact.waId).toBe(contact.waId)
    expect(expectOk(await WhatsAppCatalogOrderRepository.list('other'))).toEqual([])
  })

  it('wraps database errors', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppCatalogOrder, 'findUnique').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppCatalogOrder, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppCatalogOrder, 'findMany').mockRejectedValue(boom)
    expectErr(
      await WhatsAppCatalogOrderRepository.create({
        workspaceId: 'w',
        contactId: 'c',
        providerMessageId: 'p',
        items: [],
        total: 0,
      }),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppCatalogOrderRepository.update('o', {}), 'DATABASE_ERROR')
    expectErr(await WhatsAppCatalogOrderRepository.list('w'), 'DATABASE_ERROR')
  })
})
