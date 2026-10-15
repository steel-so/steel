/**
 * Site catalog of Steel Canvas (phase S1). Public API for the site editor
 * (site-ui), the backend (validation, public runtime) and the landing-page
 * converter. See docs/canvas/README.md.
 */

export { createSiteCatalog, siteCatalog, validateSiteDocument } from './catalog'
export { SITE_FORM_SCRIPT } from './components/form'
export {
  applySymbolOverrides,
  SITE_SYMBOL_TYPE,
  type SiteSymbolProps,
  siteSymbolSchema,
  symbolTextNodes,
  usedSymbolIds,
} from './components/symbol'
export {
  SITE_ADMIN_ONLY_TYPES,
  SITE_BREAKPOINTS,
  SITE_CATALOG_ID,
  SITE_CATALOG_VERSION,
  SITE_ELEMENT_TYPES,
  SITE_MEDIA,
  SITE_ROOT_CLASS,
  SITE_TYPES,
  SITE_VIEWPORT_WIDTHS,
} from './constants'
export type {
  SiteLiveForm,
  SitePageLink,
  SiteRenderContext,
} from './context'
export {
  type CompileSiteCssOptions,
  compileNodesCss,
  compileSiteCss,
  cssUsage,
  nodeClass,
} from './css'
export { SITE_ICON_NAMES, SITE_ICONS, SOCIAL_NETWORKS } from './icons'
export {
  getSiteTemplate,
  SITE_KITS,
  SITE_PRESETS,
  SITE_SECTION_LABELS,
  SITE_SECTION_PRESETS,
  SITE_SECTION_TYPES,
  SITE_TEMPLATES,
  type SiteKitId,
  type SitePreset,
  type SiteSectionType,
  type SiteTemplate,
  sectionPreset,
} from './presets'
export { documentTypes, needsFormScript, SiteDocument } from './render'
export {
  SITE_BOOT_SCRIPT,
  type SiteRuntime,
  type SiteRuntimeFeature,
  type SiteRuntimeScript,
  siteRuntimeFeatures,
  siteRuntimeScripts,
} from './runtime'
export type * from './schemas'
export {
  compileThemeCss,
  defaultSiteTheme,
  parseSiteTheme,
  SITE_FONTS,
  type SiteTheme,
  siteColorTokens,
  siteThemeSchema,
} from './theme'
