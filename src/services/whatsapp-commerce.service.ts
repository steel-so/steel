import type { WhatsAppCatalogSource } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  badRequest,
  whatsappCatalogDisabled,
  whatsappCatalogInvalid,
  whatsappCatalogProductNotFound,
  whatsappCatalogSyncFailed,
  whatsappConnectionNotFound,
  whatsappConversationAiHandling,
  whatsappStoreNotFound,
} from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { stripUndefined } from '@/src/lib/strip-undefined'
import {
  getStoreCatalogAdapter,
  type StoreCredentials,
} from '@/src/lib/whatsapp/catalog/store-adapters'
import { agentCost } from '@/src/lib/whatsapp/cost'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  toWhatsAppCatalogOrderDTO,
  toWhatsAppCatalogProductDTO,
  toWhatsAppCommerceSettingsDTO,
} from '@/src/mappers/whatsapp-commerce.mapper'
import { CrmPipelineRepository } from '@/src/repositories/crm-pipeline.repository'
import { CrmProductRepository } from '@/src/repositories/crm-product.repository'
import {
  type CatalogProductUpsert,
  WhatsAppCatalogOrderRepository,
  WhatsAppCatalogProductRepository,
  WhatsAppCommerceSettingsRepository,
} from '@/src/repositories/whatsapp-catalog.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppStoreIntegrationRepository } from '@/src/repositories/whatsapp-store.repository'
import type {
  SendCatalogProductsDTO,
  UpdateWhatsAppCommerceSettingsDTO,
} from '@/src/schemas/whatsapp-commerce.schema'
import type {
  WhatsAppCatalogOrderDTO,
  WhatsAppCatalogProductDTO,
  WhatsAppCatalogSyncResultDTO,
  WhatsAppCommerceSettingsDTO,
} from '@/types/whatsapp-commerce'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { recordOutboundMessage } from './whatsapp-automation-send.service'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from './whatsapp-conversation-scope.service'

/** Settings row of the workspace with the catalog on, or an error. */
async function requireCatalog(workspaceId: string) {
  const settings =
    await WhatsAppCommerceSettingsRepository.findByWorkspace(workspaceId)
  if (!settings.ok) return settings
  if (!settings.value?.catalogEnabled || !settings.value.metaCatalogId) {
    return err(whatsappCatalogDisabled())
  }
  return ok({ ...settings.value, metaCatalogId: settings.value.metaCatalogId })
}

/** Decrypts the credentials saved with a store (JSON of the adapter input). */
async function storeCredentials(
  encrypted: string,
  storeUrl: string | null,
): Promise<StoreCredentials> {
  const parsed = JSON.parse(await decryptConnectionSecret(encrypted)) as {
    accessToken: string
    storeId?: string
  }
  return { storeUrl, accessToken: parsed.accessToken, storeId: parsed.storeId }
}

async function crmProducts(
  workspaceId: string,
): Promise<Result<CatalogProductUpsert[]>> {
  const products = await CrmProductRepository.listByWorkspace(workspaceId, {
    active: true,
  })
  if (!products.ok) return products
  return ok(
    products.value.map((product) => ({
      externalId: product.id,
      // The id the product carries in Meta's catalog: the SKU when set.
      retailerId: product.sku?.trim() || product.id,
      name: product.name,
      description: product.description,
      price: Number(product.unitPrice),
      currency: product.currency,
      imageUrl: null,
      url: null,
      available: true,
    })),
  )
}

