import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmProduct } from '@/src/__tests__/factories/crm-product.factory'
import {
  createFakeCatalogOrder,
  createFakeCatalogProduct,
  createFakeCommerceSettings,
  createFakeStoreIntegration,
} from '@/src/__tests__/factories/nov-zap-ecom.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../authz', () => ({
  assertModuleMember: vi.fn(),
  assertModulePrivileged: vi.fn(),
}))
vi.mock('../whatsapp-conversation-scope.service', () => ({
  resolveConversationScope: vi.fn(),
  loadVisibleConversation: vi.fn(),
}))
vi.mock('../whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: { assertOpen: vi.fn() },
}))
vi.mock('../whatsapp-automation-send.service', () => ({
  recordOutboundMessage: vi.fn(async () => ({ ok: true, value: undefined })),
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async () =>
    JSON.stringify({ accessToken: 'tok', storeId: '9' }),
  ),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { products: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/catalog/store-adapters', () => ({
  getStoreCatalogAdapter: vi.fn(),
}))
vi.mock('@/src/repositories/crm-pipeline.repository')
vi.mock('@/src/repositories/crm-product.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-catalog.repository')
vi.mock('@/src/repositories/whatsapp-store.repository')

import { getStoreCatalogAdapter } from '@/src/lib/whatsapp/catalog/store-adapters'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { CrmPipelineRepository } from '@/src/repositories/crm-pipeline.repository'
import { CrmProductRepository } from '@/src/repositories/crm-product.repository'
import {
  WhatsAppCatalogOrderRepository,
  WhatsAppCatalogProductRepository,
  WhatsAppCommerceSettingsRepository,
} from '@/src/repositories/whatsapp-catalog.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppStoreIntegrationRepository } from '@/src/repositories/whatsapp-store.repository'
import { assertModuleMember, assertModulePrivileged } from '../authz'
import { recordOutboundMessage } from '../whatsapp-automation-send.service'
import { WhatsAppBusinessHoursService } from '../whatsapp-business-hours.service'
import { WhatsAppCommerceService } from '../whatsapp-commerce.service'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from '../whatsapp-conversation-scope.service'

const member = vi.mocked(assertModuleMember)
const privileged = vi.mocked(assertModulePrivileged)
const scope = vi.mocked(resolveConversationScope)
const loadConversation = vi.mocked(loadVisibleConversation)
const hours = vi.mocked(WhatsAppBusinessHoursService.assertOpen)
const settingsRepo = vi.mocked(WhatsAppCommerceSettingsRepository)
const productRepo = vi.mocked(WhatsAppCatalogProductRepository)
const orderRepo = vi.mocked(WhatsAppCatalogOrderRepository)
const storeRepo = vi.mocked(WhatsAppStoreIntegrationRepository)
const crmProducts = vi.mocked(CrmProductRepository)
const pipelines = vi.mocked(CrmPipelineRepository)
const connections = vi.mocked(WhatsAppConnectionRepository)
const send = vi.mocked(WhatsAppSend.products)
const adapterFor = vi.mocked(getStoreCatalogAdapter)

const dbErr = () => err(databaseError('x'))
const WS = 'ws1'
const USER = 'u1'

beforeEach(() => {
  vi.clearAllMocks()
  member.mockResolvedValue(ok({ role: 'MEMBER' } as never))
  privileged.mockResolvedValue(ok({ role: 'ADMIN' } as never))
  scope.mockResolvedValue(ok({} as never))
  hours.mockResolvedValue(ok(undefined))
})

