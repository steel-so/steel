import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type { CanvasNode, CanvasNodeId } from '@/src/lib/canvas/types'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'

/**
 * Text slots of a site tree: every piece of copy the AI may write, in
 * reading order. Generation, section creation and "Reescrever textos" all
 * work the same way — the structure comes from the catalog's presets and
 * the model only fills these slots — so the AI never builds nodes and a
 * slot value that does not fit its prop schema is simply not applied.
 */

/** Layer names whose text is real data (CRM products, testimonials, the
 * company name): never sent to the model, never rewritten. */
export const SITE_AI_FIXED_NAMES = new Set([
  'Logo',
  'Produto',
  'Descrição do produto',
  'Preço',
  'Depoimento',
  'Autor do depoimento',
  'Direitos',
])

export type SlotPath = Array<string | number>

export interface TextSlot {
  /** Short id the model answers with (`t1`, `t2`…). */
  id: string
  nodeId: CanvasNodeId
  /** Prop path (`['text']`, `['items', 2, 'text']`, `['image', 'alt']`). */
  path: SlotPath
  /** pt-BR role shown to the model (`Título h1`, `Botão`…). */
  role: string
  /** Current copy as plain text (sample copy of a preset). */
  current: string
  /** Character cap of the value. */
  max: number
  /** `site.text` HTML: the plain value becomes `<p>` paragraphs. */
  rich: boolean
  /** Several lines allowed (paragraph breaks, one feature per line). */
  multiline: boolean
  /** Layer name of the top-level section the slot belongs to. */
  section: string
}

type FieldSpec = Omit<TextSlot, 'id' | 'nodeId' | 'section' | 'current'> & {
  current: unknown
}

const TEXT_PRESET_ROLE: Record<string, [string, number]> = {
  overline: ['Sobretítulo (curto)', 40],
  lead: ['Parágrafo de destaque', 360],
  body: ['Parágrafo', 600],
  small: ['Texto pequeno', 200],
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
      )
    : []
}

function field(
  path: SlotPath,
  role: string,
  max: number,
  current: unknown,
  options: { rich?: boolean; multiline?: boolean } = {},
): FieldSpec {
  return {
    path,
    role,
    max,
    current,
    rich: options.rich ?? false,
    multiline: options.multiline ?? false,
  }
}