async function storeProducts(
  workspaceId: string,
  source: Exclude<WhatsAppCatalogSource, 'CRM'>,
  integrationId: string | null,
  syncEnabled: boolean,
): Promise<Result<CatalogProductUpsert[]>> {
  if (!syncEnabled) {
    return err(
      whatsappCatalogInvalid(
        'A sincronização com a loja está desligada. Ative-a nas configurações do catálogo.',
      ),
    )
  }
  if (!integrationId) {
    return err(whatsappCatalogInvalid('Escolha a loja que alimenta o catálogo'))
  }
  const store = await WhatsAppStoreIntegrationRepository.findById(
    integrationId,
    workspaceId,
  )
  if (!store.ok) return store
  if (!store.value) return err(whatsappStoreNotFound())
  if (store.value.provider !== source || !store.value.encryptedCredentials) {
    return err(
      whatsappCatalogInvalid(
        'A loja escolhida não é desta origem ou está sem as credenciais da API',
      ),
    )
  }
  const adapter = getStoreCatalogAdapter(source)
  if (!adapter) return err(whatsappCatalogInvalid('Origem sem adaptador'))
  try {
    const credentials = await storeCredentials(
      store.value.encryptedCredentials,
      store.value.storeUrl,
    )
    const listed = await adapter.listProducts(credentials)
    return ok(
      listed.map((product) => ({
        externalId: product.externalId,
        retailerId: product.sku ?? product.externalId,
        name: product.name,
        description: product.description,
        price: product.price,
        currency: 'BRL',
        imageUrl: product.imageUrl,
        url: product.url,
        available: product.available,
      })),
    )
  } catch (error) {
    logger.warn('whatsapp.catalog.store_sync_failed', {
      workspaceId,
      provider: source,
      reason: error instanceof Error ? error.message : String(error),
    })
    return err(
      whatsappCatalogSyncFailed(
        error instanceof Error
          ? error.message
          : 'Não foi possível ler os produtos da loja',
      ),
    )
  }
}

