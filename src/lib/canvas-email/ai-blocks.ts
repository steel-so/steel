import { createId } from '@paralleldrive/cuid2'
import { z } from 'zod'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type {
  CanvasFragment,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { sanitizeRichText } from '@/src/lib/crm-email-builder/rich-text'
import {
  CAMPAIGN_LINK,
  escapeHtml,
} from '@/src/lib/crm-email-builder/variables'
import { err, type Result } from '@/src/lib/result'
import { isEmailBuilderLink } from '@/src/schemas/crm-email-builder.schema'
import { emailCatalog } from './catalog'
import { COLUMN, SECTION } from './components/layout'
import { type ValidatedEmailFragment, validateEmailFragment } from './fragments'

/**
 * AI on e-mail blocks (E3): which text of each block the AI may write or
 * rewrite, and the conversion of a generated section — a small JSON spec
 * the model fills — into catalog nodes. Every node is built from the
 * component's default props and checked by its props schema; invalid
 * blocks are dropped and the result goes through the full fragment
 * validation, so the editor never receives an invalid node.
 */

// ─── text fields ──────────────────────────────────────────────────────────

export type EmailAiField = {
  /** Prop path the AI writes. */
  path: string
  /** pt-BR name of the field, for the prompt and the UI. */
  label: string
  maxLength: number
  /** Rich text (`email.text`): HTML with the inline subset. */
  rich: boolean
}

/** Blocks with a text the AI can write, by type. */
export const EMAIL_AI_FIELDS: Record<string, EmailAiField> = {
  'email.heading': {
    path: 'text',
    label: 'Título',
    maxLength: 300,
    rich: false,
  },
  'email.text': {
    path: 'html',
    label: 'Texto',
    maxLength: 6000,
    rich: true,
  },
  'email.button': {
    path: 'label',
    label: 'Texto do botão',
    maxLength: 80,
    rich: false,
  },
  'email.quote': {
    path: 'text',
    label: 'Depoimento',
    maxLength: 600,
    rich: false,
  },
  'email.coupon': {
    path: 'label',
    label: 'Chamada do cupom',
    maxLength: 120,
    rich: false,
  },
  'email.event': {
    path: 'heading',
    label: 'Título do evento',
    maxLength: 200,
    rich: false,
  },
  'email.nps': {
    path: 'question',
    label: 'Pergunta',
    maxLength: 200,
    rich: false,
  },
  'email.product': {
    path: 'description',
    label: 'Descrição do produto',
    maxLength: 300,
    rich: false,
  },
}

export const EMAIL_AI_MODES = [
  'write',
  'shorter',
  'persuasive',
  'formal',
] as const
export type EmailAiMode = (typeof EMAIL_AI_MODES)[number]

export const EMAIL_AI_MODE_LABELS: Record<EmailAiMode, string> = {
  write: 'Escrever com IA',
  shorter: 'Mais curto',
  persuasive: 'Mais persuasivo',
  formal: 'Mais formal',
}

/** The AI's text ready for the field: plain fields on one line and inside
 * the cap; rich fields sanitized to the inline subset. `null` when empty. */
export function fitAiText(value: string, field: EmailAiField): string | null {
  let text = value
    .trim()
    .replace(/^["“]([\s\S]*)["”]$/, '$1')
    .trim()
  if (field.rich) {
    if (!/<\/?(p|ul|ol|li|br|strong|em|u|s|a)\b/i.test(text)) {
      text = plainToParagraphs(text)
    }
    text = sanitizeRichText(text)
    if (!text.replace(/<[^>]+>/g, '').trim()) return null
    return text.length > field.maxLength ? null : text
  }
  text = text
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .slice(0, field.maxLength)
    .trimEnd()
  return text || null
}

/** Plain text (paragraphs split by blank lines) as `<p>` HTML. */
export function plainToParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`,
    )
    .join('')
}

// ─── generated sections ──────────────────────────────────────────────────

export const EMAIL_AI_BLOCK_KINDS = [
  'heading',
  'text',
  'button',
  'list',
  'quote',
  'coupon',
  'divider',
  'product',
] as const

const AiBlockSchema = z.object({
  type: z.enum(EMAIL_AI_BLOCK_KINDS),
  /** Heading/text/quote/coupon copy or the button label. */
  text: z.string(),
  level: z.enum(['h1', 'h2', 'h3']),
  items: z.array(z.object({ title: z.string(), text: z.string() })),
  url: z.string(),
  author: z.string(),
  role: z.string(),
  code: z.string(),
})
export type EmailAiBlockSpec = z.infer<typeof AiBlockSchema>

export const EmailAiSectionOutputSchema = z.object({
  reply: z.string(),
  section: z.object({
    background: z.enum(['none', 'soft']),
    columns: z
      .array(z.object({ blocks: z.array(AiBlockSchema) }))
      .min(1)
      .max(3),
  }),
})
export type EmailAiSectionOutput = z.infer<typeof EmailAiSectionOutputSchema>

const STRING = { type: 'string' }

/** Strict JSON schema of the section spec (every key required; unused
 * keys come back empty). */
export const EMAIL_AI_SECTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'section'],
  properties: {
    reply: STRING,
    section: {
      type: 'object',
      additionalProperties: false,
      required: ['background', 'columns'],
      properties: {
        background: { type: 'string', enum: ['none', 'soft'] },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['blocks'],
            properties: {
              blocks: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'type',
                    'text',
                    'level',
                    'items',
                    'url',
                    'author',
                    'role',
                    'code',
                  ],
                  properties: {
                    type: { type: 'string', enum: [...EMAIL_AI_BLOCK_KINDS] },
                    text: STRING,
                    level: { type: 'string', enum: ['h1', 'h2', 'h3'] },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['title', 'text'],
                        properties: { title: STRING, text: STRING },
                      },
                    },
                    url: STRING,
                    author: STRING,
                    role: STRING,
                    code: STRING,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

/** Most blocks a generated section keeps (per column). */
const MAX_BLOCKS_PER_COLUMN = 8

function cap(value: string, max: number): string {
  return value.trim().slice(0, max).trimEnd()
}

function linkOf(url: string) {
  const value = url.trim()
  return {
    type: 'url' as const,
    value: value && isEmailBuilderLink(value) ? value : CAMPAIGN_LINK,
  }
}

/** Props overrides of one spec block (`null` = nothing usable). */
function blockProps(
  spec: EmailAiBlockSpec,
  productId: string | null,
): Record<string, unknown> | null {
  const text = spec.text.trim()
  switch (spec.type) {
    case 'heading':
      return text ? { text: cap(text, 300), level: spec.level } : null
    case 'text': {
      const html = fitAiText(text, EMAIL_AI_FIELDS['email.text'])
      return html ? { html } : null
    }
    case 'button':
      return text ? { label: cap(text, 80), link: linkOf(spec.url) } : null
    case 'list': {
      const items = spec.items
        .map((item) => ({
          title: cap(item.title, 160),
          text: cap(item.text, 400),
        }))
        .filter((item) => item.title || item.text)
        .slice(0, 20)
      return items.length > 0 ? { items } : null
    }
    case 'quote':
      return text
        ? {
            text: cap(text, 600),
            author: cap(spec.author, 120),
            role: cap(spec.role, 120),
          }
        : null
    case 'coupon':
      return spec.code.trim()
        ? {
            code: cap(spec.code, 40).toUpperCase(),
            label: cap(text, 120),
            expiry: '',
          }
        : null
    case 'divider':
      return {}
    default:
      // A product block only makes sense with the product the user picked.
      return productId ? { productId } : null
  }
}

/** One catalog node from a spec block, or `null` when invalid. */
function buildBlock(
  spec: EmailAiBlockSpec,
  catalog: CanvasCatalog,
  productId: string | null,
): CanvasNode | null {
  const definition = catalog.components[`email.${spec.type}`]
  const overrides = blockProps(spec, productId)
  if (!definition || !overrides) return null
  const props = { ...definition.defaultProps(), ...overrides }
  if (!definition.propsSchema.safeParse(props).success) return null
  return { id: createId(), type: definition.type, props }
}

/**
 * The section the AI described, as a validated fragment (fresh ids).
 * Invalid or empty blocks are dropped; an empty result is an error.
 */
export function buildAiSection(
  spec: EmailAiSectionOutput['section'],
  options: { productId?: string | null; catalog?: CanvasCatalog } = {},
): Result<ValidatedEmailFragment, string[]> {
  const catalog = options.catalog ?? emailCatalog
  const nodes: Record<CanvasNodeId, CanvasNode> = {}
  const filled: CanvasNodeId[][] = []
  for (const column of spec.columns) {
    const blocks: CanvasNodeId[] = []
    for (const block of column.blocks.slice(0, MAX_BLOCKS_PER_COLUMN)) {
      const node = buildBlock(block, catalog, options.productId ?? null)
      if (!node) continue
      nodes[node.id] = node
      blocks.push(node.id)
    }
    if (blocks.length > 0) filled.push(blocks)
  }
  const gutter = filled.length > 1 ? 8 : 0
  const columns = filled.map((blocks) => {
    const id = createId()
    nodes[id] = {
      id,
      type: COLUMN,
      props: {
        ...catalog.components[COLUMN].defaultProps(),
        padding: { top: 0, right: gutter, bottom: 0, left: gutter },
      },
      children: blocks,
    }
    return id
  })
  if (columns.length === 0) {
    return err([
      'A IA não gerou nenhum bloco aproveitável — tente outro pedido',
    ])
  }
  const rootId = createId()
  nodes[rootId] = {
    id: rootId,
    type: SECTION,
    props: {
      ...catalog.components[SECTION].defaultProps(),
      ...(spec.background === 'soft'
        ? {
            background: { kind: 'color', color: 'token:primary-soft' },
            padding: { top: 24, right: 40, bottom: 24, left: 40 },
          }
        : {}),
    },
    children: columns,
  }
  const fragment: CanvasFragment = { rootId, nodes }
  return validateEmailFragment(fragment, catalog)
}
