import z from 'zod'
import {
  type CanvasDocument,
  type CanvasNode,
  type CanvasProps,
  ROOT_ID,
} from '@/src/lib/canvas/types'
import { DocumentKindSchema } from '@/src/schemas/document.schema'
import {
  DOCUMENT_CATALOG_ID,
  DOCUMENT_CATALOG_VERSION,
  DOCUMENT_FIELD_TYPES,
  DOCUMENT_ROOT_TYPE,
  DOCUMENT_SECTION_TYPE,
  type DocumentFieldType,
} from './constants'
import { documentFontIdFor } from './theme'

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

// ─── conversion ───────────────────────────────────────────────────────────

/** Field types that fit side by side in a form card. */
const SHORT_FIELDS: ReadonlySet<DocumentFieldType> = new Set([
  'field-text',
  'field-email',
  'field-phone',
  'field-number',
  'field-date',
  'field-cpf',
  'field-cnpj',
])

type FieldBlock = Extract<DocumentOutlineLeafBlock, { type: 'field' }>

interface Builder {
  nodes: Record<string, CanvasNode>
  add: (
    type: string,
    props: CanvasProps,
    children?: string[],
    name?: string,
  ) => string
  /** Only one accept block per document (the catalog rule). */
  acceptUsed: boolean
  kind: DocumentOutline['kind']
}

function createBuilder(kind: DocumentOutline['kind']): Builder {
  const nodes: Record<string, CanvasNode> = {}
  let count = 0
  const add: Builder['add'] = (type, props, children, name) => {
    count += 1
    const id = type === DOCUMENT_SECTION_TYPE ? `s${count}` : `n${count}`
    const node: CanvasNode = { id, type, props }
    if (children) node.children = children
    if (name) node.meta = { name }
    nodes[id] = node
    return id
  }
  return { nodes, add, acceptUsed: false, kind }
}

const clamp = (value: number, max: number) =>
  Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), max)

function headingLevel(level: 1 | 2 | 3 | undefined, cover: boolean): string {
  if (level) return String(level)
  return cover ? '1' : '2'
}

/** Nodes of one leaf block (none for a second accept block). */
function leafNodes(
  block: DocumentOutlineLeafBlock,
  b: Builder,
  cover: boolean,
): string[] {
  switch (block.type) {
    case 'heading':
      return [
        b.add('heading', {
          text: block.text,
          level: headingLevel(block.level, cover),
        }),
      ]
    case 'text':
      return [b.add('text', { html: block.html, size: cover ? 'lg' : 'md' })]
    case 'list':
      return [
        b.add('list', {
          items: block.items.map((text) => ({ text })),
          marker: block.ordered ? 'number' : 'check',
        }),
      ]
    case 'quote':
      return [
        b.add('quote', {
          text: block.text,
          author: block.author,
          size: 'lg',
        }),
      ]
    case 'callout':
      return [
        b.add('callout', { text: block.text, tone: block.tone ?? 'info' }),
      ]
    case 'table': {
      const rows = block.header ? [block.header, ...block.rows] : block.rows
      return [
        b.add('table', {
          rows: rows.slice(0, 200),
          headerRow: Boolean(block.header),
          striped: block.rows.length > 4,
        }),
      ]
    }
    case 'image':
      return [
        b.add('image', {
          src: block.src ?? '',
          alt: block.alt ?? '',
          caption: block.caption,
        }),
      ]
    case 'divider':
      return [b.add('divider', {})]
    case 'page-break':
      return [b.add('page-break', {})]
    case 'pricing':
      return [
        b.add('pricing-table', {
          title: block.title,
          showTotals: block.showTotals ?? true,
          showDescriptions: true,
          items: block.items.map((item) => ({
            ...item,
            unitPrice: clamp(item.unitPrice, 1_000_000_000),
            quantity: clamp(item.quantity, 1_000_000),
          })),
        }),
      ]
    case 'field':
      return [fieldNode(block, b)]
    case 'accept': {
      if (b.acceptUsed) return []
      b.acceptUsed = true
      const proposal = b.kind === 'PROPOSAL'
      return [
        b.add('accept', {
          title: proposal ? 'Aceite da proposta' : 'Aceite do documento',
          buttonLabel: block.buttonLabel,
          terms: block.terms,
          allowDecline: block.allowDecline ?? true,
        }),
      ]
    }
    case 'stats':
      return [
        b.add('stats', {
          items: block.items,
          style: cover ? 'accent' : 'cards',
        }),
      ]
    case 'button':
      return [
        b.add('button', {
          label: block.label,
          link: { type: 'url', value: block.href },
          variant: 'primary',
        }),
      ]
    case 'video':
      return [b.add('video', { url: block.url })]
    case 'attachments':
      return [b.add('attachments', { title: 'Anexos', files: block.files })]
    case 'validity':
      return [b.add('validity', { style: 'badge', showCountdown: true })]
    case 'contact-card':
      return [
        b.add('contact-card', {
          title: 'Seu contato',
          name: '{{responsavel.nome}}',
          role: 'Responsável pela conta',
          company: '{{workspace.nome}}',
          email: '{{responsavel.email}}',
        }),
      ]
    case 'toc':
      return [b.add('toc', { title: 'Sumário', numbered: true })]
  }
}

