import type {
  WhatsAppCatalogOrder,
  WhatsAppCatalogProduct,
  WhatsAppCommerceSettings,
  WhatsAppEcomEvent,
  WhatsAppEcomTrigger,
  WhatsAppStoreIntegration,
} from '@prisma/client'
import type {
  WhatsAppCatalogOrderDTO,
  WhatsAppCatalogOrderItemDTO,
  WhatsAppCatalogProductDTO,
  WhatsAppCommerceSettingsDTO,
  WhatsAppEcomEventDTO,
  WhatsAppEcomTriggerDTO,
  WhatsAppEcomTriggerKindDTO,
  WhatsAppStoreIntegrationDTO,
} from '@/types/whatsapp-commerce'

export const COMMERCE_SETTINGS_DEFAULTS = {
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
} as const

export function toWhatsAppCommerceSettingsDTO(
  workspaceId: string,
  row: WhatsAppCommerceSettings | null,
): WhatsAppCommerceSettingsDTO {
  if (!row) return { workspaceId, ...COMMERCE_SETTINGS_DEFAULTS }
  return {
    workspaceId,
    catalogEnabled: row.catalogEnabled,
    metaCatalogId: row.metaCatalogId,
    catalogSource: row.catalogSource,
    catalogIntegrationId: row.catalogIntegrationId,
    storeSyncEnabled: row.storeSyncEnabled,
    lastCatalogSyncAt: row.lastCatalogSyncAt?.toISOString() ?? null,
    orderCreatesOpportunity: row.orderCreatesOpportunity,
    orderPipelineId: row.orderPipelineId,
    orderPixEnabled: row.orderPixEnabled,
    ownerUserId: row.ownerUserId,
    triggersEnabled: row.triggersEnabled,
    throttleHours: row.throttleHours,
  }
}

export function toWhatsAppCatalogProductDTO(
  row: WhatsAppCatalogProduct,
): WhatsAppCatalogProductDTO {
  return {
    id: row.id,
    source: row.source,
    retailerId: row.retailerId,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    imageUrl: row.imageUrl,
    url: row.url,
    available: row.available,
    syncedAt: row.syncedAt.toISOString(),
  }
}

function parseItems(value: unknown): WhatsAppCatalogOrderItemDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return []
    const item = row as Record<string, unknown>
    return [
      {
        retailerId: String(item.retailerId ?? ''),
        name: String(item.name ?? item.retailerId ?? ''),
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.unitPrice ?? 0),
      },
    ]
  })
}

export function toWhatsAppCatalogOrderDTO(
  row: WhatsAppCatalogOrder & {
    contact: { name: string | null; waId: string }
  },
): WhatsAppCatalogOrderDTO {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contact.name,
    contactWaId: row.contact.waId,
    conversationId: row.conversationId,
    note: row.note,
    items: parseItems(row.items),
    total: Number(row.total),
    currency: row.currency,
    leadId: row.leadId,
    opportunityId: row.opportunityId,
    pixChargeId: row.pixChargeId,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toWhatsAppStoreIntegrationDTO(
  row: WhatsAppStoreIntegration,
): WhatsAppStoreIntegrationDTO {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    connectionId: row.connectionId,
    enabled: row.enabled,
    storeUrl: row.storeUrl,
    hasCredentials: row.encryptedCredentials !== null,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export const ECOM_TRIGGER_DEFAULT_DELAY: Record<
  WhatsAppEcomTriggerKindDTO,
  number
> = {
  ABANDONED_CART: 60,
  ORDER_SHIPPED: 0,
  POST_PURCHASE: 4_320,
}

export function toWhatsAppEcomTriggerDTO(
  kind: WhatsAppEcomTriggerKindDTO,
  row: WhatsAppEcomTrigger | null,
): WhatsAppEcomTriggerDTO {
  if (!row) {
    return {
      kind,
      enabled: false,
      templateId: null,
      delayMinutes: ECOM_TRIGGER_DEFAULT_DELAY[kind],
      variables: [],
    }
  }
  return {
    kind,
    enabled: row.enabled,
    templateId: row.templateId,
    delayMinutes: row.delayMinutes,
    variables: Array.isArray(row.variables)
      ? row.variables.filter((v): v is string => typeof v === 'string')
      : [],
  }
}

export function toWhatsAppEcomEventDTO(
  row: WhatsAppEcomEvent & { integration: { name: string } },
): WhatsAppEcomEventDTO {
  return {
    id: row.id,
    storeName: row.integration.name,
    kind: row.kind,
    externalId: row.externalId,
    waId: row.waId,
    contactName: row.contactName,
    status: row.status,
    skipReason: row.skipReason,
    scheduledAt: row.scheduledAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}
