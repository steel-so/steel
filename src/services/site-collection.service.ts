import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type CollectionField,
  type CollectionProductValue,
  parseCollectionFields,
  parseItemData,
} from '@/src/lib/sites/blog/collections'
import { firstFreeSlug } from '@/src/lib/sites/blog/routes'
import {
  collectionTemplateKey,
  defaultCollectionTemplate,
} from '@/src/lib/sites/blog/templates'
import { revalidateSites } from '@/src/lib/sites/cache'
import { slugify } from '@/src/lib/sites/slug'
import { toSiteGlobalDTO } from '@/src/mappers/site.mapper'
import {
  toSiteCollectionDTO,
  toSiteCollectionItemDTO,
} from '@/src/mappers/site-blog.mapper'
import { CrmProductRepository } from '@/src/repositories/crm-product.repository'
import { SiteCollectionRepository } from '@/src/repositories/site-collection.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import type {
  CreateSiteCollectionDTO,
  CreateSiteCollectionItemDTO,
  ReorderSiteCollectionItemsDTO,
  UpdateSiteCollectionDTO,
  UpdateSiteCollectionItemDTO,
} from '@/src/schemas/site-collection.schema'
import type { SiteGlobalDTO } from '@/types/site'
import type {
  SiteCollectionDTO,
  SiteCollectionItemDTO,
} from '@/types/site-blog'
import { authorizeSite } from './site-access'

/**
 * Collections of a site (custom content types like WordPress custom post
 * types / Webflow CMS): typed fields, items, and an optional item page
 * (`/<collection>/<item>`) whose template is a TEMPLATE global edited in
 * the canvas. Items go live when PUBLISHED (no site publish).
 */

export const MAX_COLLECTIONS_PER_SITE = 30
export const MAX_ITEMS_PER_COLLECTION = 1000

const json = (value: unknown) => value as Prisma.InputJsonValue
const limit = (message: string) => appError('SITE_LIMIT_REACHED', message)
const invalidItem = (errors: string[]) =>
  appError('SITE_COLLECTION_ITEM_INVALID', errors[0] ?? 'Item inválido', errors)

/** Reference fields must point to collections of the same site. */
async function checkFieldTargets(
  siteId: string,
  fields: CollectionField[],
): Promise<Result<true>> {
  for (const field of fields) {
    if (field.type !== 'reference' || !field.collectionId) continue
    const target = await SiteCollectionRepository.findById(
      field.collectionId,
      siteId,
    )
    if (!target.ok) return target
  }
  return ok(true)
}

/** Validates the values against the fields, checks references and fills
 * product names/prices from the CRM. */
async function checkItemData(
  siteId: string,
  workspaceId: string,
  fields: CollectionField[],
  input: Record<string, unknown>,
): Promise<Result<Record<string, unknown>>> {
  const parsed = parseItemData(fields, input)
  if (!parsed.ok) return err(invalidItem(parsed.errors))
  const data = parsed.data
  const referenceIds = fields
    .filter((field) => field.type === 'reference' && data[field.key])
    .map((field) => ({ field, id: data[field.key] as string }))
  if (referenceIds.length) {
    const found = await SiteCollectionRepository.findItemsInSite(
      siteId,
      referenceIds.map((entry) => entry.id),
    )
    if (!found.ok) return found
    for (const { field, id } of referenceIds) {
      const item = found.value.find((entry) => entry.id === id)
      if (!item || item.collection.id !== field.collectionId) {
        return err(invalidItem([`${field.label}: item não encontrado`]))
      }
    }
  }
  for (const field of fields) {
    if (field.type !== 'product' || !data[field.key]) continue
    const value = data[field.key] as CollectionProductValue
    const product = await CrmProductRepository.findById(value.id, workspaceId)
    if (!product.ok) {
      return err(invalidItem([`${field.label}: produto não encontrado`]))
    }
    data[field.key] = {
      id: product.value.id,
      name: product.value.name,
      price: Math.round(Number(product.value.unitPrice) * 100),
      currency: product.value.currency,
    }
  }
  return ok(data)
}

async function freeItemSlug(
  collectionId: string,
  base: string,
  excludeId?: string,
): Promise<Result<string>> {
  const used = await SiteCollectionRepository.itemSlugsLike(
    collectionId,
    base,
    excludeId,
  )
  if (!used.ok) return used
  return ok(firstFreeSlug(base, used.value))
}

