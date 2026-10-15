import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  type NodeSpec,
  section,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import type { SearchPageInput } from '@/src/lib/sites/search/types'
import {
  DEFAULT_SITE_SETTINGS,
  type SiteSettingsDTO,
} from '@/src/schemas/site.schema'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'

/** A page document with one section holding `children`. */
export function searchDocument(...children: NodeSpec[]): CanvasDocument {
  return toDocument([section({}, children)])
}

/** `n` words of filler text (no digits, so no "facts"). */
export function words(n: number, word = 'texto'): string {
  return Array.from({ length: n }, () => word).join(' ')
}

export function searchSettings(
  overrides: Partial<SiteSettingsDTO> = {},
): SiteSettingsDTO {
  return { ...DEFAULT_SITE_SETTINGS, ...overrides }
}

/** Input of `analyzeSearchPage` with sensible defaults. */
export function searchInput(
  overrides: {
    document?: CanvasDocument
    seo?: SitePageSeoDTO
    settings?: SiteSettingsDTO
    title?: string
    slug?: string
    isHome?: boolean
    updatedAt?: string
    siblings?: SearchPageInput['siblings']
    chromeText?: string
    now?: Date
  } = {},
): SearchPageInput {
  return {
    page: {
      id: 'p1',
      title: overrides.title ?? 'Implante dentário em São Paulo',
      slug: overrides.slug ?? 'implante-dentario',
      isHome: overrides.isHome ?? false,
      seo: overrides.seo ?? {},
      updatedAt: overrides.updatedAt,
    },
    document: overrides.document ?? searchDocument(),
    site: {
      name: 'Clínica Sorriso',
      settings: overrides.settings ?? searchSettings(),
      pageUrl: 'https://clinica.sites.test/implante-dentario',
    },
    siblings: overrides.siblings ?? [],
    chromeText: overrides.chromeText,
    now: overrides.now ?? new Date('2026-10-15T12:00:00Z'),
  }
}
