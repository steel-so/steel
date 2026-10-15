import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSiteGlobal,
} from '@/src/__tests__/factories/site.factory'
import {
  createFakeCollectionItem,
  createFakeSiteCollection,
} from '@/src/__tests__/factories/site-blog.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-collection.repository')
vi.mock('@/src/repositories/site-global.repository')
vi.mock('@/src/repositories/crm-product.repository')
vi.mock('@/src/lib/sites/cache')
vi.mock('@/lib/axiom/audit')

import type { CrmProduct, Prisma } from '@prisma/client'
import { revalidateSites } from '@/src/lib/sites/cache'
import { CrmProductRepository } from '@/src/repositories/crm-product.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteCollectionRepository } from '@/src/repositories/site-collection.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import {
  MAX_COLLECTIONS_PER_SITE,
  MAX_ITEMS_PER_COLLECTION,
  SiteCollectionService as Svc,
} from '../site-collection.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const repo = vi.mocked(SiteCollectionRepository)
const globals = vi.mocked(SiteGlobalRepository)
const products = vi.mocked(CrmProductRepository)
const revalidate = vi.mocked(revalidateSites)

const WS = 'ws1'
const SITE = 'site1'
const site = createFakeSite({ id: SITE, workspaceId: WS, slug: 'clinica' })
const collection = createFakeSiteCollection({
  id: 'col1',
  siteId: SITE,
  fields: [
    { key: 'resumo', label: 'Resumo', type: 'text', required: true },
    { key: 'area', label: 'Área', type: 'reference', collectionId: 'col2' },
    { key: 'plano', label: 'Plano', type: 'product' },
  ],
  _count: { items: 2 },
})
const item = createFakeCollectionItem({
  id: 'i1',
  collectionId: 'col1',
  slug: 'item',
})

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  asRole('MEMBER')
  sites.findById.mockResolvedValue(ok(site))
  repo.list.mockResolvedValue(ok([collection]))
  repo.findById.mockResolvedValue(ok(collection))
  repo.count.mockResolvedValue(ok(1))
  repo.create.mockImplementation(async (data) =>
    ok(createFakeSiteCollection({ ...(data as object), id: 'new' } as never)),
  )
  repo.update.mockImplementation(async (id, data) =>
    ok(
      createFakeSiteCollection({
        ...collection,
        ...(data as object),
        id,
      } as never),
    ),
  )
  repo.delete.mockResolvedValue(ok(undefined))
  repo.listItems.mockResolvedValue(ok([item]))
  repo.findItem.mockResolvedValue(ok(item))
  repo.findItemsInSite.mockResolvedValue(
    ok([
      {
        ...createFakeCollectionItem({ id: 'ref1' }),
        collection: { id: 'col2' },
      },
    ]),
  )
  repo.itemSlugsLike.mockResolvedValue(ok([]))
  repo.createItem.mockImplementation(async (data) =>
    ok(createFakeCollectionItem({ ...(data as object), id: 'i2' } as never)),
  )
  repo.updateItem.mockImplementation(async (id, data) =>
    ok(createFakeCollectionItem({ ...item, ...(data as object), id } as never)),
  )
  repo.deleteItem.mockResolvedValue(ok(undefined))
  repo.reorderItems.mockResolvedValue(ok(undefined))
  globals.create.mockResolvedValue(
    ok(
      createFakeSiteGlobal({
        id: 'g1',
        siteId: SITE,
        kind: 'TEMPLATE',
        name: 'collection:col1',
      }),
    ),
  )
  globals.findById.mockResolvedValue(
    ok(createFakeSiteGlobal({ id: 'g0', siteId: SITE, kind: 'TEMPLATE' })),
  )
  globals.delete.mockResolvedValue(ok(undefined))
  products.findById.mockResolvedValue(
    ok({
      id: 'p1',
      name: 'Plano Pro',
      unitPrice: 99.9 as unknown as Prisma.Decimal,
      currency: 'BRL',
    } as CrmProduct),
  )
})