const slugTaken = () =>
  appError(
    'SITE_COLLECTION_ITEM_SLUG_TAKEN',
    'Já existe um item com este endereço nesta coleção',
  )

export const SiteCollectionService = {
  async list(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteCollectionDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const list = await SiteCollectionRepository.list(siteId)
    if (!list.ok) return list
    return ok(list.value.map(toSiteCollectionDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
  ): Promise<Result<SiteCollectionDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const collection = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!collection.ok) return collection
    return ok(toSiteCollectionDTO(collection.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSiteCollectionDTO,
  ): Promise<Result<SiteCollectionDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const total = await SiteCollectionRepository.count(siteId)
    if (!total.ok) return total
    if (total.value >= MAX_COLLECTIONS_PER_SITE) {
      return err(
        limit(`Um site pode ter até ${MAX_COLLECTIONS_PER_SITE} coleções`),
      )
    }
    const fields = dto.fields ?? []
    const targets = await checkFieldTargets(siteId, fields)
    if (!targets.ok) return targets
    const created = await SiteCollectionRepository.create({
      siteId,
      name: dto.name,
      itemName: dto.itemName ?? 'Item',
      slug: dto.slug ?? (slugify(dto.name, 80) || 'colecao'),
      fields: json(fields),
      position: total.value,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'site_collection',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, fields: fields.length },
    })
    return ok(toSiteCollectionDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
    dto: UpdateSiteCollectionDTO,
  ): Promise<Result<SiteCollectionDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!current.ok) return current
    if (dto.fields) {
      // A self-reference is fine; only other collections need checking.
      const targets = await checkFieldTargets(
        siteId,
        dto.fields.filter((field) => field.collectionId !== collectionId),
      )
      if (!targets.ok) return targets
    }
    const updated = await SiteCollectionRepository.update(collectionId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.itemName !== undefined ? { itemName: dto.itemName } : {}),
      ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
      ...(dto.fields !== undefined ? { fields: json(dto.fields) } : {}),
    })
    if (!updated.ok) return updated
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_collection',
      action: 'update',
      actorId,
      targetId: collectionId,
      meta: { siteId, fields: Object.keys(dto) },
    })
    return ok(toSiteCollectionDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'DELETE')
    if (!site.ok) return site
    const current = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!current.ok) return current
    const removed = await SiteCollectionRepository.delete(collectionId)
    if (!removed.ok) return removed
    // Its item template goes with it (best effort: an orphan template
    // renders nothing and can be deleted from the editor).
    if (current.value.templateGlobalId) {
      await SiteGlobalRepository.delete(current.value.templateGlobalId)
    }
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_collection',
      action: 'delete',
      actorId,
      targetId: collectionId,
      meta: { siteId, items: current.value._count.items },
    })
    return ok(undefined)
  },

  /** Creates the item page template (a TEMPLATE global) from the fields;
   * returns the existing one when the collection already has it. */
  async ensureItemTemplate(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
  ): Promise<Result<SiteGlobalDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const collection = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!collection.ok) return collection
    if (collection.value.templateGlobalId) {
      const existing = await SiteGlobalRepository.findById(
        collection.value.templateGlobalId,
        siteId,
      )
      if (existing.ok) return ok(toSiteGlobalDTO(existing.value))
    }
    const created = await SiteGlobalRepository.create({
      siteId,
      kind: 'TEMPLATE',
      name: collectionTemplateKey(collectionId),
      document: json(
        defaultCollectionTemplate(
          parseCollectionFields(collection.value.fields),
        ),
      ),
    })
    if (!created.ok) return created
    const linked = await SiteCollectionRepository.update(collectionId, {
      templateGlobalId: created.value.id,
    })
    if (!linked.ok) return linked
    auditMutation({
      entity: 'site_collection',
      action: 'update',
      actorId,
      targetId: collectionId,
      meta: { siteId, template: created.value.id },
    })
    return ok(toSiteGlobalDTO(created.value))
  },

  // ─── items ──────────────────────────────────────────────────────────────

  async listItems(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
    filters: { status?: 'DRAFT' | 'PUBLISHED'; search?: string } = {},
  ): Promise<Result<SiteCollectionItemDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const collection = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!collection.ok) return collection
    const items = await SiteCollectionRepository.listItems(
      collectionId,
      filters,
    )
    if (!items.ok) return items
    return ok(items.value.map(toSiteCollectionItemDTO))
  },

  async createItem(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
    dto: CreateSiteCollectionItemDTO,
    now: Date = new Date(),
  ): Promise<Result<SiteCollectionItemDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const collection = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!collection.ok) return collection
    if (collection.value._count.items >= MAX_ITEMS_PER_COLLECTION) {
      return err(
        limit(`Uma coleção pode ter até ${MAX_ITEMS_PER_COLLECTION} itens`),
      )
    }
    const data = await checkItemData(
      siteId,
      workspaceId,
      parseCollectionFields(collection.value.fields),
      dto.data ?? {},
    )
    if (!data.ok) return data
    const slug = await freeItemSlug(
      collectionId,
      dto.slug ?? (slugify(dto.title, 80) || 'item'),
    )
    if (!slug.ok) return slug
    if (dto.slug && slug.value !== dto.slug) return err(slugTaken())
    const status = dto.status ?? 'DRAFT'
    const created = await SiteCollectionRepository.createItem({
      collectionId,
      title: dto.title,
      slug: slug.value,
      data: json(data.value),
      status,
      position: collection.value._count.items,
      publishedAt: status === 'PUBLISHED' ? now : null,
    })
    if (!created.ok) return created
    if (status === 'PUBLISHED') revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_collection_item',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, collectionId, status },
    })
    return ok(toSiteCollectionItemDTO(created.value))
  },

  async updateItem(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
    itemId: string,
    dto: UpdateSiteCollectionItemDTO,
    now: Date = new Date(),
  ): Promise<Result<SiteCollectionItemDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const collection = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!collection.ok) return collection
    const current = await SiteCollectionRepository.findItem(
      itemId,
      collectionId,
    )
    if (!current.ok) return current

    const update: Parameters<typeof SiteCollectionRepository.updateItem>[1] = {}
    if (dto.title !== undefined) update.title = dto.title
    if (dto.slug !== undefined && dto.slug !== current.value.slug) {
      const slug = await freeItemSlug(collectionId, dto.slug, itemId)
      if (!slug.ok) return slug
      if (slug.value !== dto.slug) return err(slugTaken())
      update.slug = dto.slug
    }
    if (dto.data !== undefined) {
      const data = await checkItemData(
        siteId,
        workspaceId,
        parseCollectionFields(collection.value.fields),
        dto.data,
      )
      if (!data.ok) return data
      update.data = json(data.value)
    }
    if (dto.status !== undefined) {
      update.status = dto.status
      if (dto.status === 'PUBLISHED' && !current.value.publishedAt) {
        update.publishedAt = now
      }
    }
    const updated = await SiteCollectionRepository.updateItem(itemId, update)
    if (!updated.ok) return updated
    if (
      current.value.status === 'PUBLISHED' ||
      updated.value.status === 'PUBLISHED'
    ) {
      revalidateSites(site.value.slug)
    }
    auditMutation({
      entity: 'site_collection_item',
      action:
        dto.status === 'PUBLISHED' && current.value.status !== 'PUBLISHED'
          ? 'publish'
          : 'update',
      actorId,
      targetId: itemId,
      meta: { siteId, collectionId, fields: Object.keys(dto) },
    })
    return ok(toSiteCollectionItemDTO(updated.value))
  },

  async removeItem(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
    itemId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'DELETE')
    if (!site.ok) return site
    const collection = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!collection.ok) return collection
    const current = await SiteCollectionRepository.findItem(
      itemId,
      collectionId,
    )
    if (!current.ok) return current
    const removed = await SiteCollectionRepository.deleteItem(itemId)
    if (!removed.ok) return removed
    if (current.value.status === 'PUBLISHED') revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_collection_item',
      action: 'delete',
      actorId,
      targetId: itemId,
      meta: { siteId, collectionId },
    })
    return ok(undefined)
  },

  async reorderItems(
    actorId: string,
    workspaceId: string,
    siteId: string,
    collectionId: string,
    dto: ReorderSiteCollectionItemsDTO,
  ): Promise<Result<SiteCollectionItemDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const collection = await SiteCollectionRepository.findById(
      collectionId,
      siteId,
    )
    if (!collection.ok) return collection
    const reordered = await SiteCollectionRepository.reorderItems(
      collectionId,
      dto.orderedIds,
    )
    if (!reordered.ok) return reordered
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_collection_item',
      action: 'reorder',
      actorId,
      targetId: collectionId,
      meta: { siteId, count: dto.orderedIds.length },
    })
    const items = await SiteCollectionRepository.listItems(collectionId)
    if (!items.ok) return items
    return ok(items.value.map(toSiteCollectionItemDTO))
  },
}