/** Copy fields of one node, by component type. */
function nodeFields(node: CanvasNode): FieldSpec[] {
  const props = node.props
  switch (node.type) {
    case SITE_TYPES.heading: {
      const level = str(props.level) || 'h2'
      return [
        field(
          ['text'],
          `Título ${level}`,
          level === 'h1' ? 90 : 140,
          props.text,
        ),
      ]
    }
    case SITE_TYPES.text: {
      const [role, max] =
        TEXT_PRESET_ROLE[str(props.preset)] ?? TEXT_PRESET_ROLE.body
      return [
        field(['html'], role, max, htmlToText(str(props.html)), {
          rich: true,
          multiline: max > 200,
        }),
      ]
    }
    case SITE_TYPES.button:
      return [field(['label'], 'Botão', 40, props.label)]
    case SITE_TYPES.list:
      return arr(props.items).map((item, index) =>
        field(['items', index, 'text'], 'Item de lista', 160, item.text),
      )
    case SITE_TYPES.accordionItem:
      return [field(['title'], 'Pergunta', 160, props.title)]
    case SITE_TYPES.tab:
      return [field(['label'], 'Nome da aba', 40, props.label)]
    case SITE_TYPES.image: {
      const image = (props.image ?? {}) as Record<string, unknown>
      const fields = [
        field(['image', 'alt'], 'Texto alternativo da imagem', 160, image.alt),
      ]
      if (str(props.caption)) {
        fields.push(field(['caption'], 'Legenda da imagem', 200, props.caption))
      }
      return fields
    }
    case SITE_TYPES.icon:
      // Decorative icons of cards; the model picks from SITE_ICON_NAMES.
      return [field(['name'], 'Ícone', 30, props.name)]
    case SITE_TYPES.form:
      return [
        field(['submitLabel'], 'Botão do formulário', 40, props.submitLabel),
        field(
          ['successMessage'],
          'Mensagem após o envio',
          200,
          props.successMessage,
        ),
      ]
    case SITE_TYPES.countdown:
      return [
        field(['expiredText'], 'Texto depois do prazo', 120, props.expiredText),
      ]
    case SITE_TYPES.pricing:
      return arr(props.plans).flatMap((plan, index) => {
        const at = (key: string): SlotPath => ['plans', index, key]
        const fields = [
          field(at('name'), 'Plano: nome', 40, plan.name),
          field(at('price'), 'Plano: preço', 30, plan.price),
        ]
        if (str(plan.period)) {
          fields.push(field(at('period'), 'Plano: período', 30, plan.period))
        }
        if (str(plan.description)) {
          fields.push(
            field(at('description'), 'Plano: descrição', 160, plan.description),
          )
        }
        fields.push(
          field(
            at('features'),
            'Plano: recursos (um por linha)',
            600,
            plan.features,
            { multiline: true },
          ),
        )
        if (str(plan.badge)) {
          fields.push(field(at('badge'), 'Plano: selo', 30, plan.badge))
        }
        fields.push(
          field(at('buttonLabel'), 'Plano: botão', 40, plan.buttonLabel),
        )
        return fields
      })
    default:
      return []
  }
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** Visible text of a rich-text value; paragraphs become blank lines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6])>\s*/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Plain text (paragraphs split by blank lines) as `<p>` HTML. */
export function textToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`,
    )
    .join('')
}

/** Cuts at the last word boundary before `max` (no ellipsis). */
function cap(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(
    /[\s,;:–—-]+$/,
    '',
  )
}

/**
 * The model's text ready for the slot: quotes, markdown and tags stripped,
 * one line unless the slot is multiline, capped. `null` when nothing is
 * left (the slot keeps its current value).
 */
export function fitSlotText(value: unknown, slot: TextSlot): string | null {
  if (typeof value !== 'string') return null
  let text = value
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .trim()
    .replace(/^["“”']([\s\S]*)["“”']$/, '$1')
    .trim()
  text = slot.multiline
    ? text
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ')
  text = cap(text.trim(), slot.max)
  return text || null
}

/** Alt texts and icon names: not copy, left alone by a rewrite. */
export function isVisualSlot(path: SlotPath): boolean {
  const last = path.at(-1)
  return last === 'alt' || (path.length === 1 && last === 'name')
}

export interface CollectSlotsOptions {
  /** Only these nodes and their descendants (empty = everything). */
  within?: CanvasNodeId[]
  /** Copy only: skip image alt texts and icons (page rewrite). */
  textOnly?: boolean
}

/** Every slot under `rootId`, depth first (reading order). */
export function collectSlots(
  tree: { rootId: CanvasNodeId; nodes: Record<CanvasNodeId, CanvasNode> },
  options: CollectSlotsOptions = {},
): TextSlot[] {
  const slots: TextSlot[] = []
  const within = new Set(options.within ?? [])
  const root = tree.nodes[tree.rootId]
  const visit = (
    id: CanvasNodeId,
    section: string,
    inside: boolean,
    depth: number,
  ) => {
    const node = tree.nodes[id]
    if (!node || node.meta?.hidden) return
    if (node.meta?.name && SITE_AI_FIXED_NAMES.has(node.meta.name)) return
    const included = inside || within.size === 0 || within.has(id)
    const label =
      depth === sectionDepth
        ? (node.meta?.name ??
          siteCatalog.components[node.type]?.label ??
          node.type)
        : section
    if (included) {
      for (const spec of nodeFields(node)) {
        if (options.textOnly && isVisualSlot(spec.path)) continue
        slots.push({
          ...spec,
          current: typeof spec.current === 'string' ? spec.current : '',
          id: `t${slots.length + 1}`,
          nodeId: id,
          section: label,
        })
      }
    }
    for (const child of node.children ?? []) {
      visit(child, label, included && within.size > 0, depth + 1)
    }
  }
  // Page documents hold sections under the root; a fragment is a section.
  const sectionDepth = root?.type === SITE_TYPES.page ? 1 : 0
  if (root) visit(root.id, '', false, 0)
  return slots
}

function setPath(target: unknown, path: SlotPath, value: unknown): boolean {
  let cursor = target as Record<string | number, unknown>
  for (const key of path.slice(0, -1)) {
    const next = cursor?.[key]
    if (typeof next !== 'object' || next === null) return false
    cursor = next as Record<string | number, unknown>
  }
  cursor[path.at(-1) as string | number] = value
  return true
}

export interface AppliedSlots {
  /** Updated copies of the changed nodes, by id. */
  nodes: Record<CanvasNodeId, CanvasNode>
  /** Slot ids whose value was written. */
  applied: string[]
  /** Slot ids the model left out or whose value did not fit. */
  skipped: string[]
}

/**
 * Writes `values` (slot id → text) into copies of the nodes. A node whose
 * props stop matching its schema keeps its original props (all of its
 * slots count as skipped).
 */
export function applySlots(
  nodes: Record<CanvasNodeId, CanvasNode>,
  slots: TextSlot[],
  values: Map<string, string>,
  catalog: CanvasCatalog = siteCatalog,
): AppliedSlots {
  const byNode = new Map<CanvasNodeId, TextSlot[]>()
  for (const slot of slots) {
    byNode.set(slot.nodeId, [...(byNode.get(slot.nodeId) ?? []), slot])
  }
  const out: Record<CanvasNodeId, CanvasNode> = {}
  const applied: string[] = []
  const skipped: string[] = []
  for (const [nodeId, nodeSlots] of byNode) {
    const node = nodes[nodeId]
    const props = structuredClone(node.props)
    const written: string[] = []
    for (const slot of nodeSlots) {
      const text = fitSlotText(values.get(slot.id), slot)
      if (
        text === null ||
        !setPath(props, slot.path, slot.rich ? textToHtml(text) : text)
      ) {
        skipped.push(slot.id)
        continue
      }
      written.push(slot.id)
    }
    if (written.length === 0) continue
    const definition = catalog.components[node.type]
    if (!definition?.propsSchema.safeParse(props).success) {
      skipped.push(...written)
      continue
    }
    out[nodeId] = { ...node, props }
    applied.push(...written)
  }
  return { nodes: out, applied, skipped }
}
