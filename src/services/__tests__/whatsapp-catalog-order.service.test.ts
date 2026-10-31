import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import {
  createFakeCatalogOrder,
  createFakeCatalogProduct,
  createFakeCommerceSettings,
} from '@/src/__tests__/factories/nov-zap-ecom.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../authz', () => ({ assertModuleEnabled: vi.fn() }))
vi.mock('../crm-lead.service', () => ({
  CrmLeadService: { intake: vi.fn() },
}))
vi.mock('../whatsapp-pix.service', () => ({
  WhatsAppPixService: { createChargeForAi: vi.fn() },
}))
vi.mock('../whatsapp-automation-send.service', () => ({
  recordOutboundMessage: vi.fn(async () => ({ ok: true, value: undefined })),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/repositories/crm-note.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-pipeline.repository')
vi.mock('@/src/repositories/whatsapp-catalog.repository')

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import {
  CrmOpportunityLineItemRepository,
  CrmOpportunityRepository,
} from '@/src/repositories/crm-opportunity.repository'
import {
  CrmPipelineRepository,
  CrmPipelineStageRepository,
} from '@/src/repositories/crm-pipeline.repository'
import {
  WhatsAppCatalogOrderRepository,
  WhatsAppCatalogProductRepository,
  WhatsAppCommerceSettingsRepository,
} from '@/src/repositories/whatsapp-catalog.repository'
import { assertModuleEnabled } from '../authz'
import { CrmLeadService } from '../crm-lead.service'
import { recordOutboundMessage } from '../whatsapp-automation-send.service'
import { WhatsAppCatalogOrderService } from '../whatsapp-catalog-order.service'
import { WhatsAppPixService } from '../whatsapp-pix.service'

const settingsRepo = vi.mocked(WhatsAppCommerceSettingsRepository)
const productRepo = vi.mocked(WhatsAppCatalogProductRepository)
const orderRepo = vi.mocked(WhatsAppCatalogOrderRepository)
const pipelineRepo = vi.mocked(CrmPipelineRepository)
const stageRepo = vi.mocked(CrmPipelineStageRepository)
const opportunityRepo = vi.mocked(CrmOpportunityRepository)
const lineRepo = vi.mocked(CrmOpportunityLineItemRepository)
const noteRepo = vi.mocked(CrmNoteRepository)
const leads = vi.mocked(CrmLeadService)
const pix = vi.mocked(WhatsAppPixService)
const crmEnabled = vi.mocked(assertModuleEnabled)
const sendText = vi.mocked(WhatsAppSend.text)

const dbErr = () => err(databaseError('x'))
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: 'ws1',
  waId: '5511988887777',
  name: 'Maria',
})

const input = (over = {}) => ({
  workspaceId: 'ws1',
  connection: createFakeWhatsAppConnection({ id: 'conn1' }),
  contact,
  conversationId: 'cv1',
  messageId: 'm1',
  providerMessageId: 'wamid.order',
  order: {
    catalog_id: '123',
    text: 'obrigado',
    product_items: [
      {
        product_retailer_id: 'R1',
        quantity: 2,
        item_price: 50,
        currency: 'BRL',
      },
      { product_retailer_id: 'R9', quantity: 1, item_price: 0 },
    ],
  },
  ...over,
})

const stored = createFakeCatalogOrder({ id: 'order1' })

beforeEach(() => {
  vi.clearAllMocks()
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(createFakeCommerceSettings({ ownerUserId: 'owner' })),
  )
  productRepo.findManyByRetailerIds.mockResolvedValue(
    ok([
      createFakeCatalogProduct({
        retailerId: 'R1',
        name: 'Camiseta',
        externalId: 'crm1',
        source: 'CRM',
      }),
      createFakeCatalogProduct({
        retailerId: 'R9',
        name: 'Boné',
        price: 10 as never,
        source: 'TRAY',
      }),
    ]),
  )
  orderRepo.create.mockResolvedValue(ok(stored))
  orderRepo.update.mockResolvedValue(ok(stored))
  crmEnabled.mockResolvedValue(ok(undefined as never))
  leads.intake.mockResolvedValue(
    ok({ lead: { id: 'lead1' } as never, created: true }),
  )
  pipelineRepo.findDefault.mockResolvedValue(ok({ id: 'pipe1' } as never))
  pipelineRepo.findById.mockResolvedValue(ok({ id: 'pipe2' } as never))
  stageRepo.listByPipeline.mockResolvedValue(ok([{ id: 'stage1' }] as never))
  opportunityRepo.create.mockResolvedValue(
    ok(createFakeCrmOpportunity({ id: 'opp1' })),
  )
  lineRepo.create.mockResolvedValue(ok({} as never))
  noteRepo.create.mockResolvedValue(ok({} as never))
  sendText.mockResolvedValue(ok({ providerMessageId: 'wamid.thanks' }))
  pix.createChargeForAi.mockResolvedValue(ok({ id: 'charge1' } as never))
})