function fieldNode(block: FieldBlock, b: Builder): string {
  const props: CanvasProps = { label: block.label }
  if (block.required) props.required = true
  if (block.placeholder) props.placeholder = block.placeholder
  if (block.options?.length) props.options = block.options
  return b.add(block.fieldType, props)
}

/** Consecutive fields become a form card; short ones pair up in columns. */
function fieldCard(fields: FieldBlock[], b: Builder): string {
  const children: string[] = []
  let pending: FieldBlock | null = null
  const flush = () => {
    if (pending) children.push(fieldNode(pending, b))
    pending = null
  }
  for (const field of fields) {
    if (!SHORT_FIELDS.has(field.fieldType)) {
      flush()
      children.push(fieldNode(field, b))
      continue
    }
    if (!pending) {
      pending = field
      continue
    }
    const left = b.add('column', {}, [fieldNode(pending, b)])
    const right = b.add('column', {}, [fieldNode(field, b)])
    children.push(b.add('columns', { ratio: '1-1', gap: 16 }, [left, right]))
    pending = null
  }
  flush()
  return b.add('container', { style: 'card' }, children)
}

const RATIOS: Record<number, string> = {
  2: '1-1',
  3: '1-1-1',
  4: '1-1-1-1',
}

function blockNodes(
  blocks: DocumentOutlineBlock[],
  b: Builder,
  cover: boolean,
): string[] {
  const ids: string[] = []
  let fields: FieldBlock[] = []
  const flushFields = () => {
    if (fields.length > 0) ids.push(fieldCard(fields, b))
    fields = []
  }
  for (const block of blocks) {
    if (block.type === 'field') {
      fields.push(block)
      continue
    }
    flushFields()
    if (block.type === 'columns') {
      const columns: string[] = []
      for (const leaves of block.columns) {
        const inner = leaves.flatMap((leaf) => leafNodes(leaf, b, cover))
        columns.push(b.add('column', {}, inner))
      }
      const ratio = RATIOS[columns.length] ?? '1-1'
      ids.push(b.add('columns', { ratio, gap: 32 }, columns))
      continue
    }
    ids.push(...leafNodes(block, b, cover))
  }
  flushFields()
  return ids
}

function outlineTheme(
  theme: DocumentOutline['theme'],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!theme) return out
  if (theme.primaryColor) out.colors = { primary: theme.primaryColor }
  if (theme.fontFamily) {
    const font = documentFontIdFor(theme.fontFamily)
    out.fonts = { heading: font, body: font }
  }
  if (theme.logoUrl) out.logoUrl = theme.logoUrl
  return out
}

/**
 * Canvas document of an outline, built with the catalog presets: covers
 * open on a large title (and the logo of the theme), consecutive fields
 * become a form card with short fields side by side, columns keep their
 * count, only the first accept block is kept. Ids are sequential and
 * deterministic (`s<n>` sections, `n<n>` nodes), so converting the same
 * outline twice gives the same document. Callers: AI import, proposal
 * converter, starters.
 */
export function outlineToDocument(
  outline: DocumentOutline,
): OutlineToDocumentResult {
  const b = createBuilder(outline.kind)
  const sections = outline.sections.map((section) => {
    const cover = section.variant === 'cover'
    const children = blockNodes(section.blocks, b, cover)
    if (cover && outline.theme?.logoUrl) {
      const logo = b.add('image', {
        src: outline.theme.logoUrl,
        alt: 'Logo',
        width: 28,
        align: 'left',
        radius: 0,
      })
      children.unshift(logo)
    }
    const props: CanvasProps = {}
    if (section.variant && section.variant !== 'default') {
      props.variant = section.variant
    }
    if (section.pageBreakBefore) props.pageBreakBefore = true
    return b.add(DOCUMENT_SECTION_TYPE, props, children, section.name)
  })
  b.nodes[ROOT_ID] = {
    id: ROOT_ID,
    type: DOCUMENT_ROOT_TYPE,
    props: {},
    children: sections,
  }
  const content: CanvasDocument = {
    catalog: DOCUMENT_CATALOG_ID,
    version: DOCUMENT_CATALOG_VERSION,
    rootId: ROOT_ID,
    nodes: b.nodes,
  }
  return { content, theme: outlineTheme(outline.theme) }
}
