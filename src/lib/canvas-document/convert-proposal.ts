import {
  type CrmProposalSectionContent,
  CrmProposalSectionContentSchema,
  type CrmProposalSectionType,
} from '@/src/schemas/crm-proposal.schema'
import type { DocumentPricingItem } from './context'
import {
  type DocumentOutline,
  type DocumentOutlineBlock,
  type DocumentOutlineLeafBlock,
  type DocumentOutlineSection,
  type OutlineToDocumentResult,
  outlineToDocument,
} from './outline'

/**
 * Legacy CRM proposal (nine fixed-layout sections) → document outline
 * (ADR 0063, docs/documents/README.md "Migração das propostas"). Used by the
 * `documents-legacy-import` worker and by the on-the-fly conversion behind
 * the `/crm/proposals/*` and `/p/<token>` redirects. Pure: no I/O.
 */

/** A stored section: proposal `content` or template `defaultContent`. */
export interface LegacyProposalSection {
  type: CrmProposalSectionType
  order: number
  enabled: boolean
  /** Raw JSON from the database; invalid or empty content is skipped. */
  content: unknown
}

export interface LegacyProposalInput {
  title: string
  sections: LegacyProposalSection[]
  /** Template logo (`CrmProposalTemplate.logoUrl`), becomes the theme logo. */
  logoUrl?: string | null
  /** The proposal has a validity date: a `validity` block joins the accept. */
  hasValidity?: boolean
  /**
   * Append an accept section when the signature section is absent or off.
   * The legacy public page always offered "Aceitar proposta", whatever the
   * sections, so migrated proposals keep that ability. Default: true.
   */
  ensureAccept?: boolean
}

/** Section names, as the legacy builder labelled them. */
export const LEGACY_SECTION_NAMES: Record<CrmProposalSectionType, string> = {
  COVER: 'Capa',
  COMPANY_PRESENTATION: 'Apresentação da empresa',
  CLIENT_NEEDS: 'Necessidade do cliente',
  SOLUTION: 'Solução da proposta',
  SCOPE: 'Escopo dos serviços',
  PRODUCTS_PRICING: 'Produtos e valores',
  COMMERCIAL_TERMS: 'Condições comerciais',
  TERMS_CONDITIONS: 'Termos e condições',
  SIGNATURE: 'Aceite',
}

const SECTION_RANK: Record<CrmProposalSectionType, number> = {
  COVER: 0,
  COMPANY_PRESENTATION: 1,
  CLIENT_NEEDS: 2,
  SOLUTION: 3,
  SCOPE: 4,
  PRODUCTS_PRICING: 5,
  COMMERCIAL_TERMS: 6,
  TERMS_CONDITIONS: 7,
  SIGNATURE: 8,
}

export const ACCEPT_BUTTON_LABEL = 'Aceitar proposta'

// Outline limits (see `outline.ts`).
const SHORT = 500
const URL_MAX = 2000
const HTML_MAX = 20_000
const CELL_MAX = 1000
const TITLE_MAX = 200
const PRICING_CHUNK = 100
/** Above this many items a list is denser than heading + text per item. */
const ITEM_BLOCKS_MAX = 39
const IMAGES_PER_ROW = 3

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Plain text (as typed in the legacy textareas, rendered `pre-wrap`) →
 * inline HTML: blank lines split paragraphs, single newlines become `<br>`.
 */
export function plainTextToHtml(text: string): string {
  return text
    .replaceAll('\r\n', '\n')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => escapeHtml(part).replaceAll('\n', '<br>'))
    .map((part) => `<p>${part}</p>`)
    .join('')
}

/** Text blocks for a long text, split by paragraph under the HTML limit. */
function textBlocks(text: string | undefined): DocumentOutlineLeafBlock[] {
  if (!text?.trim()) return []
  const paragraphs = plainTextToHtml(text).split(/(?=<p>)/)
  const blocks: DocumentOutlineLeafBlock[] = []
  let current = ''
  for (const part of paragraphs) {
    const piece = clip(part, HTML_MAX)
    if (current && current.length + piece.length > HTML_MAX) {
      blocks.push({ type: 'text', html: current })
      current = ''
    }
    current += piece
  }
  if (current) blocks.push({ type: 'text', html: current })
  return blocks
}

function heading(text: string, level: 1 | 2 | 3 = 2): DocumentOutlineLeafBlock {
  return { type: 'heading', text: clip(text, SHORT), level }
}

function imageBlock(src: string): DocumentOutlineLeafBlock {
  return { type: 'image', src: clip(src, URL_MAX), alt: '' }
}

/** Images in rows of up to three columns; a lone image stays full width. */
function imageBlocks(urls: string[]): DocumentOutlineBlock[] {
  const blocks: DocumentOutlineBlock[] = []
  for (let i = 0; i < urls.length; i += IMAGES_PER_ROW) {
    const row = urls.slice(i, i + IMAGES_PER_ROW)
    if (row.length === 1) {
      blocks.push(imageBlock(row[0] as string))
    } else {
      blocks.push({
        type: 'columns',
        columns: row.map((url) => [imageBlock(url)]),
      })
    }
  }
  return blocks
}