describe('authorization', () => {
  it('blocks viewers, members on deletes and other workspaces', async () => {
    asRole('VIEWER')
    expectOk(await Svc.list('u1', WS, SITE))
    expectOk(await Svc.get('u1', WS, SITE, 'col1'))
    expectOk(await Svc.listItems('u1', WS, SITE, 'col1'))
    expectErr(await Svc.create('u1', WS, SITE, { name: 'X' }), 'FORBIDDEN')
    expectErr(
      await Svc.update('u1', WS, SITE, 'col1', { name: 'X' }),
      'FORBIDDEN',
    )
    expectErr(await Svc.ensureItemTemplate('u1', WS, SITE, 'col1'), 'FORBIDDEN')
    expectErr(
      await Svc.createItem('u1', WS, SITE, 'col1', { title: 'X' }),
      'FORBIDDEN',
    )
    expectErr(
      await Svc.updateItem('u1', WS, SITE, 'col1', 'i1', { title: 'X' }),
      'FORBIDDEN',
    )
    expectErr(
      await Svc.reorderItems('u1', WS, SITE, 'col1', { orderedIds: ['i1'] }),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    expectErr(await Svc.remove('u1', WS, SITE, 'col1'), 'FORBIDDEN')
    expectErr(await Svc.removeItem('u1', WS, SITE, 'col1', 'i1'), 'FORBIDDEN')
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Svc.list('u1', WS, SITE), 'FORBIDDEN')
    expectErr(await Svc.get('u1', WS, SITE, 'col1'), 'FORBIDDEN')
    expectErr(await Svc.listItems('u1', WS, SITE, 'col1'), 'FORBIDDEN')
  })
})

