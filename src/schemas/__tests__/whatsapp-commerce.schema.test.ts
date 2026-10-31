import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppStoreSchema,
  SendCatalogProductsSchema,
  StoreWebhookBodySchema,
  UpdateCatalogProductSchema,
  UpdateWhatsAppCommerceSettingsSchema,
  UpdateWhatsAppStoreSchema,
  UpsertEcomTriggerSchema,
} from '../whatsapp-commerce.schema'

describe('UpdateWhatsAppCommerceSettingsSchema', () => {
  it('accepts a partial update and null clears', () => {
    expect(
      UpdateWhatsAppCommerceSettingsSchema.safeParse({
        catalogEnabled: true,
        metaCatalogId: '1234567890',
        orderPipelineId: null,
        throttleHours: 0,
      }).success,
    ).toBe(true)
    expect(UpdateWhatsAppCommerceSettingsSchema.safeParse({}).success).toBe(
      true,
    )
  })

  it('rejects a catalog id with letters and an absurd throttle', () => {
    expect(
      UpdateWhatsAppCommerceSettingsSchema.safeParse({ metaCatalogId: 'abc' })
        .success,
    ).toBe(false)
    expect(
      UpdateWhatsAppCommerceSettingsSchema.safeParse({ throttleHours: 721 })
        .success,
    ).toBe(false)
    expect(
      UpdateWhatsAppCommerceSettingsSchema.safeParse({ throttleHours: -1 })
        .success,
    ).toBe(false)
  })
})

describe('SendCatalogProductsSchema', () => {
  it('requires products and a message', () => {
    expect(
      SendCatalogProductsSchema.safeParse({
        conversationId: 'c',
        productIds: ['a'],
        bodyText: ' Olá ',
      }),
    ).toMatchObject({ success: true, data: { bodyText: 'Olá' } })
    expect(
      SendCatalogProductsSchema.safeParse({
        conversationId: 'c',
        productIds: [],
        bodyText: 'x',
      }).success,
    ).toBe(false)
    expect(
      SendCatalogProductsSchema.safeParse({
        conversationId: 'c',
        productIds: Array.from({ length: 31 }, (_, i) => String(i)),
        bodyText: 'x',
      }).success,
    ).toBe(false)
    expect(
      SendCatalogProductsSchema.safeParse({
        conversationId: 'c',
        productIds: ['a'],
        bodyText: '  ',
      }).success,
    ).toBe(false)
  })
})

describe('store schemas', () => {
  it('validates a new store', () => {
    expect(
      CreateWhatsAppStoreSchema.safeParse({
        provider: 'TRAY',
        name: 'Loja',
        connectionId: 'c1',
        storeUrl: 'https://api.tray.com.br',
        accessToken: 'tok',
      }).success,
    ).toBe(true)
    expect(
      CreateWhatsAppStoreSchema.safeParse({
        provider: 'MAGENTO',
        name: 'Loja',
        connectionId: 'c1',
      }).success,
    ).toBe(false)
    expect(
      CreateWhatsAppStoreSchema.safeParse({
        provider: 'VTEX',
        name: 'Loja',
        connectionId: 'c1',
        storeUrl: 'nao-e-url',
      }).success,
    ).toBe(false)
  })

  it('validates a store update and the product toggle', () => {
    expect(
      UpdateWhatsAppStoreSchema.safeParse({ enabled: true, storeUrl: null })
        .success,
    ).toBe(true)
    expect(
      UpdateCatalogProductSchema.safeParse({ available: false }).success,
    ).toBe(true)
    expect(UpdateCatalogProductSchema.safeParse({}).success).toBe(false)
  })
})

describe('UpsertEcomTriggerSchema', () => {
  it('defaults the variables and bounds the delay', () => {
    expect(
      UpsertEcomTriggerSchema.parse({
        enabled: true,
        templateId: 't1',
        delayMinutes: 60,
      }).variables,
    ).toEqual([])
    expect(
      UpsertEcomTriggerSchema.safeParse({
        enabled: true,
        templateId: null,
        delayMinutes: 43_201,
      }).success,
    ).toBe(false)
    expect(
      UpsertEcomTriggerSchema.safeParse({
        enabled: false,
        templateId: null,
        delayMinutes: 0,
        variables: Array.from({ length: 11 }, () => '{nome}'),
      }).success,
    ).toBe(false)
  })

  it('takes any JSON object as a webhook body', () => {
    expect(StoreWebhookBodySchema.safeParse({ a: 1 }).success).toBe(true)
    expect(StoreWebhookBodySchema.safeParse([]).success).toBe(false)
  })
})