type ListItem = { title: string; description: string }

/** Needs/scope items: heading + text each, or one list when they're many. */
function itemBlocks(items: ListItem[]): DocumentOutlineLeafBlock[] {
  const described = items.some((item) => item.description.trim())
  if (!described) {
    const titles = items.map((item) => clip(item.title, URL_MAX))
    return [{ type: 'list', items: titles }]
  }
  if (items.length > ITEM_BLOCKS_MAX) {
    return [
      {
        type: 'list',
        items: items.map((item) =>
          clip(
            item.description.trim()
              ? `${item.title} — ${item.description.trim()}`
              : item.title,
            URL_MAX,
          ),
        ),
      },
    ]
  }
  return items.flatMap((item) => [
    heading(item.title, 3),
    ...textBlocks(item.description),
  ])
}

type PricingContent = Extract<
  CrmProposalSectionContent,
  { type: 'PRODUCTS_PRICING' }
>

/**
 * Legacy lines → pricing items. The legacy discount is an absolute amount
 * on the subtotal; it becomes the same percentage on every line, so the
 * document total matches the legacy total (to the cent, up to rounding).
 */
export function legacyPricingItems(
  content: PricingContent,
): DocumentPricingItem[] {
  const subtotal = content.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  )
  const discountPct =
    content.discount > 0 && subtotal > 0
      ? Math.min(100, (content.discount / subtotal) * 100)
      : 0
  return content.items.map((item, index) => ({
    id: `item-${index + 1}`,
    name: clip(item.name, TITLE_MAX),
    ...(item.description ? { description: item.description } : {}),
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    ...(discountPct > 0 ? { discountPct } : {}),
  }))
}

function pricingBlocks(content: PricingContent): DocumentOutlineLeafBlock[] {
  return pricingChunks(legacyPricingItems(content))
}

/** Pricing blocks of up to 100 lines; only the last one shows the totals. */
function pricingChunks(
  items: DocumentPricingItem[],
): DocumentOutlineLeafBlock[] {
  const blocks: DocumentOutlineLeafBlock[] = []
  for (let i = 0; i < items.length; i += PRICING_CHUNK) {
    const last = i + PRICING_CHUNK >= items.length
    blocks.push({
      type: 'pricing',
      items: items.slice(i, i + PRICING_CHUNK),
      showTotals: last,
    })
  }
  return blocks
}

type CommercialContent = Extract<
  CrmProposalSectionContent,
  { type: 'COMMERCIAL_TERMS' }
>

/** Short terms read best as a two-column table; long ones as text. */
function commercialBlocks(
  content: CommercialContent,
): DocumentOutlineLeafBlock[] {
  const rows: [string, string][] = []
  const candidates: [string, string | undefined][] = [
    ['Pagamento', content.paymentTerms],
    ['Entrega', content.deliveryTerms],
    ['Observações', content.notes],
  ]
  for (const [label, value] of candidates) {
    if (value?.trim()) rows.push([label, value.trim()])
  }

  const fitsTable = rows.every(([, value]) => value.length <= CELL_MAX)
  if (fitsTable) return [{ type: 'table', rows }]
  return rows.flatMap(([label, value]) => [
    heading(label, 3),
    ...textBlocks(value),
  ])
}

function acceptBlock(): DocumentOutlineLeafBlock {
  return {
    type: 'accept',
    buttonLabel: ACCEPT_BUTTON_LABEL,
    allowDecline: true,
  }
}

function paragraph(text: string): DocumentOutlineLeafBlock {
  return { type: 'text', html: `<p>${text}</p>` }
}

function acceptSection(
  hasValidity: boolean,
  intro: DocumentOutlineLeafBlock[] = [],
): DocumentOutlineSection {
  const validity: DocumentOutlineLeafBlock[] = hasValidity
    ? [{ type: 'validity' }]
    : []
  // No heading: the catalog's accept card brings its own title.
  return {
    name: LEGACY_SECTION_NAMES.SIGNATURE,
    blocks: [...intro, ...validity, acceptBlock()],
  }
}

