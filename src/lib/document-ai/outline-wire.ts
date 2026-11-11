import { z } from 'zod'
import { DOCUMENT_FIELD_TYPES } from '@/src/lib/canvas-document/constants'
import {
  type DocumentOutline,
  DocumentOutlineSchema,
} from '@/src/lib/canvas-document/outline'
import { DOCUMENT_KINDS } from '@/src/schemas/document.schema'

/**
 * Wire format of the AI import: the JSON schema the model must follow
 * (structured outputs) and the step that turns its answer into a
 * `DocumentOutline`. Both providers' strict modes want every property
 * required, so optional fields travel as `null`; images travel without a
 * `src` (placeholders the user fills in); pricing item ids are ours.
 */

type JsonSchema = Record<string, unknown>

const STRING: JsonSchema = { type: 'string' }
const NUMBER: JsonSchema = { type: 'number' }
const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: 'null' }],
})
const NULLABLE_STRING = nullable(STRING)
const NULLABLE_BOOLEAN = nullable({ type: 'boolean' })
const strings = (): JsonSchema => ({ type: 'array', items: STRING })
const choice = (values: readonly (string | number)[]): JsonSchema => ({
  type: typeof values[0] === 'number' ? 'integer' : 'string',
  enum: [...values],
})

/** A closed object: every property required (strict mode). */
function object(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }
}

const block = (type: string, properties: Record<string, JsonSchema> = {}) =>
  object({ type: choice([type]), ...properties })

const PRICING_ITEM = object({
  name: STRING,
  description: NULLABLE_STRING,
  unit: NULLABLE_STRING,
  unitPrice: NUMBER,
  quantity: NUMBER,
  discountPct: nullable(NUMBER),
  optional: NULLABLE_BOOLEAN,
  recurrence: nullable(choice(['once', 'monthly', 'yearly'])),
})

const LEAF_BLOCKS: JsonSchema[] = [
  block('heading', { text: STRING, level: nullable(choice([1, 2, 3])) }),
  block('text', { html: STRING }),
  block('list', { items: strings(), ordered: NULLABLE_BOOLEAN }),
  block('quote', { text: STRING, author: NULLABLE_STRING }),
  block('callout', {
    text: STRING,
    tone: nullable(choice(['info', 'success', 'warning'])),
  }),
  block('table', {
    header: nullable(strings()),
    rows: { type: 'array', items: strings() },
  }),
  block('image', { alt: NULLABLE_STRING, caption: NULLABLE_STRING }),
  block('divider'),
  block('page-break'),
  block('pricing', {
    title: NULLABLE_STRING,
    items: { type: 'array', items: PRICING_ITEM },
    showTotals: NULLABLE_BOOLEAN,
  }),
  block('field', {
    fieldType: choice(DOCUMENT_FIELD_TYPES),
    label: STRING,
    required: NULLABLE_BOOLEAN,
    placeholder: NULLABLE_STRING,
    options: nullable(strings()),
  }),
  block('accept', {
    buttonLabel: NULLABLE_STRING,
    terms: NULLABLE_STRING,
    allowDecline: NULLABLE_BOOLEAN,
  }),
  block('stats', {
    items: {
      type: 'array',
      items: object({ value: STRING, label: STRING }),
    },
  }),
  block('button', { label: STRING, href: STRING }),
  block('video', { url: STRING }),
  block('toc'),
  block('validity'),
  block('contact-card'),
]

const LEAF_REF: JsonSchema = { $ref: '#/$defs/leaf' }

export const DOCUMENT_OUTLINE_JSON_SCHEMA: JsonSchema = {
  ...object({
    title: STRING,
    kind: choice(DOCUMENT_KINDS),
    primaryColor: NULLABLE_STRING,
    sections: {
      type: 'array',
      items: object({
        name: STRING,
        variant: nullable(choice(['cover', 'default', 'highlight'])),
        pageBreakBefore: NULLABLE_BOOLEAN,
        blocks: {
          type: 'array',
          items: {
            anyOf: [
              LEAF_REF,
              block('columns', {
                columns: {
                  type: 'array',
                  items: { type: 'array', items: LEAF_REF },
                },
              }),
            ],
          },
        },
      }),
    },
  }),
  $defs: { leaf: { anyOf: LEAF_BLOCKS } },
}

// ── Answer → outline ───────────────────────────────────────────────────────

/** Most blocks per section in the outline; longer sections are split. */
const MAX_BLOCKS_PER_SECTION = 80
const MAX_SECTIONS = 60
const MAX_TABLE_ROWS = 200
const MAX_TABLE_COLUMNS = 12
const MAX_COLUMNS = 4
const HEX = /^#[0-9a-fA-F]{6}$/

