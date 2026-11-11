import z from 'zod'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { DocumentKindSchema } from '@/src/schemas/document.schema'
import { DOCUMENT_FIELD_TYPES } from './constants'

/**
 * Document outline: a plain, catalog-independent description of a document
 * (sections → blocks). The AI import, the proposal converter and the starter
 * gallery produce outlines; the catalog turns them into canvas documents with
 * its presets (`outlineToDocument`). The schema doubles as the structured
 * output the AI must return.
 */

const InlineHtml = z.string().max(20_000)
const ShortText = z.string().max(500)
const UrlText = z.string().max(2000)
const StatItemSchema = z.object({ value: ShortText, label: ShortText })
const AttachmentFileSchema = z.object({ name: ShortText, url: UrlText })

const PricingItemSchema = z.object({
  id: z.string().min(1).max(64),
  productId: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  unit: z.string().max(40).optional(),
  unitPrice: z.number().min(0),
  quantity: z.number().min(0),
  discountPct: z.number().min(0).max(100).optional(),
  optional: z.boolean().optional(),
  selectedByDefault: z.boolean().optional(),
  quantityEditable: z.boolean().optional(),
  recurrence: z.enum(['once', 'monthly', 'yearly']).optional(),
})

const LeafBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text: ShortText,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  }),
  /** Inline HTML limited to p, strong, em, u, a, br, ul, ol, li. */
  z.object({ type: z.literal('text'), html: InlineHtml }),
  z.object({
    type: z.literal('list'),
    items: z.array(UrlText).max(100),
    ordered: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('quote'),
    text: UrlText,
    author: ShortText.optional(),
  }),
  z.object({
    type: z.literal('callout'),
    text: UrlText,
    tone: z.enum(['info', 'success', 'warning']).optional(),
  }),
  z.object({
    type: z.literal('table'),
    header: z.array(ShortText).max(12).optional(),
    rows: z.array(z.array(z.string().max(1000)).max(12)).max(200),
  }),
  /** No `src` = an image placeholder the user fills in. */
  z.object({
    type: z.literal('image'),
    src: UrlText.optional(),
    alt: ShortText.optional(),
    caption: ShortText.optional(),
  }),
  z.object({ type: z.literal('divider') }),
  z.object({ type: z.literal('page-break') }),
  z.object({
    type: z.literal('pricing'),
    title: ShortText.optional(),
    items: z.array(PricingItemSchema).max(100),
    showTotals: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('field'),
    fieldType: z.enum(DOCUMENT_FIELD_TYPES),
    label: ShortText,
    required: z.boolean().optional(),
    placeholder: ShortText.optional(),
    options: z.array(ShortText).max(50).optional(),
  }),
  z.object({
    type: z.literal('accept'),
    buttonLabel: ShortText.optional(),
    terms: UrlText.optional(),
    allowDecline: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('stats'),
    items: z.array(StatItemSchema).max(8),
  }),
  z.object({
    type: z.literal('button'),
    label: ShortText,
    href: UrlText,
  }),
  z.object({ type: z.literal('video'), url: UrlText }),
  z.object({
    type: z.literal('attachments'),
    files: z.array(AttachmentFileSchema).max(20),
  }),
  z.object({ type: z.literal('validity') }),
  z.object({ type: z.literal('contact-card') }),
  z.object({ type: z.literal('toc') }),
])

export type DocumentOutlineLeafBlock = z.infer<typeof LeafBlockSchema>

const ColumnsBlockSchema = z.object({
  type: z.literal('columns'),
  columns: z.array(z.array(LeafBlockSchema).max(30)).min(2).max(4),
})

export const DocumentOutlineBlockSchema = z.union([
  LeafBlockSchema,
  ColumnsBlockSchema,
])
export type DocumentOutlineBlock = z.infer<typeof DocumentOutlineBlockSchema>

export const DocumentOutlineSectionSchema = z.object({
  name: z.string().min(1).max(120),
  variant: z.enum(['cover', 'default', 'highlight']).optional(),
  pageBreakBefore: z.boolean().optional(),
  blocks: z.array(DocumentOutlineBlockSchema).max(80),
})
export type DocumentOutlineSection = z.infer<
  typeof DocumentOutlineSectionSchema
>

export const DocumentOutlineSchema = z.object({
  title: z.string().min(1).max(200),
  kind: DocumentKindSchema,
  sections: z.array(DocumentOutlineSectionSchema).min(1).max(60),
  theme: z
    .object({
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      fontFamily: z.string().max(80).optional(),
      logoUrl: UrlText.optional(),
    })
    .optional(),
})
export type DocumentOutline = z.infer<typeof DocumentOutlineSchema>

export interface OutlineToDocumentResult {
  content: CanvasDocument
  /** Theme overrides derived from `outline.theme`. */
  theme: Record<string, unknown>
}

/**
 * CONTRACT STUB (ADR 0063): the documents catalog slice implements it with
 * the catalog presets. Callers: AI import, proposal converter, starters.
 */
export function outlineToDocument(
  _outline: DocumentOutline,
): OutlineToDocumentResult {
  throw new Error('outlineToDocument not implemented yet')
}