describe('settings', () => {
  it('reads the defaults for a workspace that never saved', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    const dto = expectOk(await WhatsAppCommerceService.getSettings(USER, WS))
    expect(dto).toMatchObject({ catalogEnabled: false, triggersEnabled: false })
  })

  it('requires module membership to read', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppCommerceService.getSettings(USER, WS))
    member.mockResolvedValue(ok({} as never))
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppCommerceService.getSettings(USER, WS))
  })

  it('refuses non-admins', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCommerceService.updateSettings(USER, WS, {
        catalogEnabled: true,
      }),
      'FORBIDDEN',
    )
  })

  it('needs a Meta catalog id before the catalog turns on', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCommerceService.updateSettings(USER, WS, {
        catalogEnabled: true,
      }),
      'WHATSAPP_CATALOG_INVALID',
    )
  })

  it('saves, makes the actor the owner of the automation and audits', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    settingsRepo.upsert.mockResolvedValue(
      ok(createFakeCommerceSettings({ workspaceId: WS })),
    )
    const dto = expectOk(
      await WhatsAppCommerceService.updateSettings(USER, WS, {
        catalogEnabled: true,
        metaCatalogId: '1234567890',
      }),
    )
    expect(dto.catalogEnabled).toBe(true)
    expect(settingsRepo.upsert).toHaveBeenCalledWith(WS, {
      catalogEnabled: true,
      metaCatalogId: '1234567890',
      ownerUserId: USER,
    })
  })

  it('keeps the existing owner', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ workspaceId: WS, ownerUserId: 'owner' })),
    )
    settingsRepo.upsert.mockResolvedValue(ok(createFakeCommerceSettings()))
    expectOk(
      await WhatsAppCommerceService.updateSettings(USER, WS, {
        throttleHours: 2,
      }),
    )
    expect(settingsRepo.upsert).toHaveBeenCalledWith(WS, { throttleHours: 2 })
  })

  it('checks the store and the pipeline exist in the workspace', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeCommerceSettings({ catalogSource: 'TRAY', ownerUserId: 'o' }),
      ),
    )
    storeRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCommerceService.updateSettings(USER, WS, {
        catalogIntegrationId: 'nope',
      }),
      'WHATSAPP_STORE_NOT_FOUND',
    )
    storeRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppCommerceService.updateSettings(USER, WS, {
        catalogIntegrationId: 'x',
      }),
    )

    storeRepo.findById.mockResolvedValue(ok(createFakeStoreIntegration()))
    pipelines.findById.mockResolvedValue(
      err({ code: 'RESOURCE_NOT_FOUND', message: 'x' } as never),
    )
    expectErr(
      await WhatsAppCommerceService.updateSettings(USER, WS, {
        orderPipelineId: 'p',
      }),
      'BAD_REQUEST',
    )
    pipelines.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppCommerceService.updateSettings(USER, WS, {
        orderPipelineId: 'p',
      }),
      'DATABASE_ERROR',
    )
  })

  it('propagates repository failures on update', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppCommerceService.updateSettings(USER, WS, {}))
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    settingsRepo.upsert.mockResolvedValue(dbErr())
    expectErr(await WhatsAppCommerceService.updateSettings(USER, WS, {}))
  })
})

describe('products', () => {
  it('lists with the filters', async () => {
    productRepo.list.mockResolvedValue(ok([createFakeCatalogProduct()]))
    const rows = expectOk(
      await WhatsAppCommerceService.listProducts(USER, WS, { available: true }),
    )
    expect(rows).toHaveLength(1)
    expect(productRepo.list).toHaveBeenCalledWith(WS, { available: true })
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppCommerceService.listProducts(USER, WS))
    member.mockResolvedValue(ok({} as never))
    productRepo.list.mockResolvedValue(dbErr())
    expectErr(await WhatsAppCommerceService.listProducts(USER, WS))
  })

  it('toggles availability', async () => {
    const product = createFakeCatalogProduct({ available: false })
    productRepo.setAvailable.mockResolvedValue(ok(product))
    expect(
      expectOk(
        await WhatsAppCommerceService.setProductAvailable(USER, WS, 'p', false),
      ).available,
    ).toBe(false)
    productRepo.setAvailable.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCommerceService.setProductAvailable(USER, WS, 'p', true),
      'WHATSAPP_CATALOG_PRODUCT_NOT_FOUND',
    )
    productRepo.setAvailable.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppCommerceService.setProductAvailable(USER, WS, 'p', true),
    )
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCommerceService.setProductAvailable(USER, WS, 'p', true),
    )
  })
})