/** Recursively drops `null` (the wire's "absent"). */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== null)
    return Object.fromEntries(
      entries.map(([key, item]) => [key, stripNulls(item)]),
    )
  }
  return value
}

const ALLOWED_TAGS = /^(p|strong|b|em|i|u|a|br|ul|ol|li)$/i
const TAG_ALIASES: Record<string, string> = { b: 'strong', i: 'em' }

/**
 * Inline HTML of a text block limited to the outline's tags: any other tag
 * is dropped (its text kept), attributes other than a safe `href` too.
 */
export function sanitizeInlineHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (tag, name: string, attrs) => {
      if (!ALLOWED_TAGS.test(name)) return ''
      const lower = TAG_ALIASES[name.toLowerCase()] ?? name.toLowerCase()
      const close = tag.startsWith('</')
      if (close) return `</${lower}>`
      if (lower !== 'a') return lower === 'br' ? '<br>' : `<${lower}>`
      const href = /href\s*=\s*"([^"]*)"/i.exec(String(attrs))?.[1] ?? ''
      return /^(https?:|mailto:|tel:)/i.test(href.trim())
        ? `<a href="${href.trim()}">`
        : '<a>'
    })
}

type Raw = Record<string, unknown>

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

function tableRow(row: unknown): unknown[] {
  return list(row).slice(0, MAX_TABLE_COLUMNS)
}

function normalizeLeaf(raw: Raw, ids: () => string): Raw {
  switch (raw.type) {
    case 'text':
      return { ...raw, html: sanitizeInlineHtml(String(raw.html ?? '')) }
    case 'table': {
      const rows = list(raw.rows).slice(0, MAX_TABLE_ROWS)
      return {
        ...raw,
        ...(Array.isArray(raw.header) && { header: tableRow(raw.header) }),
        rows: rows.map(tableRow),
      }
    }
    case 'pricing': {
      const items = list(raw.items) as Raw[]
      return { ...raw, items: items.map((item) => ({ ...item, id: ids() })) }
    }
    default:
      return raw
  }
}

/** A block, or — for columns with a single column — its blocks inline. */
function normalizeBlock(raw: Raw, ids: () => string): Raw[] {
  if (raw.type !== 'columns') return [normalizeLeaf(raw, ids)]
  const leaves = (column: unknown) =>
    (list(column) as Raw[]).map((leaf) => normalizeLeaf(leaf, ids))
  const columns = list(raw.columns).slice(0, MAX_COLUMNS).map(leaves)
  if (columns.length < 2) return columns.flat()
  return [{ ...raw, columns }]
}

function normalizeSection(section: Raw, ids: () => string): Raw {
  const blocks = list(section.blocks) as Raw[]
  return {
    ...section,
    blocks: blocks.flatMap((item) => normalizeBlock(item, ids)),
  }
}

/** Sections past the block limit continue in a new section. */
function splitSections(sections: Raw[]): Raw[] {
  return sections.flatMap((section) => {
    const blocks = list(section.blocks)
    if (blocks.length <= MAX_BLOCKS_PER_SECTION) return [section]
    const parts: Raw[] = []
    for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_SECTION) {
      const continued = {
        name: `${String(section.name)} (continuação)`,
        variant: 'default',
        pageBreakBefore: false,
      }
      parts.push({
        ...section,
        ...(i > 0 && continued),
        blocks: blocks.slice(i, i + MAX_BLOCKS_PER_SECTION),
      })
    }
    return parts
  })
}

/** The model's answer (already parsed JSON) as an outline candidate. */
export function wireToOutlineInput(answer: unknown): unknown {
  const value = stripNulls(answer)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const raw = value as Raw
  let next = 0
  const ids = () => `item-${++next}`
  const sections = list(raw.sections) as Raw[]
  const color = typeof raw.primaryColor === 'string' ? raw.primaryColor : ''
  const { primaryColor: _color, ...rest } = raw
  return {
    ...rest,
    ...(HEX.test(color) && { theme: { primaryColor: color } }),
    sections: splitSections(
      sections.map((section) => normalizeSection(section, ids)),
    ).slice(0, MAX_SECTIONS),
  }
}

/** Schema of the answer: wire → normalized → the outline contract. */
export const DocumentOutlineAnswerSchema: z.ZodType<DocumentOutline> = z
  .unknown()
  .transform(wireToOutlineInput)
  .pipe(DocumentOutlineSchema)