export const WhatsAppCommerceService = {
  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppCommerceSettingsDTO>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const row =
      await WhatsAppCommerceSettingsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    return ok(toWhatsAppCommerceSettingsDTO(workspaceId, row.value))
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateWhatsAppCommerceSettingsDTO,
  ): Promise<Result<WhatsAppCommerceSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing =
      await WhatsAppCommerceSettingsRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing
    const current = toWhatsAppCommerceSettingsDTO(workspaceId, existing.value)
    const next = { ...current, ...stripUndefined(dto) }

    if (next.catalogEnabled && !next.metaCatalogId) {
      return err(
        whatsappCatalogInvalid(
          'Informe o id do catálogo da Meta antes de ativar o catálogo',
        ),
      )
    }
    if (next.catalogSource !== 'CRM' && next.catalogIntegrationId) {
      const store = await WhatsAppStoreIntegrationRepository.findById(
        next.catalogIntegrationId,
        workspaceId,
      )
      if (!store.ok) return store
      if (!store.value) return err(whatsappStoreNotFound())
    }
    if (dto.orderPipelineId) {
      const pipeline = await CrmPipelineRepository.findById(
        dto.orderPipelineId,
        workspaceId,
      )
      if (!pipeline.ok) {
        return pipeline.error.code === 'RESOURCE_NOT_FOUND'
          ? err(badRequest('O pipeline informado não existe neste workspace'))
          : pipeline
      }
    }

    const saved = await WhatsAppCommerceSettingsRepository.upsert(workspaceId, {
      ...stripUndefined(dto),
      // Whoever turns the automation on owns the records it creates.
      ...(existing.value?.ownerUserId ? {} : { ownerUserId: actorId }),
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_commerce_settings',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, ...dto },
    })
    return ok(toWhatsAppCommerceSettingsDTO(workspaceId, saved.value))
  },

  async listProducts(
    actorId: string,
    workspaceId: string,
    filter: { available?: boolean; search?: string } = {},
  ): Promise<Result<WhatsAppCatalogProductDTO[]>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const rows = await WhatsAppCatalogProductRepository.list(
      workspaceId,
      filter,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppCatalogProductDTO))
  },

  async setProductAvailable(
    actorId: string,
    workspaceId: string,
    productId: string,
    available: boolean,
  ): Promise<Result<WhatsAppCatalogProductDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const updated = await WhatsAppCatalogProductRepository.setAvailable(
      workspaceId,
      productId,
      available,
    )
    if (!updated.ok) return updated
    if (!updated.value) return err(whatsappCatalogProductNotFound())
    return ok(toWhatsAppCatalogProductDTO(updated.value))
  },

  /** Mirrors the configured source (CRM products or a store) into the catalog. */
  async sync(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppCatalogSyncResultDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const settings = await requireCatalog(workspaceId)
    if (!settings.ok) return settings

    const products =
      settings.value.catalogSource === 'CRM'
        ? await crmProducts(workspaceId)
        : await storeProducts(
            workspaceId,
            settings.value.catalogSource,
            settings.value.catalogIntegrationId,
            settings.value.storeSyncEnabled,
          )
    if (!products.ok) return products

    const synced = await WhatsAppCatalogProductRepository.syncSource(
      workspaceId,
      settings.value.catalogSource,
      products.value,
    )
    if (!synced.ok) return synced
    await WhatsAppCommerceSettingsRepository.upsert(workspaceId, {
      lastCatalogSyncAt: new Date(),
    })

    auditMutation({
      entity: 'whatsapp_commerce_settings',
      action: 'sync',
      actorId,
      targetId: settings.value.id,
      meta: {
        workspaceId,
        source: settings.value.catalogSource,
        ...synced.value,
      },
    })
    return ok(synced.value)
  },

  /** An agent sends one product or a list to a conversation they can see. */
  async sendProducts(
    actorId: string,
    workspaceId: string,
    dto: SendCatalogProductsDTO,
  ): Promise<Result<{ providerMessageId: string }>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'CREATE' },
    )
    if (!membership.ok) return membership
    const scope = await resolveConversationScope(
      actorId,
      workspaceId,
      membership.value.role,
    )
    if (!scope.ok) return scope

    const settings = await requireCatalog(workspaceId)
    if (!settings.ok) return settings

    const conversation = await loadVisibleConversation(
      scope.value,
      workspaceId,
      dto.conversationId,
    )
    if (!conversation.ok) return conversation
    if (conversation.value.aiActive) {
      return err(whatsappConversationAiHandling())
    }
    const open = await WhatsAppBusinessHoursService.assertOpen(workspaceId)
    if (!open.ok) return open

    const products = await WhatsAppCatalogProductRepository.findManyByIds(
      workspaceId,
      dto.productIds,
    )
    if (!products.ok) return products
    const byId = new Map(products.value.map((p) => [p.id, p]))
    // Keep the order the agent picked; refuse unknown or paused products.
    const ordered = dto.productIds.map((id) => byId.get(id))
    if (ordered.some((p) => !p?.available)) {
      return err(
        whatsappCatalogInvalid(
          'Algum produto escolhido não existe ou está indisponível no catálogo',
        ),
      )
    }
    const picked = ordered.filter((p) => p !== undefined)

    const connection = await WhatsAppConnectionRepository.findById(
      conversation.value.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())

    const sent = await WhatsAppSend.products(
      connection.value,
      {
        to: conversation.value.contact.waId,
        catalogId: settings.value.metaCatalogId,
        bodyText: dto.bodyText,
        retailerIds: picked.map((p) => p.retailerId),
      },
      { cost: agentCost(actorId, conversation.value.id) },
    )
    if (!sent.ok) return sent

    await recordOutboundMessage({
      workspaceId,
      conversationId: conversation.value.id,
      type: 'TEXT',
      text: `${dto.bodyText}\n\nProdutos: ${picked.map((p) => p.name).join(', ')}`,
      providerMessageId: sent.value.providerMessageId,
      senderUserId: actorId,
    })
    auditMutation({
      entity: 'whatsapp_commerce_settings',
      action: 'send',
      actorId,
      targetId: conversation.value.id,
      meta: { workspaceId, products: picked.length },
    })
    return ok(sent.value)
  },

  async listOrders(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppCatalogOrderDTO[]>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const rows = await WhatsAppCatalogOrderRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppCatalogOrderDTO))
  },
}
