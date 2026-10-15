import {
  ContainerIcon,
  Cursor01Icon,
  DashedLine01Icon,
  DocumentValidationIcon,
  File02Icon,
  Heading02Icon,
  Image01Icon,
  Layout01Icon,
  LayoutTwoColumnIcon,
  LeftToRightListBulletIcon,
  Menu01Icon,
  Share08Icon,
  SourceCodeIcon,
  SquareArrowExpand01Icon,
  StarIcon,
  TextIcon,
  Video01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { validateDocument } from '@/src/lib/canvas/ops'
import {
  type CanvasCatalog,
  type CanvasComponentDefinition,
  defineCatalog,
} from '@/src/lib/canvas/registry'
import {
  buttonDefinition,
  dividerDefinition,
  headingDefinition,
  listDefinition,
  spacerDefinition,
  textDefinition,
} from './components/content'
import { formDefinition } from './components/form'
import {
  columnsDefinition,
  containerDefinition,
  pageDefinition,
  sectionDefinition,
} from './components/layout'
import {
  embedDefinition,
  iconDefinition,
  imageDefinition,
  videoDefinition,
} from './components/media'
import { menuDefinition, socialDefinition } from './components/navigation'
import {
  SITE_BREAKPOINTS,
  SITE_CATALOG_ID,
  SITE_CATALOG_VERSION,
  SITE_CATEGORIES,
  SITE_ROOT_CLASS,
} from './constants'
import type { SiteRenderContext } from './context'

/**
 * The site catalog of Steel Canvas (`site`, version 1): page → section →
 * container (flex/grid, nestable) → elements. Components render semantic
 * HTML with generated classes (`css.ts`), never inline styles; the editor
 * canvas and the published page share the same render functions — the
 * editor only adds `attributes` and empty-slot hints.
 */

const ICONS = {
  page: File02Icon,
  section: Layout01Icon,
  container: ContainerIcon,
  columns: LayoutTwoColumnIcon,
  heading: Heading02Icon,
  text: TextIcon,
  button: Cursor01Icon,
  list: LeftToRightListBulletIcon,
  divider: DashedLine01Icon,
  spacer: SquareArrowExpand01Icon,
  image: Image01Icon,
  icon: StarIcon,
  video: Video01Icon,
  embed: SourceCodeIcon,
  menu: Menu01Icon,
  social: Share08Icon,
  form: DocumentValidationIcon,
}

/** Builds the catalog for one render context (pages, live forms, role). */
export function createSiteCatalog(ctx: SiteRenderContext = {}): CanvasCatalog {
  const definitions: CanvasComponentDefinition[] = [
    pageDefinition,
    sectionDefinition,
    containerDefinition,
    columnsDefinition,
    headingDefinition(ctx),
    textDefinition,
    buttonDefinition(ctx),
    listDefinition,
    dividerDefinition,
    spacerDefinition,
    imageDefinition(ctx),
    iconDefinition(ctx),
    videoDefinition,
    menuDefinition(ctx),
    socialDefinition,
    formDefinition(ctx),
    embedDefinition(ctx),
  ]
  return defineCatalog({
    id: SITE_CATALOG_ID,
    version: SITE_CATALOG_VERSION,
    rootType: 'site.page',
    categories: [...SITE_CATEGORIES],
    breakpoints: SITE_BREAKPOINTS,
    icons: ICONS,
    components: Object.fromEntries(
      definitions.map((definition) => [definition.type, definition]),
    ),
    renderDocument: ({ children, editing }) => (
      <div
        className={editing ? `${SITE_ROOT_CLASS} s-editing` : SITE_ROOT_CLASS}
      >
        {children}
      </div>
    ),
  })
}

/** Context-free catalog: validation and stand-alone renders. */
export const siteCatalog = createSiteCatalog()

/** Full validation of a stored site page/global document (tree, catalog
 * rules and every node's props). */
export function validateSiteDocument(input: unknown) {
  return validateDocument(input, siteCatalog)
}