function sectionFor(
  content: CrmProposalSectionContent,
  hasValidity: boolean,
): DocumentOutlineSection {
  const name = LEGACY_SECTION_NAMES[content.type]
  switch (content.type) {
    case 'COVER': {
      const blocks: DocumentOutlineLeafBlock[] = []
      if (content.coverImageUrl) blocks.push(imageBlock(content.coverImageUrl))
      blocks.push(heading(content.title, 1))
      const subtitle = content.subtitle?.trim()
      if (subtitle) blocks.push(paragraph(escapeHtml(subtitle)))
      return { name, variant: 'cover', blocks }
    }
    case 'COMPANY_PRESENTATION':
      return {
        name,
        blocks: [
          heading(content.headline?.trim() || name),
          ...textBlocks(content.description),
          ...imageBlocks(content.imageUrls),
        ],
      }
    case 'SOLUTION':
      return {
        name,
        blocks: [
          heading(name),
          ...textBlocks(content.description),
          ...imageBlocks(content.imageUrls),
        ],
      }
    case 'CLIENT_NEEDS':
    case 'SCOPE':
      return { name, blocks: [heading(name), ...itemBlocks(content.items)] }
    case 'PRODUCTS_PRICING':
      return { name, blocks: [heading(name), ...pricingBlocks(content)] }
    case 'COMMERCIAL_TERMS':
      return { name, blocks: [heading(name), ...commercialBlocks(content)] }
    case 'TERMS_CONDITIONS':
      return { name, blocks: [heading(name), ...textBlocks(content.text)] }
    case 'SIGNATURE': {
      const signer = [
        content.companySignerName.trim(),
        content.companySignerRole?.trim(),
      ]
        .filter(Boolean)
        .join(' — ')
      const strong = `<strong>${escapeHtml(signer)}</strong>`
      const intro = signer ? [paragraph(`Responsável: ${strong}`)] : []
      return acceptSection(hasValidity, intro)
    }
  }
}

/** Parses a stored section; `null` when disabled, empty or not valid. */
function parseSection(
  section: LegacyProposalSection,
): CrmProposalSectionContent | null {
  if (!section.enabled || section.content == null) return null
  const parsed = CrmProposalSectionContentSchema.safeParse(section.content)
  if (!parsed.success || parsed.data.type !== section.type) return null
  return parsed.data
}

export function proposalToOutline(input: LegacyProposalInput): DocumentOutline {
  const hasValidity = input.hasValidity === true
  const ordered = [...input.sections].sort(
    (a, b) => a.order - b.order || SECTION_RANK[a.type] - SECTION_RANK[b.type],
  )

  const sections: DocumentOutlineSection[] = []
  for (const section of ordered) {
    const content = parseSection(section)
    if (!content) continue
    sections.push(sectionFor(content, hasValidity))
  }

  const title = clip(input.title.trim() || 'Proposta', TITLE_MAX)
  const hasAccept = sections.some((s) =>
    s.blocks.some((b) => b.type === 'accept'),
  )
  if (!hasAccept && input.ensureAccept !== false) {
    sections.push(acceptSection(hasValidity))
  }
  if (sections.length === 0) {
    sections.push({ name: 'Proposta', blocks: [heading(title, 1)] })
  }

  const logoUrl = input.logoUrl?.trim()
  return {
    title,
    kind: 'PROPOSAL',
    sections,
    ...(logoUrl ? { theme: { logoUrl: clip(logoUrl, URL_MAX) } } : {}),
  }
}

/** Legacy proposal/template → canvas document of the `document` catalog. */
export function convertLegacyProposal(
  input: LegacyProposalInput,
): OutlineToDocumentResult & { outline: DocumentOutline } {
  const outline = proposalToOutline(input)
  return { ...outlineToDocument(outline), outline }
}

export interface NewProposalInput {
  title: string
  /** Company, person or lead the proposal is for (cover subtitle). */
  clientName?: string | null
  /** Pricing lines, e.g. the opportunity line items. */
  items?: DocumentPricingItem[]
  hasValidity?: boolean
}

/**
 * Starting point of a proposal created from the CRM (lead pipeline,
 * opportunity, renewal, Steel AI) without a template: a cover, the pricing
 * table when there are lines, and the accept section.
 */
export function newProposalOutline(input: NewProposalInput): DocumentOutline {
  const title = clip(input.title.trim() || 'Proposta', TITLE_MAX)
  const cover: DocumentOutlineLeafBlock[] = [heading(title, 1)]
  const client = input.clientName?.trim()
  if (client) cover.push(paragraph(`Preparada para ${escapeHtml(client)}`))

  const sections: DocumentOutlineSection[] = [
    { name: LEGACY_SECTION_NAMES.COVER, variant: 'cover', blocks: cover },
  ]
  const items = input.items ?? []
  if (items.length > 0) {
    sections.push({
      name: LEGACY_SECTION_NAMES.PRODUCTS_PRICING,
      blocks: [
        heading(LEGACY_SECTION_NAMES.PRODUCTS_PRICING),
        ...pricingChunks(items),
      ],
    })
  }
  sections.push(acceptSection(input.hasValidity === true))
  return { title, kind: 'PROPOSAL', sections }
}

/** New proposal → canvas document of the `document` catalog. */
export function buildNewProposal(
  input: NewProposalInput,
): OutlineToDocumentResult {
  return outlineToDocument(newProposalOutline(input))
}
