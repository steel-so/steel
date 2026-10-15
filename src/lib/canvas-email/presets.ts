import { cloneFragment } from '@/src/lib/canvas/ops'
import type { CanvasDocument, CanvasFragment } from '@/src/lib/canvas/types'
import { spacing } from '@/src/lib/canvas/values'
import {
  EMAIL_LAYOUT_LIST,
  SECTION_TYPE_LABEL,
} from '@/src/lib/crm-email-builder/layouts'
import type {
  EmailBuilderLayoutId,
  EmailBuilderSectionType,
} from '@/src/schemas/crm-email-builder.schema'
import {
  COLUMN,
  defaultColumnProps,
  defaultSectionProps,
  SECTION,
} from './components/layout'
import { convertSection, createEmailDocumentFromLayout } from './convert-v1'

/**
 * "Seções prontas" of the e-mail editor and the starting documents of the
 * gallery, converted from the v1 layouts. Same shape as the shell's
 * `CanvasPresetItem` (each call of `fragment()` returns fresh ids).
 */

export type EmailPreset = {
  id: string
  label: string
  category: string
  fragment: () => CanvasFragment
}

function columnsFragment(count: number): CanvasFragment {
  const columns = Array.from({ length: count }, (_, i) => `c${i}`)
  const gutter = count > 1 ? 8 : 0
  const nodes: CanvasFragment['nodes'] = {
    s: {
      id: 's',
      type: SECTION,
      props: defaultSectionProps(),
      children: columns,
    },
  }
  for (const id of columns) {
    nodes[id] = {
      id,
      type: COLUMN,
      props: { ...defaultColumnProps(), padding: spacing(0, gutter) },
      children: [],
    }
  }
  return { rootId: 's', nodes }
}

const LAYOUT_PRESETS: EmailPreset[] = [1, 2, 3, 4].map((count) => ({
  id: `columns-${count}`,
  label: count === 1 ? '1 coluna' : `${count} colunas`,
  category: 'Layout',
  fragment: () => cloneFragment(columnsFragment(count)),
}))

const SECTION_CATEGORY: Record<
  Exclude<EmailBuilderSectionType, 'footer'>,
  string
> = {
  header: 'Cabeçalho',
  hero: 'Conteúdo',
  text: 'Conteúdo',
  image: 'Conteúdo',
  button: 'Conteúdo',
  features: 'Conteúdo',
  products: 'Vendas',
  coupon: 'Vendas',
  event: 'Relacionamento',
  nps: 'Relacionamento',
  quote: 'Relacionamento',
  signature: 'Relacionamento',
}

/** One preset per v1 section type, from the first layout that has it. */
function sectionPresets(): EmailPreset[] {
  const seen = new Set<string>()
  const presets: EmailPreset[] = []
  for (const layout of EMAIL_LAYOUT_LIST) {
    for (const { section } of layout.sections) {
      if (section.type === 'footer' || seen.has(section.type)) continue
      seen.add(section.type)
      const source = structuredClone({ ...section, hidden: false })
      presets.push({
        id: `section-${section.type}`,
        label: SECTION_TYPE_LABEL[section.type],
        category: SECTION_CATEGORY[section.type],
        fragment: () => cloneFragment(convertSection(source, 'preset')),
      })
    }
  }
  return presets
}

export const EMAIL_PRESET_CATEGORIES = [
  'Layout',
  'Cabeçalho',
  'Conteúdo',
  'Vendas',
  'Relacionamento',
] as const

export const EMAIL_PRESETS: readonly EmailPreset[] = [
  ...LAYOUT_PRESETS,
  ...sectionPresets(),
]

/** Starting documents of the new-template gallery (one per v1 layout). */
export type EmailStarter = {
  id: EmailBuilderLayoutId
  label: string
  description: string
  category: string
  defaultSubject: string
  document: () => CanvasDocument
}

export const EMAIL_STARTERS: readonly EmailStarter[] = EMAIL_LAYOUT_LIST.map(
  (layout) => ({
    id: layout.id,
    label: layout.label,
    description: layout.description,
    category: layout.category,
    defaultSubject: layout.defaultSubject,
    document: () => createEmailDocumentFromLayout(layout.id),
  }),
)
