import type { CanvasDocument } from '@/src/lib/canvas/types'
import { getSiteTemplate } from '@/src/lib/canvas-site/presets'
import { toDocument } from '@/src/lib/canvas-site/presets/builder'
import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import {
  SECTION_BUILDERS,
  type SiteSectionType,
} from '@/src/lib/canvas-site/presets/sections'
import type { SiteTheme } from '@/src/lib/canvas-site/theme'

/**
 * A new site built from one of the catalog's full-page templates: the
 * template's theme, its body sections as the home page and its header and
 * footer sections as the site's globals, so they repeat on every page the
 * user adds later (Wix/WordPress behaviour).
 */
export interface SiteTemplateBuild {
  theme: SiteTheme
  home: CanvasDocument
  header: CanvasDocument | null
  footer: CanvasDocument | null
}

const GLOBAL_SECTIONS: SiteSectionType[] = ['header', 'footer']

export function buildSiteFromTemplate(
  templateId: string,
): SiteTemplateBuild | null {
  const template = getSiteTemplate(templateId)
  if (!template) return null
  const kit = SITE_KITS[template.kit]
  const body = template.sections.filter(
    (type) => !GLOBAL_SECTIONS.includes(type),
  )
  // Globals render around the page's `<main>`, so their root is a `div`.
  const global = (type: SiteSectionType) =>
    template.sections.includes(type)
      ? toDocument([SECTION_BUILDERS[type](kit)], { tag: 'div' })
      : null
  return {
    theme: template.theme(),
    home: toDocument(body.map((type) => SECTION_BUILDERS[type](kit))),
    header: global('header'),
    footer: global('footer'),
  }
}

/** A blank header/footer global: one section of the kit's style, or an
 * empty `div` root when no style is asked for. */
export function buildSiteGlobal(
  kind: 'HEADER' | 'FOOTER',
  kitId?: keyof typeof SITE_KITS,
): CanvasDocument {
  if (!kitId) return toDocument([], { tag: 'div' })
  const type: SiteSectionType = kind === 'HEADER' ? 'header' : 'footer'
  return toDocument([SECTION_BUILDERS[type](SITE_KITS[kitId])], { tag: 'div' })
}
