import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  COMMERCE_SETTINGS_DEFAULTS,
  ECOM_TRIGGER_DEFAULT_DELAY,
  toWhatsAppCatalogOrderDTO,
  toWhatsAppCatalogProductDTO,
  toWhatsAppCommerceSettingsDTO,
  toWhatsAppEcomEventDTO,
  toWhatsAppEcomTriggerDTO,
  toWhatsAppStoreIntegrationDTO,
} from '../whatsapp-commerce.mapper'

const now = new Date('2026-11-04T12:00:00Z')

describe('commerce mappers', () => {
  it('returns the defaults when the workspace never saved settings', () => {
    expect(toWhatsAppCommerceSettingsDTO('ws1', null)).toEqual({
      workspaceId: 'ws1',
      ...COMMERCE_SETTINGS_DEFAULTS,
    })
  })

  it('maps a saved settings row', () => {
    const dto = toWhatsAppCommerceSettingsDTO('ws1', {
      id: 's',
      workspaceId: 'ws1',
      catalogEnabled: true,
      metaCatalogId: '123',
      catalogSource: 'TRAY',
      catalogIntegrationId: 'st1',
      storeSyncEnabled: true,
      lastCatalogSyncAt: now,
      orderCreatesOpportunity: false,
      orderPipelineId: 'p1',
      orderPixEnabled: true,
      ownerUserId: 'u1',
      triggersEnabled: true,
      throttleHours: 6,
      createdAt: now,
      updatedAt: now,
    })
    expect(dto).toMatchObject({
      catalogEnabled: true,
      catalogSource: 'TRAY',
      lastCatalogSyncAt: now.toISOString(),
      throttleHours: 6,
    })
    expect(
      toWhatsAppCommerceSettingsDTO('ws1', {
        ...({} as never),
        catalogEnabled: false,
        metaCatalogId: null,
        catalogSource: 'CRM',
        catalogIntegrationId: null,
        storeSyncEnabled: false,
        lastCatalogSyncAt: null,
        orderCreatesOpportunity: true,
        orderPipelineId: null,
        orderPixEnabled: false,
        ownerUserId: null,
        triggersEnabled: false,
        throttleHours: 24,
      }).lastCatalogSyncAt,
    ).toBeNull()
  })

  it('maps products with a numeric price', () => {
    expect(
      toWhatsAppCatalogProductDTO({
        id: 'p',
        workspaceId: 'ws',
        source: 'CRM',
        externalId: 'e',
        retailerId: 'SKU',
        name: 'Camisa',
        description: null,
        price: new Prisma.Decimal('59.9'),
        currency: 'BRL',
        imageUrl: null,
        url: null,
        available: true,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({
      price: 59.9,
      retailerId: 'SKU',
      syncedAt: now.toISOString(),
    })
  })

  it('maps orders and tolerates broken item JSON', () => {
    const row = {
      id: 'o',
      workspaceId: 'ws',
      contactId: 'c',
      conversationId: 'cv',
      providerMessageId: 'w',
      metaCatalogId: null,
      note: 'sem cebola',
      items: [
        { retailerId: 'A', name: 'Item A', quantity: 2, unitPrice: 10 },
        { retailerId: 'B' },
        'lixo',
      ],
      total: new Prisma.Decimal('20.00'),
      currency: 'BRL',
      leadId: null,
      opportunityId: 'op',
      pixChargeId: null,
      createdAt: now,
      contact: { name: 'Maria', waId: '5511' },
    }
    const dto = toWhatsAppCatalogOrderDTO(row)
    expect(dto.items).toEqual([
      { retailerId: 'A', name: 'Item A', quantity: 2, unitPrice: 10 },
      { retailerId: 'B', name: 'B', quantity: 0, unitPrice: 0 },
    ])
    expect(dto).toMatchObject({
      total: 20,
      contactName: 'Maria',
      opportunityId: 'op',
    })
    expect(toWhatsAppCatalogOrderDTO({ ...row, items: null }).items).toEqual([])
  })

  it('never exposes store secrets, only whether credentials exist', () => {
    const base = {
      id: 'st',
      workspaceId: 'ws',
      provider: 'VTEX' as const,
      name: 'Loja',
      connectionId: 'c',
      enabled: true,
      storeUrl: null,
      encryptedWebhookSecret: 'enc',
      encryptedCredentials: null,
      lastEventAt: null,
      createdById: null,
      createdAt: now,
      updatedAt: now,
    }
    const dto = toWhatsAppStoreIntegrationDTO(base)
    expect(dto).not.toHaveProperty('encryptedWebhookSecret')
    expect(dto).toMatchObject({ hasCredentials: false, lastEventAt: null })
    expect(
      toWhatsAppStoreIntegrationDTO({
        ...base,
        encryptedCredentials: 'x',
        lastEventAt: now,
      }),
    ).toMatchObject({ hasCredentials: true, lastEventAt: now.toISOString() })
  })

  it('maps triggers, with defaults for the ones never saved', () => {
    expect(toWhatsAppEcomTriggerDTO('ABANDONED_CART', null)).toEqual({
      kind: 'ABANDONED_CART',
      enabled: false,
      templateId: null,
      delayMinutes: ECOM_TRIGGER_DEFAULT_DELAY.ABANDONED_CART,
      variables: [],
    })
    const row = {
      id: 't',
      workspaceId: 'ws',
      kind: 'POST_PURCHASE' as const,
      enabled: true,
      templateId: 'tpl',
      delayMinutes: 90,
      variables: ['{nome}', 5],
      createdAt: now,
      updatedAt: now,
    }
    expect(toWhatsAppEcomTriggerDTO('POST_PURCHASE', row).variables).toEqual([
      '{nome}',
    ])
    expect(
      toWhatsAppEcomTriggerDTO('POST_PURCHASE', { ...row, variables: {} })
        .variables,
    ).toEqual([])
  })

  it('maps events', () => {
    expect(
      toWhatsAppEcomEventDTO({
        id: 'e',
        workspaceId: 'ws',
        integrationId: 'st',
        kind: 'CART_ABANDONED',
        externalId: 'c1',
        waId: '55',
        contactName: null,
        data: {},
        status: 'SKIPPED',
        skipReason: 'Limite',
        scheduledAt: now,
        claimedAt: null,
        processedAt: now,
        providerMessageId: null,
        createdAt: now,
        integration: { name: 'Loja' },
      }),
    ).toMatchObject({
      storeName: 'Loja',
      status: 'SKIPPED',
      skipReason: 'Limite',
      processedAt: now.toISOString(),
    })
  })
})
