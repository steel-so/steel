import { z } from 'zod'
import {
  SITE_CMS_FIELD_TYPES,
  type SiteCmsFieldType,
  type SiteCmsValue,
} from '@/src/lib/canvas-site/cms'
import {
  richTextToPlain,
  safeHref,
  safeSrc,
  sanitizeRichText,
} from '@/src/lib/canvas-site/sanitize'
import { formatSiteDate } from './format'

/**
 * Collections (custom content types): field definitions, validation of an
 * item's values against them and the formatted values the collection
 * elements render. Pure; the service stores what `parseItemData` returns.
 */

export const MAX_COLLECTION_FIELDS = 30
/** Keys the item row already has. */
const RESERVED_FIELD_KEYS = new Set(['title', 'slug', 'id', 'status'])

export const SITE_CMS_FIELD_LABELS: Record<SiteCmsFieldType, string> = {
  text: 'Texto',
  richtext: 'Texto formatado',
  image: 'Imagem',
  number: 'Número',
  date: 'Data',
  link: 'Link',
  reference: 'Referência a outra coleção',
  product: 'Produto do CRM',
}

export const CollectionFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use letras minúsculas, números e _')
    .refine((key) => !RESERVED_FIELD_KEYS.has(key), {
      message: 'Esse nome de campo é reservado',
    }),
  label: z.string().trim().min(1, 'Nome do campo é obrigatório').max(80),
  type: z.enum(SITE_CMS_FIELD_TYPES),
  required: z.boolean().optional(),
  /** Collection a `reference` field points to. */
  collectionId: z.string().min(1).max(64).optional(),
  help: z.string().trim().max(200).optional(),
})
export type CollectionField = z.infer<typeof CollectionFieldSchema>

export const CollectionFieldsSchema = z
  .array(CollectionFieldSchema)
  .max(MAX_COLLECTION_FIELDS)
  .refine(
    (fields) =>
      new Set(fields.map((field) => field.key)).size === fields.length,
    { message: 'Cada campo precisa de um nome único' },
  )
  .refine(
    (fields) =>
      fields.every(
        (field) => field.type !== 'reference' || Boolean(field.collectionId),
      ),
    { message: 'Escolha a coleção de cada campo de referência' },
  )

/** Fields read back from the database (malformed → none). */
export function parseCollectionFields(value: unknown): CollectionField[] {
  const parsed = CollectionFieldsSchema.safeParse(value ?? [])
  return parsed.success ? parsed.data : []
}

const ImageValue = z.object({
  url: z.string().trim().max(2000),
  alt: z.string().trim().max(300).optional(),
})
const LinkValue = z.object({
  url: z.string().trim().max(2000),
  label: z.string().trim().max(200).optional(),
})
const ProductValue = z.object({
  id: z.string().min(1).max(64),
  /** Filled by the service from the CRM product. */
  name: z.string().max(200).default(''),
  /** Price in cents, as on the product when it was picked. */
  price: z.number().nullable().optional(),
  currency: z.string().max(8).optional(),
})

export type CollectionImageValue = z.infer<typeof ImageValue>
export type CollectionLinkValue = z.infer<typeof LinkValue>
export type CollectionProductValue = z.infer<typeof ProductValue>

const DATE = /^\d{4}-\d{2}-\d{2}$/

function valueSchema(field: CollectionField): z.ZodType {
  switch (field.type) {
    case 'text':
      return z.string().trim().max(2000)
    case 'richtext':
      return z.string().max(50_000)
    case 'image':
      return ImageValue.refine((value) => Boolean(safeSrc(value.url)), {
        message: 'Imagem inválida',
      })
    case 'number':
      return z.number().finite()
    case 'date':
      return z
        .string()
        .regex(DATE, 'Use o formato AAAA-MM-DD')
        .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
          message: 'Data inválida',
        })
    case 'link':
      return LinkValue.refine((value) => Boolean(safeHref(value.url)), {
        message: 'Link inválido',
      })
    case 'reference':
      return z.string().min(1).max(64)
    case 'product':
      return ProductValue
  }
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (typeof value === 'object' && 'url' in (value as object)) {
    return !(value as { url?: string }).url
  }
  return false
}