describe('collections', () => {
  it('lists, gets and creates', async () => {
    expect(expectOk(await Svc.list('u1', WS, SITE))[0]).toMatchObject({
      id: 'col1',
      itemCount: 2,
    })
    expect(expectOk(await Svc.get('u1', WS, SITE, 'col1')).fields).toHaveLength(
      3,
    )
    expectOk(await Svc.create('u1', WS, SITE, { name: 'Casos de Sucesso' }))
    expect(repo.create).toHaveBeenCalledWith({
      siteId: SITE,
      name: 'Casos de Sucesso',
      itemName: 'Item',
      slug: 'casos-de-sucesso',
      fields: [],
      position: 1,
    })
    expectOk(
      await Svc.create('u1', WS, SITE, {
        name: '!!!',
        itemName: 'Caso',
        slug: 'casos',
        fields: [
          { key: 'r', label: 'R', type: 'reference', collectionId: 'col1' },
        ],
      }),
    )
    expectOk(await Svc.create('u1', WS, SITE, { name: '!!!' }))
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'colecao' }),
    )
  })

  it('rejects limits, foreign reference targets and errors', async () => {
    repo.count.mockResolvedValueOnce(ok(MAX_COLLECTIONS_PER_SITE))
    expectErr(
      await Svc.create('u1', WS, SITE, { name: 'X' }),
      'SITE_LIMIT_REACHED',
    )
    repo.count.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.create('u1', WS, SITE, { name: 'X' }), 'DATABASE_ERROR')
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.create('u1', WS, SITE, {
        name: 'X',
        fields: [
          { key: 'r', label: 'R', type: 'reference', collectionId: 'other' },
        ],
      }),
      'SITE_COLLECTION_NOT_FOUND',
    )
    repo.create.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_SLUG_TAKEN', 'x')),
    )
    expectErr(
      await Svc.create('u1', WS, SITE, { name: 'X' }),
      'SITE_COLLECTION_SLUG_TAKEN',
    )
    repo.list.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.list('u1', WS, SITE), 'DATABASE_ERROR')
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(await Svc.get('u1', WS, SITE, 'x'), 'SITE_COLLECTION_NOT_FOUND')
  })

  it('updates fields (self references allowed) and expires the cache', async () => {
    expectOk(
      await Svc.update('u1', WS, SITE, 'col1', {
        name: 'N',
        itemName: 'I',
        slug: 's',
        fields: [
          { key: 'r', label: 'R', type: 'reference', collectionId: 'col1' },
          { key: 'o', label: 'O', type: 'reference', collectionId: 'col2' },
        ],
      }),
    )
    expect(repo.findById).toHaveBeenCalledWith('col2', SITE)
    expect(revalidate).toHaveBeenCalledWith('clinica')
    expectOk(await Svc.update('u1', WS, SITE, 'col1', { name: 'Só nome' }))
    expect(repo.update).toHaveBeenLastCalledWith('col1', { name: 'Só nome' })
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.update('u1', WS, SITE, 'x', { name: 'a' }),
      'SITE_COLLECTION_NOT_FOUND',
    )
    repo.findById
      .mockResolvedValueOnce(ok(collection))
      .mockResolvedValueOnce(err(appError('SITE_COLLECTION_NOT_FOUND', 'x')))
    expectErr(
      await Svc.update('u1', WS, SITE, 'col1', {
        fields: [
          { key: 'o', label: 'O', type: 'reference', collectionId: 'zz' },
        ],
      }),
      'SITE_COLLECTION_NOT_FOUND',
    )
    repo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.update('u1', WS, SITE, 'col1', { name: 'a' }),
      'DATABASE_ERROR',
    )
  })

  it('removes a collection with its template', async () => {
    asRole('ADMIN')
    expectOk(await Svc.remove('u1', WS, SITE, 'col1'))
    expect(globals.delete).not.toHaveBeenCalled()
    repo.findById.mockResolvedValueOnce(
      ok({ ...collection, templateGlobalId: 'g9' }),
    )
    expectOk(await Svc.remove('u1', WS, SITE, 'col1'))
    expect(globals.delete).toHaveBeenCalledWith('g9')
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.remove('u1', WS, SITE, 'x'),
      'SITE_COLLECTION_NOT_FOUND',
    )
    repo.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.remove('u1', WS, SITE, 'col1'), 'DATABASE_ERROR')
  })

  it('creates or returns the item template', async () => {
    const created = expectOk(
      await Svc.ensureItemTemplate('u1', WS, SITE, 'col1'),
    )
    expect(created.id).toBe('g1')
    expect(globals.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'TEMPLATE', name: 'collection:col1' }),
    )
    expect(repo.update).toHaveBeenCalledWith('col1', { templateGlobalId: 'g1' })
    repo.findById.mockResolvedValueOnce(
      ok({ ...collection, templateGlobalId: 'g0' }),
    )
    expect(
      expectOk(await Svc.ensureItemTemplate('u1', WS, SITE, 'col1')).id,
    ).toBe('g0')
    repo.findById.mockResolvedValueOnce(
      ok({ ...collection, templateGlobalId: 'gone' }),
    )
    globals.findById.mockResolvedValueOnce(
      err(appError('SITE_GLOBAL_NOT_FOUND', 'x')),
    )
    expect(
      expectOk(await Svc.ensureItemTemplate('u1', WS, SITE, 'col1')).id,
    ).toBe('g1')
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.ensureItemTemplate('u1', WS, SITE, 'x'),
      'SITE_COLLECTION_NOT_FOUND',
    )
    globals.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.ensureItemTemplate('u1', WS, SITE, 'col1'),
      'DATABASE_ERROR',
    )
    repo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.ensureItemTemplate('u1', WS, SITE, 'col1'),
      'DATABASE_ERROR',
    )
  })
})