describe('sync', () => {
  const syncResult = { created: 1, updated: 0, removed: 0 }

  beforeEach(() => {
    settingsRepo.upsert.mockResolvedValue(ok(createFakeCommerceSettings()))
    productRepo.syncSource.mockResolvedValue(ok(syncResult))
  })

  it('needs the catalog on', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCommerceService.sync(USER, WS),
      'WHATSAPP_CATALOG_DISABLED',
    )
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ metaCatalogId: null })),
    )
    expectErr(
      await WhatsAppCommerceService.sync(USER, WS),
      'WHATSAPP_CATALOG_DISABLED',
    )
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppCommerceService.sync(USER, WS), 'DATABASE_ERROR')
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppCommerceService.sync(USER, WS), 'FORBIDDEN')
  })

  it('mirrors the CRM products, using the SKU as the Meta id', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    crmProducts.listByWorkspace.mockResolvedValue(
      ok([
        createFakeCrmProduct({ id: 'a', sku: ' SKU-A ', name: 'A' }),
        createFakeCrmProduct({ id: 'b', sku: null, name: 'B' }),
      ]),
    )
    expect(expectOk(await WhatsAppCommerceService.sync(USER, WS))).toEqual(
      syncResult,
    )
    const [, source, products] = productRepo.syncSource.mock.calls[0]
    expect(source).toBe('CRM')
    expect(products.map((p) => p.retailerId)).toEqual(['SKU-A', 'b'])
    expect(settingsRepo.upsert).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ lastCatalogSyncAt: expect.any(Date) }),
    )
  })

  it('propagates CRM and sync failures', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    crmProducts.listByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppCommerceService.sync(USER, WS))
    crmProducts.listByWorkspace.mockResolvedValue(ok([]))
    productRepo.syncSource.mockResolvedValue(dbErr())
    expectErr(await WhatsAppCommerceService.sync(USER, WS))
  })

  describe('store source', () => {
    const settings = (over = {}) =>
      createFakeCommerceSettings({
        catalogSource: 'NUVEMSHOP',
        catalogIntegrationId: 'st1',
        storeSyncEnabled: true,
        ...over,
      })
    const store = (over = {}) =>
      createFakeStoreIntegration({
        provider: 'NUVEMSHOP',
        encryptedCredentials: 'enc',
        storeUrl: 'https://loja',
        ...over,
      })

    it('refuses while the store sync is off or no store is chosen', async () => {
      settingsRepo.findByWorkspace.mockResolvedValue(
        ok(settings({ storeSyncEnabled: false })),
      )
      expectErr(
        await WhatsAppCommerceService.sync(USER, WS),
        'WHATSAPP_CATALOG_INVALID',
      )
      settingsRepo.findByWorkspace.mockResolvedValue(
        ok(settings({ catalogIntegrationId: null })),
      )
      expectErr(
        await WhatsAppCommerceService.sync(USER, WS),
        'WHATSAPP_CATALOG_INVALID',
      )
    })

    it('needs a matching store with credentials', async () => {
      settingsRepo.findByWorkspace.mockResolvedValue(ok(settings()))
      storeRepo.findById.mockResolvedValue(dbErr())
      expectErr(await WhatsAppCommerceService.sync(USER, WS), 'DATABASE_ERROR')
      storeRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppCommerceService.sync(USER, WS),
        'WHATSAPP_STORE_NOT_FOUND',
      )
      storeRepo.findById.mockResolvedValue(ok(store({ provider: 'TRAY' })))
      expectErr(
        await WhatsAppCommerceService.sync(USER, WS),
        'WHATSAPP_CATALOG_INVALID',
      )
      storeRepo.findById.mockResolvedValue(
        ok(store({ encryptedCredentials: null })),
      )
      expectErr(
        await WhatsAppCommerceService.sync(USER, WS),
        'WHATSAPP_CATALOG_INVALID',
      )
    })

    it('reads the store through its adapter', async () => {
      settingsRepo.findByWorkspace.mockResolvedValue(ok(settings()))
      storeRepo.findById.mockResolvedValue(ok(store()))
      const listProducts = vi.fn(async () => [
        {
          externalId: 'e1',
          sku: 'S1',
          name: 'Tênis',
          description: null,
          price: 99,
          imageUrl: 'https://i',
          url: 'https://u',
          available: true,
        },
        {
          externalId: 'e2',
          sku: null,
          name: 'Boné',
          description: null,
          price: 10,
          imageUrl: null,
          url: null,
          available: false,
        },
      ])
      adapterFor.mockReturnValue({ provider: 'NUVEMSHOP', listProducts })
      expectOk(await WhatsAppCommerceService.sync(USER, WS))
      expect(listProducts).toHaveBeenCalledWith({
        storeUrl: 'https://loja',
        accessToken: 'tok',
        storeId: '9',
      })
      const [, source, products] = productRepo.syncSource.mock.calls[0]
      expect(source).toBe('NUVEMSHOP')
      expect(products.map((p) => p.retailerId)).toEqual(['S1', 'e2'])
    })

    it('reports a store failure and a missing adapter', async () => {
      settingsRepo.findByWorkspace.mockResolvedValue(ok(settings()))
      storeRepo.findById.mockResolvedValue(ok(store()))
      adapterFor.mockReturnValue({
        provider: 'NUVEMSHOP',
        listProducts: vi.fn(async () => {
          throw new Error('A loja respondeu 401')
        }),
      })
      const failed = expectErr(
        await WhatsAppCommerceService.sync(USER, WS),
        'WHATSAPP_CATALOG_SYNC_FAILED',
      )
      expect(failed.message).toBe('A loja respondeu 401')
      adapterFor.mockReturnValue({
        provider: 'NUVEMSHOP',
        listProducts: vi.fn(async () => {
          throw 'boom'
        }),
      })
      expect(
        expectErr(await WhatsAppCommerceService.sync(USER, WS)).message,
      ).toContain('Não foi possível ler')
      adapterFor.mockReturnValue(null)
      expectErr(
        await WhatsAppCommerceService.sync(USER, WS),
        'WHATSAPP_CATALOG_INVALID',
      )
    })
  })
})

