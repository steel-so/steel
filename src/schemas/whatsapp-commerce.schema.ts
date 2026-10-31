import { z } from 'zod'

export const CATALOG_SOURCES = ['CRM', 'TRAY', 'NUVEMSHOP'] as const
export const STORE_PROVIDERS = ['TRAY', 'NUVEMSHOP', 'VTEX'] as const
export const ECOM_TRIGGER_KINDS = [
  'ABANDONED_CART',
  'ORDER_SHIPPED',
  'POST_PURCHASE',
] as const

/** Longest wait before an automatic message: 30 days. */
export const ECOM_MAX_DELAY_MINUTES = 43_200
export const ECOM_MAX_THROTTLE_HOURS = 720
export const ECOM_MAX_VARIABLES = 10

// PATCH .../whatsapp/commerce/settings
export const UpdateWhatsAppCommerceSettingsSchema = z.object({
  catalogEnabled: z.boolean().optional(),
  metaCatalogId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'O id do catálogo da Meta tem só números')
    .nullable()
    .optional(),
  catalogSource: z.enum(CATALOG_SOURCES).optional(),
  catalogIntegrationId: z.string().min(1).nullable().optional(),
  storeSyncEnabled: z.boolean().optional(),
  orderCreatesOpportunity: z.boolean().optional(),
  orderPipelineId: z.string().min(1).nullable().optional(),
  orderPixEnabled: z.boolean().optional(),
  triggersEnabled: z.boolean().optional(),
  throttleHours: z
    .number()
    .int()
    .min(0, 'Use 0 para não limitar')
    .max(ECOM_MAX_THROTTLE_HOURS, 'O máximo é de 30 dias')
    .optional(),
})
export type UpdateWhatsAppCommerceSettingsDTO = z.infer<
  typeof UpdateWhatsAppCommerceSettingsSchema
>

// POST .../whatsapp/catalog/send
export const SendCatalogProductsSchema = z.object({
  conversationId: z.string().min(1),
  /** Ids of `WhatsAppCatalogProduct` (1 = single product, up to 30). */
  productIds: z
    .array(z.string().min(1))
    .min(1, 'Escolha ao menos um produto')
    .max(30, 'A Meta aceita até 30 produtos por mensagem'),
  bodyText: z
    .string()
    .trim()
    .min(1, 'Escreva a mensagem que acompanha os produtos')
    .max(1024),
})
export type SendCatalogProductsDTO = z.infer<typeof SendCatalogProductsSchema>

// PATCH .../whatsapp/catalog/products/{productId}
export const UpdateCatalogProductSchema = z.object({
  available: z.boolean(),
})

// POST .../whatsapp/stores
export const CreateWhatsAppStoreSchema = z.object({
  provider: z.enum(STORE_PROVIDERS),
  name: z.string().trim().min(1, 'Dê um nome à loja').max(80),
  connectionId: z.string().min(1, 'Escolha a conexão do WhatsApp'),
  storeUrl: z.url('Informe um endereço válido').max(200).optional(),
  /** Store API token, only for the catalog adapters. */
  accessToken: z.string().trim().min(1).max(500).optional(),
  /** Nuvemshop store id. */
  storeId: z.string().trim().min(1).max(40).optional(),
})
export type CreateWhatsAppStoreDTO = z.infer<typeof CreateWhatsAppStoreSchema>

// PATCH .../whatsapp/stores/{storeId}
export const UpdateWhatsAppStoreSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  connectionId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  storeUrl: z.url('Informe um endereço válido').max(200).nullable().optional(),
  accessToken: z.string().trim().min(1).max(500).nullable().optional(),
  storeId: z.string().trim().min(1).max(40).nullable().optional(),
})
export type UpdateWhatsAppStoreDTO = z.infer<typeof UpdateWhatsAppStoreSchema>

// PUT .../whatsapp/ecommerce/triggers/{kind}
export const UpsertEcomTriggerSchema = z.object({
  enabled: z.boolean(),
  templateId: z.string().min(1).nullable(),
  delayMinutes: z.number().int().min(0).max(ECOM_MAX_DELAY_MINUTES),
  variables: z
    .array(z.string().trim().min(1).max(200))
    .max(ECOM_MAX_VARIABLES)
    .default([]),
})
export type UpsertEcomTriggerDTO = z.infer<typeof UpsertEcomTriggerSchema>

/**
 * Body the stores post (Steel generic format). Native Nuvemshop / Tray /
 * VTEX objects are read by `normalizeStoreEvent`; this only bounds the size.
 */
export const StoreWebhookBodySchema = z.record(z.string(), z.unknown())