describe('items', () => {
  it('lists items with filters', async () => {
    expect(
      expectOk(
        await Svc.listItems('u1', WS, SITE, 'col1', { status: 'PUBLISHED' }),
      ),
    ).toHaveLength(1)
    expect(repo.listItems).toHaveBeenCalledWith('col1', { status: 'PUBLISHED' })
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.listItems('u1', WS, SITE, 'x'),
      'SITE_COLLECTION_NOT_FOUND',
    )
    repo.listItems.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.listItems('u1', WS, SITE, 'col1'), 'DATABASE_ERROR')
  })

  it('creates an item: validates, checks references and fills the product', async () => {
    const now = new Date('2026-10-15T12:00:00Z')
    expectOk(
      await Svc.createItem(
        'u1',
        WS,
        SITE,
        'col1',
        {
          title: 'Dev Back-end',
          status: 'PUBLISHED',
          data: { resumo: 'Node', area: 'ref1', plano: { id: 'p1' } },
        },
        now,
      ),
    )
    expect(repo.createItem).toHaveBeenCalledWith({
      collectionId: 'col1',
      title: 'Dev Back-end',
      slug: 'dev-back-end',
      data: {
        resumo: 'Node',
        area: 'ref1',
        plano: { id: 'p1', name: 'Plano Pro', price: 9990, currency: 'BRL' },
      },
      status: 'PUBLISHED',
      position: 2,
      publishedAt: now,
    })
    expect(revalidate).toHaveBeenCalledWith('clinica')
    expectOk(
      await Svc.createItem('u1', WS, SITE, 'col1', {
        title: '!!!',
        data: { resumo: 'x' },
      }),
    )
    expect(repo.createItem).toHaveBeenLastCalledWith(
      expect.objectContaining({
        slug: 'item',
        status: 'DRAFT',
        publishedAt: null,
      }),
    )
    expect(revalidate).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid data, references, products, slugs and limits', async () => {
    expectErr(
      await Svc.createItem('u1', WS, SITE, 'col1', { title: 'X' }),
      'SITE_COLLECTION_ITEM_INVALID',
    )
    const run = (data: Record<string, unknown>) =>
      Svc.createItem('u1', WS, SITE, 'col1', {
        title: 'X',
        data: { resumo: 'a', ...data },
      })
    repo.findItemsInSite.mockResolvedValueOnce(ok([]))
    expectErr(await run({ area: 'missing' }), 'SITE_COLLECTION_ITEM_INVALID')
    repo.findItemsInSite.mockResolvedValueOnce(
      ok([
        {
          ...createFakeCollectionItem({ id: 'ref1' }),
          collection: { id: 'col9' },
        },
      ]),
    )
    expectErr(await run({ area: 'ref1' }), 'SITE_COLLECTION_ITEM_INVALID')
    repo.findItemsInSite.mockResolvedValueOnce(err(databaseError()))
    expectErr(await run({ area: 'ref1' }), 'DATABASE_ERROR')
    products.findById.mockResolvedValueOnce(err(notFound('CrmProduct')))
    expectErr(
      await run({ plano: { id: 'p9' } }),
      'SITE_COLLECTION_ITEM_INVALID',
    )
    repo.itemSlugsLike.mockResolvedValueOnce(ok(['x']))
    expectErr(
      await Svc.createItem('u1', WS, SITE, 'col1', {
        title: 'X',
        slug: 'x',
        data: { resumo: 'a' },
      }),
      'SITE_COLLECTION_ITEM_SLUG_TAKEN',
    )
    repo.itemSlugsLike.mockResolvedValueOnce(err(databaseError()))
    expectErr(await run({}), 'DATABASE_ERROR')
    repo.createItem.mockResolvedValueOnce(err(databaseError()))
    expectErr(await run({}), 'DATABASE_ERROR')
    repo.findById.mockResolvedValueOnce(
      ok({ ...collection, _count: { items: MAX_ITEMS_PER_COLLECTION } }),
    )
    expectErr(await run({}), 'SITE_LIMIT_REACHED')
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(await run({}), 'SITE_COLLECTION_NOT_FOUND')
  })

  it('updates items, publishing sets the date once', async () => {
    const now = new Date('2026-10-15T12:00:00Z')
    expectOk(
      await Svc.updateItem(
        'u1',
        WS,
        SITE,
        'col1',
        'i1',
        {
          title: 'T',
          slug: 'novo',
          data: { resumo: 'b' },
          status: 'PUBLISHED',
        },
        now,
      ),
    )
    expect(repo.updateItem).toHaveBeenCalledWith('i1', {
      title: 'T',
      slug: 'novo',
      data: { resumo: 'b' },
      status: 'PUBLISHED',
      publishedAt: now,
    })
    expect(revalidate).toHaveBeenCalledWith('clinica')
    repo.findItem.mockResolvedValueOnce(
      ok({ ...item, status: 'PUBLISHED', publishedAt: now }),
    )
    expectOk(
      await Svc.updateItem('u1', WS, SITE, 'col1', 'i1', {
        status: 'PUBLISHED',
        slug: 'item',
      }),
    )
    expect(repo.updateItem).toHaveBeenLastCalledWith('i1', {
      status: 'PUBLISHED',
    })
    expectOk(
      await Svc.updateItem('u1', WS, SITE, 'col1', 'i1', { status: 'DRAFT' }),
    )
  })

  it('reports update errors', async () => {
    const run = (dto: Parameters<typeof Svc.updateItem>[5]) =>
      Svc.updateItem('u1', WS, SITE, 'col1', 'i1', dto)
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(await run({ title: 'a' }), 'SITE_COLLECTION_NOT_FOUND')
    repo.findItem.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_ITEM_NOT_FOUND', 'x')),
    )
    expectErr(await run({ title: 'a' }), 'SITE_COLLECTION_ITEM_NOT_FOUND')
    repo.itemSlugsLike.mockResolvedValueOnce(ok(['taken']))
    expectErr(await run({ slug: 'taken' }), 'SITE_COLLECTION_ITEM_SLUG_TAKEN')
    repo.itemSlugsLike.mockResolvedValueOnce(err(databaseError()))
    expectErr(await run({ slug: 'x' }), 'DATABASE_ERROR')
    expectErr(await run({ data: {} }), 'SITE_COLLECTION_ITEM_INVALID')
    repo.updateItem.mockResolvedValueOnce(err(databaseError()))
    expectErr(await run({ title: 'a' }), 'DATABASE_ERROR')
  })

  it('removes and reorders items', async () => {
    asRole('ADMIN')
    expectOk(await Svc.removeItem('u1', WS, SITE, 'col1', 'i1'))
    expect(revalidate).not.toHaveBeenCalled()
    repo.findItem.mockResolvedValueOnce(ok({ ...item, status: 'PUBLISHED' }))
    expectOk(await Svc.removeItem('u1', WS, SITE, 'col1', 'i1'))
    expect(revalidate).toHaveBeenCalledWith('clinica')
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.removeItem('u1', WS, SITE, 'x', 'i1'),
      'SITE_COLLECTION_NOT_FOUND',
    )
    repo.findItem.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_ITEM_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.removeItem('u1', WS, SITE, 'col1', 'x'),
      'SITE_COLLECTION_ITEM_NOT_FOUND',
    )
    repo.deleteItem.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.removeItem('u1', WS, SITE, 'col1', 'i1'),
      'DATABASE_ERROR',
    )

    expect(
      expectOk(
        await Svc.reorderItems('u1', WS, SITE, 'col1', { orderedIds: ['i1'] }),
      ),
    ).toHaveLength(1)
    expect(repo.reorderItems).toHaveBeenCalledWith('col1', ['i1'])
    repo.findById.mockResolvedValueOnce(
      err(appError('SITE_COLLECTION_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.reorderItems('u1', WS, SITE, 'x', { orderedIds: ['i1'] }),
      'SITE_COLLECTION_NOT_FOUND',
    )
    repo.reorderItems.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.reorderItems('u1', WS, SITE, 'col1', { orderedIds: ['i1'] }),
      'DATABASE_ERROR',
    )
    repo.listItems.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.reorderItems('u1', WS, SITE, 'col1', { orderedIds: ['i1'] }),
      'DATABASE_ERROR',
    )
  })
})
