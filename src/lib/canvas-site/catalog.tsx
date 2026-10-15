import {
  Add01Icon,
  AppWindowIcon,
  ArrowDataTransferHorizontalIcon,
  BrowserIcon,
  Building06Icon,
  CarouselHorizontal02Icon,
  CarouselHorizontalIcon,
  CenterFocusIcon,
  ChartColumnIcon,
  ContainerIcon,
  Cursor01Icon,
  DashedLine01Icon,
  DiscountTag01Icon,
  DocumentValidationIcon,
  File02Icon,
  GalleryThumbnailsIcon,
  Heading02Icon,
  HourglassIcon,
  Image01Icon,
  Layout01Icon,
  LayoutThreeRowIcon,
  LayoutTwoColumnIcon,
  LeftToRightListBulletIcon,
  MapsLocation01Icon,
  Menu01Icon,
  QuoteDownIcon,
  Share08Icon,
  SourceCodeIcon,
  SquareArrowExpand01Icon,
  StarIcon,
  TextIcon,
  Video01Icon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { validateDocument } from '@/src/lib/canvas/ops'
import {
  type CanvasCatalog,
  type CanvasComponentDefinition,
  defineCatalog,
  type InspectorSection,
} from '@/src/lib/canvas/registry'
import { mapDefinition, whatsappDefinition } from './components/contact'
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
  accordionDefinition,
  accordionItemDefinition,
  beforeAfterDefinition,
  carouselDefinition,
  popupDefinition,
  slideDefinition,
  tabDefinition,
  tabsDefinition,
} from './components/interactive'
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
  countdownDefinition,
  galleryDefinition,
  logosDefinition,
  pricingDefinition,
  statsDefinition,
  testimonialsDefinition,
} from './components/showcase'
import {
  SITE_BREAKPOINTS,
  SITE_CATALOG_ID,
  SITE_CATALOG_VERSION,
  SITE_CATEGORIES,
  SITE_ROOT_CLASS,
  SITE_TYPES,
} from './constants'
import type { SiteRenderContext } from './context'
import { effectSections, withEffects } from './effects'

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
  gallery: GalleryThumbnailsIcon,
  carousel: CarouselHorizontalIcon,
  slide: CarouselHorizontal02Icon,
  tabs: AppWindowIcon,
  tab: BrowserIcon,
  accordion: LayoutThreeRowIcon,
  accordionItem: Add01Icon,
  popup: CenterFocusIcon,
  countdown: HourglassIcon,
  stats: ChartColumnIcon,
  testimonials: QuoteDownIcon,
  pricing: DiscountTag01Icon,
  logos: Building06Icon,
  map: MapsLocation01Icon,
  whatsapp: WhatsappIcon,
  beforeAfter: ArrowDataTransferHorizontalIcon,
}

const CHILDREN_LABELS: Record<string, string> = {
  [SITE_TYPES.carousel]: 'Slides',
  [SITE_TYPES.tabs]: 'Abas',
  [SITE_TYPES.accordion]: 'Itens',
}

/** "Adicionar slide/aba/item" (editor only: needs `ctx.childAdder`). */
function childrenSection(
  type: string,
  ctx: SiteRenderContext,
): InspectorSection[] {
  const label = CHILDREN_LABELS[type]
  if (!label || !ctx.childAdder) return []
  return [
    {
      id: 'children',
      label,
      tab: 'content',
      fields: [
        {
          path: 'children',
          label,
          control: { kind: 'custom', component: ctx.childAdder },
        },
      ],
    },
  ]
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
    galleryDefinition(),
    carouselDefinition,
    slideDefinition,
    tabsDefinition,
    tabDefinition,
    accordionDefinition,
    accordionItemDefinition,
    popupDefinition,
    countdownDefinition,
    statsDefinition,
    testimonialsDefinition,
    pricingDefinition(ctx),
    logosDefinition(ctx),
    mapDefinition,
    whatsappDefinition(ctx),
    beforeAfterDefinition,
  ].map((definition) => ({
    ...definition,
    // S2 effects: hover, click interaction, entrance animation and free
    // position, for every type they apply to.
    inspector: [
      ...childrenSection(definition.type, ctx),
      ...definition.inspector,
      ...effectSections(definition.type, ctx),
    ],
    render: withEffects(definition.render, ctx),
  }))
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
