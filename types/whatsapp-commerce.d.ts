export type WhatsAppCatalogSourceDTO = 'CRM' | 'TRAY' | 'NUVEMSHOP'
export type WhatsAppStoreProviderDTO = 'TRAY' | 'NUVEMSHOP' | 'VTEX'
export type WhatsAppEcomTriggerKindDTO =
  | 'ABANDONED_CART'
  | 'ORDER_SHIPPED'
  | 'POST_PURCHASE'
export type WhatsAppEcomEventKindDTO =
  | 'CART_ABANDONED'
  | 'ORDER_CREATED'
  | 'ORDER_SHIPPED'
  | 'ORDER_DELIVERED'
export type WhatsAppEcomEventStatusDTO =
  | 'PENDING'
  | 'SENT'
  | 'SKIPPED'
  | 'FAILED'

export interface WhatsAppCommerceSettingsDTO {
  workspaceId: string
  catalogEnabled: boolean
  metaCatalogId: string | null
  catalogSource: WhatsAppCatalogSourceDTO
  catalogIntegrationId: string | null
  storeSyncEnabled: boolean
  lastCatalogSyncAt: string | null
  orderCreatesOpportunity: boolean
  orderPipelineId: string | null
  orderPixEnabled: boolean
  ownerUserId: string | null
  triggersEnabled: boolean
  throttleHours: number
}

export interface WhatsAppCatalogProductDTO {
  id: string
  source: WhatsAppCatalogSourceDTO
  retailerId: string
  name: string
  description: string | null
  price: number
  currency: string
  imageUrl: string | null
  url: string | null
  available: boolean
  syncedAt: string
}

export interface WhatsAppCatalogOrderItemDTO {
  retailerId: string
  name: string
  quantity: number
  unitPrice: number
}

export interface WhatsAppCatalogOrderDTO {
  id: string
  contactId: string
  contactName: string | null
  contactWaId: string
  conversationId: string | null
  note: string | null
  items: WhatsAppCatalogOrderItemDTO[]
  total: number
  currency: string
  leadId: string | null
  opportunityId: string | null
  pixChargeId: string | null
  createdAt: string
}

export interface WhatsAppCatalogSyncResultDTO {
  created: number
  updated: number
  removed: number
}

export interface WhatsAppStoreIntegrationDTO {
  id: string
  provider: WhatsAppStoreProviderDTO
  name: string
  connectionId: string
  enabled: boolean
  storeUrl: string | null
  /** True when store API credentials are saved (catalog adapters only). */
  hasCredentials: boolean
  lastEventAt: string | null
  createdAt: string
}

/** Returned once, when the store is created or its secret rotated. */
export interface WhatsAppStoreIntegrationSecretDTO
  extends WhatsAppStoreIntegrationDTO {
  webhookSecret: string
}

export interface WhatsAppEcomTriggerDTO {
  kind: WhatsAppEcomTriggerKindDTO
  enabled: boolean
  templateId: string | null
  delayMinutes: number
  variables: string[]
}

export interface WhatsAppEcomEventDTO {
  id: string
  storeName: string
  kind: WhatsAppEcomEventKindDTO
  externalId: string
  waId: string
  contactName: string | null
  status: WhatsAppEcomEventStatusDTO
  skipReason: string | null
  scheduledAt: string
  processedAt: string | null
  createdAt: string
}