/**
 * Validates an item's values against the collection fields: unknown keys
 * are dropped, empty values removed, required ones enforced and rich text
 * sanitized. Errors are pt-BR lines naming the field.
 */
export function parseItemData(
  fields: CollectionField[],
  input: Record<string, unknown>,
):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: string[] } {
  const data: Record<string, unknown> = {}
  const errors: string[] = []
  for (const field of fields) {
    const raw = input[field.key]
    if (isEmpty(raw)) {
      if (field.required) errors.push(`${field.label}: campo obrigatório`)
      continue
    }
    const parsed = valueSchema(field).safeParse(raw)
    if (!parsed.success) {
      errors.push(
        `${field.label}: ${parsed.error.issues[0]?.message ?? 'valor inválido'}`,
      )
      continue
    }
    data[field.key] =
      field.type === 'richtext'
        ? sanitizeRichText(parsed.data as string)
        : parsed.data
  }
  return errors.length ? { ok: false, errors } : { ok: true, data }
}

/** Ids of other items the values point to (`reference` fields). */
export function referencedItemIds(
  fields: CollectionField[],
  data: Record<string, unknown>,
): string[] {
  return fields
    .filter((field) => field.type === 'reference')
    .map((field) => data[field.key])
    .filter((value): value is string => typeof value === 'string' && !!value)
}

function formatMoney(cents: number, currency = 'BRL'): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
    }).format(cents / 100)
  } catch {
    return (cents / 100).toFixed(2)
  }
}

export interface ItemValueContext {
  timezone?: string
  /** Title and public URL of referenced items, by id. */
  references?: Map<string, { title: string; href?: string }>
}

/** The values of an item as the collection elements render them. */
export function formatItemValues(
  fields: CollectionField[],
  data: Record<string, unknown>,
  ctx: ItemValueContext = {},
): Record<string, SiteCmsValue> {
  const out: Record<string, SiteCmsValue> = {}
  for (const field of fields) {
    const raw = data[field.key]
    if (isEmpty(raw)) continue
    switch (field.type) {
      case 'text':
        out[field.key] = { type: 'text', text: String(raw) }
        break
      case 'richtext': {
        const html = sanitizeRichText(String(raw))
        out[field.key] = { type: 'richtext', text: richTextToPlain(html), html }
        break
      }
      case 'image': {
        const value = raw as CollectionImageValue
        out[field.key] = {
          type: 'image',
          text: value.alt ?? '',
          url: safeSrc(value.url),
          alt: value.alt ?? '',
        }
        break
      }
      case 'number':
        out[field.key] = {
          type: 'number',
          text: new Intl.NumberFormat('pt-BR').format(Number(raw)),
        }
        break
      case 'date':
        out[field.key] = {
          type: 'date',
          text: formatSiteDate(`${raw}T12:00:00Z`, 'UTC'),
        }
        break
      case 'link': {
        const value = raw as CollectionLinkValue
        out[field.key] = {
          type: 'link',
          text: value.label || value.url.replace(/^https?:\/\//, ''),
          url: safeHref(value.url),
        }
        break
      }
      case 'reference': {
        const ref = ctx.references?.get(String(raw))
        if (ref) {
          out[field.key] = { type: 'reference', text: ref.title, url: ref.href }
        }
        break
      }
      case 'product': {
        const value = raw as CollectionProductValue
        out[field.key] = {
          type: 'product',
          text:
            value.price !== null && value.price !== undefined
              ? `${value.name} — ${formatMoney(value.price, value.currency)}`
              : value.name,
        }
        break
      }
    }
  }
  return out
}

/** Plain text of an item (sitemap/llms.txt summaries, search). */
export function itemSummary(
  fields: CollectionField[],
  data: Record<string, unknown>,
  max = 200,
): string {
  const values = formatItemValues(fields, data)
  const text = fields
    .filter((field) => field.type === 'text' || field.type === 'richtext')
    .map((field) => values[field.key]?.text ?? '')
    .filter(Boolean)
    .join(' ')
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
