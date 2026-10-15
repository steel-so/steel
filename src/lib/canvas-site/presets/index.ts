import { cloneFragment } from '@/src/lib/canvas/ops'
import type { CanvasDocument, CanvasFragment } from '@/src/lib/canvas/types'
import { columnsFragment } from '../components/layout'
import type { SiteTheme } from '../theme'
import { toDocument, toFragment } from './builder'
import { SITE_KITS, type SiteKitId } from './kits'
import {
  SECTION_BUILDERS,
  SITE_SECTION_LABELS,
  SITE_SECTION_TYPES,
  type SiteSectionType,
} from './sections'

/**
 * "Seções prontas" of the site editor (every section type in every kit,
 * plus layout blocks) and the full-page templates. Same shape as the
 * shell's `CanvasPresetItem`; each `fragment()` call returns fresh ids.
 */

export interface SitePreset {
  id: string
  label: string
  /** Sidebar group: the section type ("Destaque principal", "Rodapé"…). */
  category: string
  kit?: SiteKitId
  sectionType?: SiteSectionType
  thumbnail?: string
  fragment: () => CanvasFragment
}

const LAYOUT_PRESETS: SitePreset[] = [2, 3, 4].map((count) => ({
  id: `columns-${count}`,
  label: `${count} colunas`,
  category: 'Layout',
  fragment: () => cloneFragment(columnsFragment(count)),
}))

/** One preset per section type × kit, grouped by section type. */
export const SITE_SECTION_PRESETS: SitePreset[] = SITE_SECTION_TYPES.flatMap(
  (type) =>
    Object.values(SITE_KITS).map((kit) => ({
      id: `${type}-${kit.id}`,
      label: `${SITE_SECTION_LABELS[type]} · ${kit.label}`,
      category: SITE_SECTION_LABELS[type],
      kit: kit.id,
      sectionType: type,
      fragment: () => cloneFragment(toFragment(SECTION_BUILDERS[type](kit))),
    })),
)

export const SITE_PRESETS: SitePreset[] = [
  ...LAYOUT_PRESETS,
  ...SITE_SECTION_PRESETS,
]

/** Section preset of one type and kit (landing-page conversion). */
export function sectionPreset(
  type: SiteSectionType,
  kit: SiteKitId,
): SitePreset {
  return SITE_SECTION_PRESETS.find(
    (preset) => preset.sectionType === type && preset.kit === kit,
  ) as SitePreset
}

// ─── full-page templates ──────────────────────────────────────────────────

export interface SiteTemplate {
  id: string
  label: string
  description: string
  kit: SiteKitId
  sections: SiteSectionType[]
  /** Theme the template is designed with (a new site starts from it). */
  theme: () => SiteTheme
  /** The home page document (fresh object each call). */
  document: () => CanvasDocument
}

function template(
  id: string,
  label: string,
  description: string,
  kit: SiteKitId,
  sections: SiteSectionType[],
): SiteTemplate {
  return {
    id,
    label,
    description,
    kit,
    sections,
    theme: () => structuredClone(SITE_KITS[kit].theme),
    document: () =>
      toDocument(
        sections.map((type) => SECTION_BUILDERS[type](SITE_KITS[kit])),
      ),
  }
}

export const SITE_TEMPLATES: SiteTemplate[] = [
  template(
    'agencia',
    'Agência criativa',
    'Portfólio, serviços e depoimentos para estúdios e agências.',
    'agency',
    [
      'header',
      'hero',
      'logos',
      'services',
      'about',
      'facts',
      'works',
      'testimonial',
      'newsletter',
      'footer',
    ],
  ),
  template(
    'empresa',
    'Empresa B2B',
    'Apresentação institucional com números, depoimentos e contato.',
    'b2b',
    [
      'header',
      'hero',
      'logos',
      'services',
      'about',
      'facts',
      'testimonial',
      'faq',
      'newsletter',
      'footer',
    ],
  ),
  template(
    'saas',
    'Software e assinatura',
    'Recursos, passo a passo, planos e perguntas frequentes.',
    'saas',
    [
      'header',
      'hero',
      'logos',
      'features',
      'steps',
      'testimonial',
      'pricing',
      'faq',
      'newsletter',
      'footer',
    ],
  ),
  template(
    'consultoria',
    'Consultoria',
    'Serviços, método de trabalho e captação de contatos.',
    'b2b',
    [
      'header',
      'hero',
      'services',
      'steps',
      'about',
      'testimonial',
      'faq',
      'newsletter',
      'footer',
    ],
  ),
  template(
    'loja',
    'Vitrine de produtos',
    'Produtos em destaque, diferenciais e novidades por e-mail.',
    'agency',
    [
      'header',
      'hero',
      'products',
      'features',
      'testimonial',
      'newsletter',
      'footer',
    ],
  ),
]

export function getSiteTemplate(id: string): SiteTemplate | undefined {
  return SITE_TEMPLATES.find((item) => item.id === id)
}

export { SITE_KIT_IDS, SITE_KITS, type SiteKit, type SiteKitId } from './kits'
export {
  SECTION_BUILDERS,
  SITE_SECTION_LABELS,
  SITE_SECTION_TYPES,
  type SiteSectionType,
} from './sections'