describe('sendProducts', () => {
  const dto = {
    conversationId: 'cv1',
    productIds: ['p1', 'p2'],
    bodyText: 'Veja',
  }
  const conversation = createFakeWhatsAppConversationWithPreview({
    id: 'cv1',
    workspaceId: WS,
    aiActive: false,
  })
  const picked = [
    createFakeCatalogProduct({ id: 'p1', retailerId: 'R1', name: 'Um' }),
    createFakeCatalogProduct({ id: 'p2', retailerId: 'R2', name: 'Dois' }),
  ]

  beforeEach(() => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    loadConversation.mockResolvedValue(ok(conversation))
    productRepo.findManyByIds.mockResolvedValue(ok(picked))
    connections.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ provider: 'META' })),
    )
    send.mockResolvedValue(ok({ providerMessageId: 'wamid.1' }))
  })

  it('sends the products in the order picked and files the message', async () => {
    const result = expectOk(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
    )
    expect(result.providerMessageId).toBe('wamid.1')
    expect(send.mock.calls[0][1]).toMatchObject({
      catalogId: '1234567890',
      retailerIds: ['R1', 'R2'],
    })
    expect(recordOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Produtos: Um, Dois'),
        senderUserId: USER,
      }),
    )
  })

  it('stops at authorization, catalog, conversation and hours checks', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'FORBIDDEN',
    )
    member.mockResolvedValue(ok({ role: 'MEMBER' } as never))
    scope.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'FORBIDDEN',
    )
    scope.mockResolvedValue(ok({} as never))
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'WHATSAPP_CATALOG_DISABLED',
    )
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    loadConversation.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'FORBIDDEN',
    )
    loadConversation.mockResolvedValue(ok({ ...conversation, aiActive: true }))
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'WHATSAPP_CONVERSATION_AI_HANDLING',
    )
    loadConversation.mockResolvedValue(ok(conversation))
    hours.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'FORBIDDEN',
    )
  })

  it('refuses unknown or unavailable products', async () => {
    productRepo.findManyByIds.mockResolvedValue(ok([picked[0]]))
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'WHATSAPP_CATALOG_INVALID',
    )
    productRepo.findManyByIds.mockResolvedValue(
      ok([picked[0], { ...picked[1], available: false }]),
    )
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'WHATSAPP_CATALOG_INVALID',
    )
    productRepo.findManyByIds.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'DATABASE_ERROR',
    )
  })

  it('handles connection and provider failures', async () => {
    connections.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connections.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'DATABASE_ERROR',
    )
    connections.findById.mockResolvedValue(ok(createFakeWhatsAppConnection()))
    send.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'x' } as never),
    )
    expectErr(
      await WhatsAppCommerceService.sendProducts(USER, WS, dto),
      'WHATSAPP_PROVIDER_ERROR',
    )
  })
})

describe('orders', () => {
  it('lists the received carts', async () => {
    orderRepo.list.mockResolvedValue(
      ok([
        { ...createFakeCatalogOrder(), contact: { name: 'Maria', waId: '55' } },
      ]),
    )
    expect(
      expectOk(await WhatsAppCommerceService.listOrders(USER, WS)),
    ).toHaveLength(1)
    orderRepo.list.mockResolvedValue(dbErr())
    expectErr(await WhatsAppCommerceService.listOrders(USER, WS))
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppCommerceService.listOrders(USER, WS))
  })
})