describe('WhatsAppCatalogOrderService.handleInbound', () => {
  it('ignores carts while the catalog is off or when empty', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppCatalogOrderService.handleInbound(input())),
    ).toEqual({
      handled: false,
    })
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ catalogEnabled: false })),
    )
    expect(
      expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
        .handled,
    ).toBe(false)
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    expect(
      expectOk(
        await WhatsAppCatalogOrderService.handleInbound(
          input({ order: { product_items: [] } }),
        ),
      ).handled,
    ).toBe(false)
    expect(orderRepo.create).not.toHaveBeenCalled()
  })

  it('stores the cart, creates lead and deal and returns the timeline text', async () => {
    const outcome = expectOk(
      await WhatsAppCatalogOrderService.handleInbound(input()),
    )
    expect(outcome.handled).toBe(true)
    expect(outcome.text).toContain('2x Camiseta')
    expect(outcome.text).toContain('1x Boné')
    expect(orderRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: 'wamid.order',
        total: 100 + 10,
        metaCatalogId: '123',
      }),
    )
    expect(leads.intake).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({
        via: 'whatsapp_catalog',
        createdById: 'owner',
      }),
      expect.objectContaining({ phones: ['5511988887777'], name: 'Maria' }),
    )
    expect(opportunityRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: 'pipe1',
        stageId: 'stage1',
        amount: 110,
      }),
    )
    // Only the CRM product is linked to a catalog product.
    expect(lineRepo.create.mock.calls.map((c) => c[0].productId)).toEqual([
      'crm1',
      undefined,
    ])
    expect(noteRepo.create).toHaveBeenCalled()
    expect(orderRepo.update).toHaveBeenCalledWith('order1', {
      leadId: 'lead1',
      opportunityId: 'opp1',
    })
  })

  it('thanks the contact after the cart is published, without Pix by default', async () => {
    const outcome = expectOk(
      await WhatsAppCatalogOrderService.handleInbound(input()),
    )
    await outcome.afterPublish?.()
    expect(sendText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: '5511988887777',
        text: expect.stringContaining('Recebemos o seu carrinho'),
      }),
      expect.anything(),
    )
    expect(recordOutboundMessage).toHaveBeenCalled()
    expect(pix.createChargeForAi).not.toHaveBeenCalled()
  })

  it('charges over Pix when the workspace asks', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeCommerceSettings({
          ownerUserId: 'owner',
          orderPixEnabled: true,
        }),
      ),
    )
    const outcome = expectOk(
      await WhatsAppCatalogOrderService.handleInbound(input()),
    )
    await outcome.afterPublish?.()
    expect(pix.createChargeForAi).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'cv1',
        amount: 110,
        opportunityId: 'opp1',
        description: 'Pedido pelo WhatsApp (2 itens)',
      }),
    )
    expect(orderRepo.update).toHaveBeenCalledWith('order1', {
      pixChargeId: 'charge1',
    })
  })

  it('keeps going when the Pix or the thank-you fail', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeCommerceSettings({
          ownerUserId: 'owner',
          orderPixEnabled: true,
        }),
      ),
    )
    pix.createChargeForAi.mockResolvedValue(
      err({ code: 'PIX_DISABLED', message: 'x' } as never),
    )
    sendText.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'x' } as never),
    )
    const outcome = expectOk(
      await WhatsAppCatalogOrderService.handleInbound(input()),
    )
    await outcome.afterPublish?.()
    expect(recordOutboundMessage).not.toHaveBeenCalled()
    expect(orderRepo.update).not.toHaveBeenCalledWith('order1', {
      pixChargeId: expect.anything(),
    })
  })

  it('writes a singular Pix description for one item', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeCommerceSettings({
          ownerUserId: 'owner',
          orderPixEnabled: true,
        }),
      ),
    )
    const outcome = expectOk(
      await WhatsAppCatalogOrderService.handleInbound(
        input({
          order: {
            product_items: [
              { product_retailer_id: 'R1', quantity: 1, item_price: 5 },
            ],
          },
        }),
      ),
    )
    await outcome.afterPublish?.()
    expect(pix.createChargeForAi).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Pedido pelo WhatsApp (1 item)' }),
    )
  })

  it('is idempotent for a webhook retry', async () => {
    orderRepo.create.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppCatalogOrderService.handleInbound(input())),
    ).toEqual({
      handled: true,
    })
    expect(leads.intake).not.toHaveBeenCalled()
  })

  it('skips the CRM when it is off, owner-less or disabled for the workspace', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ orderCreatesOpportunity: false })),
    )
    expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ ownerUserId: null })),
    )
    expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ ownerUserId: 'o' })),
    )
    crmEnabled.mockResolvedValue(
      err({ code: 'MODULE_DISABLED', message: 'x' } as never),
    )
    expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
    expect(opportunityRepo.create).not.toHaveBeenCalled()
  })

  it('uses the chosen pipeline and tolerates a lead failure and a BSUID contact', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeCommerceSettings({
          ownerUserId: 'o',
          orderPipelineId: 'pipe2',
        }),
      ),
    )
    leads.intake.mockResolvedValue(
      err({ code: 'VALIDATION_ERROR', message: 'x' } as never),
    )
    expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
    expect(opportunityRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: 'pipe2' }),
    )

    leads.intake.mockClear()
    const bsuid = createFakeWhatsAppContactWithoutCount({
      waId: 'BR.123',
      name: null,
    })
    expectOk(
      await WhatsAppCatalogOrderService.handleInbound(
        input({ contact: bsuid }),
      ),
    )
    expect(leads.intake).not.toHaveBeenCalled()
    expect(opportunityRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'Pedido pelo WhatsApp - Cliente do WhatsApp',
      }),
    )
  })

  it('stops the deal quietly when the pipeline or stages are missing', async () => {
    pipelineRepo.findDefault.mockResolvedValue(ok(null))
    expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
    pipelineRepo.findDefault.mockResolvedValue(dbErr())
    expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
    pipelineRepo.findDefault.mockResolvedValue(ok({ id: 'pipe1' } as never))
    stageRepo.listByPipeline.mockResolvedValue(ok([]))
    expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
    stageRepo.listByPipeline.mockResolvedValue(dbErr())
    expectOk(await WhatsAppCatalogOrderService.handleInbound(input()))
    opportunityRepo.create.mockClear()
    expect(opportunityRepo.create).not.toHaveBeenCalled()
  })

  it('keeps the order when the deal cannot be created', async () => {
    stageRepo.listByPipeline.mockResolvedValue(ok([{ id: 'stage1' }] as never))
    opportunityRepo.create.mockResolvedValue(dbErr())
    const outcome = expectOk(
      await WhatsAppCatalogOrderService.handleInbound(input()),
    )
    expect(outcome.handled).toBe(true)
    expect(orderRepo.update).toHaveBeenCalledWith('order1', {
      leadId: 'lead1',
      opportunityId: null,
    })
  })

  it('propagates database failures', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppCatalogOrderService.handleInbound(input()),
      'DATABASE_ERROR',
    )
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    productRepo.findManyByRetailerIds.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppCatalogOrderService.handleInbound(input()),
      'DATABASE_ERROR',
    )
    productRepo.findManyByRetailerIds.mockResolvedValue(ok([]))
    orderRepo.create.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppCatalogOrderService.handleInbound(input()),
      'DATABASE_ERROR',
    )
  })

  it('prices an unknown product by the cart line', async () => {
    productRepo.findManyByRetailerIds.mockResolvedValue(ok([]))
    const outcome = expectOk(
      await WhatsAppCatalogOrderService.handleInbound(input()),
    )
    expect(outcome.text).toContain('2x R1')
  })
})
