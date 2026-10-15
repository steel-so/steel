import { z } from 'zod'
import {
  canvasBackgroundSchema,
  canvasBorderSchema,
  canvasColorSchema,
  canvasImageSchema,
  canvasLinkSchema,
  canvasRadiusSchema,
  canvasShadowSchema,
  canvasSizeSchema,
  canvasSpacingSchema,
  canvasTypographySchema,
  canvasVisibilitySchema,
  responsiveSchema,
} from '@/src/lib/canvas/values'
import { FORM_FIELD_TYPES } from '@/src/schemas/crm-form.schema'
import { SITE_ICON_NAMES, SOCIAL_NETWORK_NAMES } from './icons'
import { SITE_BUTTON_VARIANTS, SITE_TEXT_PRESETS } from './theme'

/**
 * Props of every `site.*` component. Responsive fields accept a plain value
 * or `{ base, tablet?, mobile? }` (`responsiveSchema`); the CSS compiler
 * turns the overrides into media queries.
 */

const resp = responsiveSchema

// ─── shared ───────────────────────────────────────────────────────────────

export const siteAlignSchema = z.enum(['left', 'center', 'right'])
export type SiteAlign = z.infer<typeof siteAlignSchema>

/** `id` of the element, the target of `#anchor` links. Letters, digits,
 * `-` and `_` (empty = none). */
export const siteAnchorSchema = z
  .string()
  .max(60)
  .regex(/^[A-Za-z0-9_-]*$/)

// ─── effects (S2): interaction, animation, hover, free position ─────────

export const SITE_INTERACTION_ACTIONS = [
  'none',
  'popup',
  'close',
  'scroll',
  'link',
  'toggle',
] as const
export type SiteInteractionAction = (typeof SITE_INTERACTION_ACTIONS)[number]

/** What a click on the element does. Popups, scroll targets and toggled
 * elements are found by their anchor (`id`). */
export const siteInteractionSchema = z.object({
  action: z.enum(SITE_INTERACTION_ACTIONS),
  /** Anchor of the popup / section / element (popup, scroll, toggle). */
  target: siteAnchorSchema.optional(),
  /** Destination of `link`. */
  link: canvasLinkSchema.optional(),
})
export type SiteInteraction = z.infer<typeof siteInteractionSchema>

export const SITE_ANIMATION_EFFECTS = [
  'none',
  'fade',
  'fade-up',
  'fade-down',
  'slide-left',
  'slide-right',
  'zoom',
  'blur',
] as const
export type SiteAnimationEffect = (typeof SITE_ANIMATION_EFFECTS)[number]

export const SITE_EASINGS = [
  'ease',
  'ease-out',
  'ease-in-out',
  'linear',
  'spring',
] as const

/** Entrance animation, on load or when the element scrolls into view.
 * Visitors who prefer reduced motion see the element without it. */
export const siteAnimationSchema = z.object({
  effect: z.enum(SITE_ANIMATION_EFFECTS),
  /** Default `scroll`. */
  trigger: z.enum(['load', 'scroll']).optional(),
  /** ms; default 600. */
  duration: z.number().min(100).max(5000).optional(),
  /** ms; default 0. */
  delay: z.number().min(0).max(10000).optional(),
  /** Default `ease-out`. */
  easing: z.enum(SITE_EASINGS).optional(),
})
export type SiteAnimation = z.infer<typeof siteAnimationSchema>

/** Style while hovered or focused (buttons, cards, images, icons). */
export const siteHoverSchema = z.object({
  background: canvasColorSchema.optional(),
  textColor: canvasColorSchema.optional(),
  borderColor: canvasColorSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  /** % (100 = same size). */
  scale: z.number().min(50).max(200).optional(),
  /** px moved up (negative moves down). */
  lift: z.number().min(-60).max(60).optional(),
  /** % opacity. */
  opacity: z.number().min(0).max(100).optional(),
  /** Transition, ms; default 200. */
  duration: z.number().min(0).max(2000).optional(),
})
export type SiteHover = z.infer<typeof siteHoverSchema>

/** Position inside a container in free positioning (`positioning: free`),
 * px from its top-left corner, per breakpoint; ignored in the flow. */
export const sitePlaceSchema = z.object({
  x: resp(z.number().min(-4000).max(4000)),
  y: resp(z.number().min(-4000).max(4000)),
  width: resp(canvasSizeSchema).optional(),
  /** Stacking order. */
  z: z.number().int().min(0).max(100).optional(),
})
export type SitePlace = z.infer<typeof sitePlaceSchema>

const commonShape = {
  visibility: canvasVisibilitySchema.optional(),
  anchor: siteAnchorSchema.optional(),
  margin: resp(canvasSpacingSchema).optional(),
  interaction: siteInteractionSchema.optional(),
  animation: siteAnimationSchema.optional(),
  hover: siteHoverSchema.optional(),
  place: sitePlaceSchema.optional(),
}

const gapSchema = z.number().min(0).max(400)
const urlSchema = z.string().max(2000)

export const siteIconNameSchema = z.enum(SITE_ICON_NAMES)
/** An icon or `''` ("Sem ícone" in the select). */
const optionalIconSchema = z
  .union([z.literal(''), siteIconNameSchema])
  .optional()

// ─── layout ───────────────────────────────────────────────────────────────

export const sitePageSchema = z.object({
  background: canvasBackgroundSchema,
  /** `main` for a page; header/footer globals use `div` (their sections
   * carry the landmarks). Default `main`. */
  tag: z.enum(['main', 'div']).optional(),
})
export type SitePageProps = z.infer<typeof sitePageSchema>

export const SECTION_TAGS = [
  'section',
  'header',
  'footer',
  'main',
  'aside',
  'div',
] as const

export const siteSectionSchema = z.object({
  tag: z.enum(SECTION_TAGS),
  background: canvasBackgroundSchema,
  /** Muted, looping background video (behind the overlay and content). */
  video: z
    .object({ src: urlSchema.optional(), poster: urlSchema.optional() })
    .nullable()
    .optional(),
  /** Color laid over the background (image/video) at `opacity` %. */
  overlay: z
    .object({
      color: canvasColorSchema.optional(),
      /** Default 50. */
      opacity: z.number().min(0).max(100).optional(),
    })
    .nullable()
    .optional(),
  textColor: canvasColorSchema.optional(),
  padding: resp(canvasSpacingSchema),
  minHeight: resp(canvasSizeSchema).optional(),
  /** `boxed` centers the content at the theme width (or `maxWidth`). */
  width: z.enum(['boxed', 'full']),
  maxWidth: resp(z.number().min(240).max(2400)).optional(),
  gap: resp(gapSchema),
  /** Horizontal placement of the children inside the content box. */
  contentAlign: resp(z.enum(['stretch', 'start', 'center', 'end'])),
  verticalAlign: z.enum(['start', 'center', 'end']),
  border: canvasBorderSchema.optional(),
  radius: canvasRadiusSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  ...commonShape,
})
export type SiteSectionProps = z.infer<typeof siteSectionSchema>

export const CONTAINER_TAGS = ['div', 'article', 'aside', 'nav'] as const
export const FLEX_ALIGN = [
  'start',
  'center',
  'end',
  'stretch',
  'baseline',
] as const
export const FLEX_JUSTIFY = [
  'start',
  'center',
  'end',
  'between',
  'around',
  'evenly',
] as const

/** Grid template a user may type: tracks, `fr`, `px`, `%`, `auto`,
 * `minmax()`, `repeat()`. */
const columnsTemplateSchema = z
  .string()
  .max(200)
  .regex(/^[a-z0-9 .%(),-]*$/i)

export const siteContainerSchema = z.object({
  tag: z.enum(CONTAINER_TAGS),
  layout: resp(z.enum(['flex', 'grid'])),
  direction: resp(z.enum(['row', 'column'])),
  wrap: resp(z.boolean()),
  gap: resp(gapSchema),
  rowGap: resp(gapSchema).optional(),
  /** Equal grid columns (`layout: grid`). */
  columns: resp(z.number().int().min(1).max(12)),
  /** Custom `grid-template-columns`; wins over `columns` when set. */
  columnsTemplate: resp(columnsTemplateSchema).optional(),
  alignItems: resp(z.enum(FLEX_ALIGN)),
  justify: resp(z.enum(FLEX_JUSTIFY)),
  /** Fills the free space of a flex row (`flex: 1 1 0`). */
  grow: resp(z.boolean()).optional(),
  /** `free`: children placed by x/y ("posição livre"); default `flow`. */
  positioning: resp(z.enum(['flow', 'free'])).optional(),
  width: resp(canvasSizeSchema).optional(),
  maxWidth: resp(canvasSizeSchema).optional(),
  minHeight: resp(canvasSizeSchema).optional(),
  padding: resp(canvasSpacingSchema),
  background: canvasBackgroundSchema,
  textColor: canvasColorSchema.optional(),
  textAlign: resp(siteAlignSchema).optional(),
  border: canvasBorderSchema.optional(),
  radius: canvasRadiusSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  ...commonShape,
})
export type SiteContainerProps = z.infer<typeof siteContainerSchema>

/** `site.columns` is a palette entry that inserts a grid container; a
 * stray node of this type renders nothing. */
export const siteColumnsSchema = z.object({})
export type SiteColumnsProps = z.infer<typeof siteColumnsSchema>

// ─── text ─────────────────────────────────────────────────────────────────

export const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

export const siteTextPresetSchema = z.enum(SITE_TEXT_PRESETS)

const typographySchema = resp(canvasTypographySchema)

export const siteHeadingSchema = z.object({
  text: z.string().max(500),
  /** Semantic level (document outline). */
  level: z.enum(HEADING_LEVELS),
  /** Visual style from the theme; defaults to the level's. */
  preset: siteTextPresetSchema.optional(),
  align: resp(siteAlignSchema),
  color: canvasColorSchema.optional(),
  typography: typographySchema.optional(),
  maxWidth: resp(canvasSizeSchema).optional(),
  link: canvasLinkSchema.optional(),
  ...commonShape,
})
export type SiteHeadingProps = z.infer<typeof siteHeadingSchema>

export const BODY_PRESETS = ['lead', 'body', 'small', 'overline'] as const

export const siteTextSchema = z.object({
  /** Rich text (sanitized on render). */
  html: z.string().max(20000),
  preset: z.enum(BODY_PRESETS),
  align: resp(z.enum(['left', 'center', 'right', 'justify'])),
  color: canvasColorSchema.optional(),
  typography: typographySchema.optional(),
  maxWidth: resp(canvasSizeSchema).optional(),
  ...commonShape,
})
export type SiteTextProps = z.infer<typeof siteTextSchema>

// ─── actions ──────────────────────────────────────────────────────────────

export const siteButtonSchema = z.object({
  label: z.string().max(120),
  link: canvasLinkSchema,
  variant: z.enum(SITE_BUTTON_VARIANTS),
  size: z.enum(['sm', 'md', 'lg']),
  align: resp(z.enum(['left', 'center', 'right', 'stretch'])),
  icon: optionalIconSchema,
  iconPosition: z.enum(['start', 'end']),
  background: canvasColorSchema.optional(),
  textColor: canvasColorSchema.optional(),
  borderColor: canvasColorSchema.optional(),
  radius: z.number().min(0).max(999).optional(),
  ...commonShape,
})
export type SiteButtonProps = z.infer<typeof siteButtonSchema>

// ─── media ────────────────────────────────────────────────────────────────

export const ASPECT_RATIOS = [
  'auto',
  '1/1',
  '4/3',
  '3/2',
  '16/9',
  '3/4',
  '9/16',
  '21/9',
] as const

export const siteImageSchema = z.object({
  image: canvasImageSchema,
  width: resp(canvasSizeSchema),
  maxWidth: resp(canvasSizeSchema).optional(),
  aspectRatio: resp(z.enum(ASPECT_RATIOS)),
  fit: z.enum(['cover', 'contain']),
  align: resp(siteAlignSchema),
  /** Intrinsic size of the file (set on upload) — avoids layout shift. */
  dimensions: z
    .object({
      width: z.number().int().min(1).max(20000),
      height: z.number().int().min(1).max(20000),
    })
    .optional(),
  caption: z.string().max(300).optional(),
  /** Above the fold (hero): eager load with high fetch priority. */
  priority: z.boolean().optional(),
  radius: canvasRadiusSchema.optional(),
  border: canvasBorderSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  link: canvasLinkSchema.optional(),
  ...commonShape,
})
export type SiteImageProps = z.infer<typeof siteImageSchema>

export const siteIconSchema = z.object({
  name: siteIconNameSchema,
  size: resp(z.number().min(8).max(256)),
  color: canvasColorSchema.optional(),
  shape: z.enum(['none', 'circle', 'square']),
  background: canvasColorSchema.optional(),
  padding: z.number().min(0).max(100),
  align: resp(siteAlignSchema),
  /** Accessible name; empty = decorative. */
  label: z.string().max(120).optional(),
  link: canvasLinkSchema.optional(),
  ...commonShape,
})
export type SiteIconProps = z.infer<typeof siteIconSchema>

export const VIDEO_RATIOS = ['16/9', '4/3', '1/1', '9/16', '21/9'] as const

export const siteVideoSchema = z.object({
  source: z.enum(['upload', 'youtube', 'vimeo']),
  url: urlSchema,
  poster: urlSchema.optional(),
  /** Accessible title of the player. */
  title: z.string().max(200),
  aspectRatio: z.enum(VIDEO_RATIOS),
  autoplay: z.boolean(),
  muted: z.boolean(),
  loop: z.boolean(),
  controls: z.boolean(),
  width: resp(canvasSizeSchema).optional(),
  radius: canvasRadiusSchema.optional(),
  ...commonShape,
})
export type SiteVideoProps = z.infer<typeof siteVideoSchema>

// ─── structure ────────────────────────────────────────────────────────────

export const siteDividerSchema = z.object({
  style: z.enum(['solid', 'dashed', 'dotted']),
  thickness: z.number().min(1).max(20),
  color: canvasColorSchema,
  width: resp(canvasSizeSchema),
  align: resp(siteAlignSchema),
  ...commonShape,
})
export type SiteDividerProps = z.infer<typeof siteDividerSchema>

export const siteSpacerSchema = z.object({
  height: resp(z.number().min(0).max(800)),
  visibility: canvasVisibilitySchema.optional(),
  anchor: siteAnchorSchema.optional(),
})
export type SiteSpacerProps = z.infer<typeof siteSpacerSchema>

export const siteListSchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string().max(500),
        icon: optionalIconSchema,
      }),
    )
    .max(50),
  marker: z.enum(['check', 'dot', 'number', 'icon', 'none']),
  /** Default icon of the `icon` marker (items may override). */
  icon: siteIconNameSchema,
  markerColor: canvasColorSchema,
  preset: z.enum(['lead', 'body', 'small']),
  color: canvasColorSchema.optional(),
  gap: resp(gapSchema),
  columns: resp(z.number().int().min(1).max(4)),
  ...commonShape,
})
export type SiteListProps = z.infer<typeof siteListSchema>

// ─── forms ────────────────────────────────────────────────────────────────

/** Copy of a CRM form field taken when the form is picked; the public
 * runtime prefers the live form (`SiteRenderContext.forms`). */
export const siteFormFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().max(120),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean(),
  placeholder: z.string().max(200).optional(),
  options: z
    .array(z.object({ label: z.string().max(120), value: z.string().max(120) }))
    .max(50)
    .optional(),
})
export type SiteFormField = z.infer<typeof siteFormFieldSchema>

export const siteFormSchema = z.object({
  /** Public token of the CRM form (`/api/crm/forms/<token>/submit`);
   * empty until one is picked. */
  formToken: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9_-]*$/),
  formName: z.string().max(200),
  fields: z.array(siteFormFieldSchema).max(50),
  submitLabel: z.string().max(80),
  successMessage: z.string().max(300),
  columns: resp(z.enum(['1', '2'])),
  buttonVariant: z.enum(SITE_BUTTON_VARIANTS),
  buttonAlign: z.enum(['left', 'center', 'right', 'stretch']),
  fieldBackground: canvasColorSchema.optional(),
  ...commonShape,
})
export type SiteFormProps = z.infer<typeof siteFormSchema>

// ─── navigation ───────────────────────────────────────────────────────────

export const siteMenuSchema = z.object({
  /** `pages`: the site's pages (in order); `custom`: `items`. */
  source: z.enum(['pages', 'custom']),
  items: z
    .array(z.object({ label: z.string().max(80), link: canvasLinkSchema }))
    .max(30),
  orientation: z.enum(['horizontal', 'vertical']),
  justify: resp(z.enum(['start', 'center', 'end'])),
  gap: resp(gapSchema),
  preset: z.enum(['body', 'small', 'lead']),
  color: canvasColorSchema.optional(),
  hoverColor: canvasColorSchema.optional(),
  /** Breakpoint from which the menu collapses into a hamburger. */
  collapse: z.enum(['tablet', 'mobile', 'never']),
  /** Accessible name of the `<nav>`. */
  label: z.string().max(80),
  ...commonShape,
})
export type SiteMenuProps = z.infer<typeof siteMenuSchema>

export const siteSocialSchema = z.object({
  items: z
    .array(z.object({ network: z.enum(SOCIAL_NETWORK_NAMES), url: urlSchema }))
    .max(12),
  size: resp(z.number().min(12).max(96)),
  color: canvasColorSchema,
  background: canvasColorSchema.optional(),
  shape: z.enum(['none', 'circle', 'rounded']),
  gap: resp(gapSchema),
  align: resp(siteAlignSchema),
  ...commonShape,
})
export type SiteSocialProps = z.infer<typeof siteSocialSchema>

// ─── advanced ─────────────────────────────────────────────────────────────

export const siteEmbedSchema = z.object({
  mode: z.enum(['html', 'url']),
  html: z.string().max(50000),
  url: urlSchema,
  height: resp(z.number().min(40).max(4000)),
  title: z.string().max(200),
  ...commonShape,
})
export type SiteEmbedProps = z.infer<typeof siteEmbedSchema>

// ─── S2: interactive and showcase elements ────────────────────────────────

const imageItemSchema = canvasImageSchema
const cardColor = canvasColorSchema.optional()

export const siteGallerySchema = z.object({
  items: z
    .array(
      z.object({
        image: imageItemSchema,
        caption: z.string().max(300).optional(),
      }),
    )
    .max(60),
  /** `masonry` keeps each photo's proportion in columns. */
  layout: z.enum(['grid', 'masonry']),
  columns: resp(z.number().int().min(1).max(6)),
  gap: resp(gapSchema),
  /** Grid cells (`layout: grid`). */
  aspectRatio: z.enum(ASPECT_RATIOS),
  fit: z.enum(['cover', 'contain']),
  /** Opens the photos full screen with previous/next. */
  lightbox: z.boolean(),
  showCaptions: z.boolean(),
  radius: canvasRadiusSchema.optional(),
  ...commonShape,
})
export type SiteGalleryProps = z.infer<typeof siteGallerySchema>

export const siteCarouselSchema = z.object({
  /** Accessible name of the carousel region. */
  label: z.string().max(120),
  autoplay: z.boolean(),
  /** Seconds per slide while autoplaying. */
  interval: z.number().min(2).max(30),
  loop: z.boolean(),
  arrows: z.boolean(),
  dots: z.boolean(),
  perView: resp(z.number().int().min(1).max(6)),
  gap: resp(gapSchema),
  /** Arrows and the active dot. */
  controlColor: canvasColorSchema.optional(),
  ...commonShape,
})
export type SiteCarouselProps = z.infer<typeof siteCarouselSchema>

export const siteSlideSchema = z.object({
  background: canvasBackgroundSchema,
  textColor: canvasColorSchema.optional(),
  padding: resp(canvasSpacingSchema),
  gap: resp(gapSchema),
  alignItems: resp(z.enum(['start', 'center', 'end', 'stretch'])),
  verticalAlign: z.enum(['start', 'center', 'end']),
  minHeight: resp(canvasSizeSchema).optional(),
  radius: canvasRadiusSchema.optional(),
  ...commonShape,
})
export type SiteSlideProps = z.infer<typeof siteSlideSchema>

export const siteTabsSchema = z.object({
  variant: z.enum(['underline', 'pills', 'boxed']),
  orientation: z.enum(['horizontal', 'vertical']),
  align: z.enum(['start', 'center', 'stretch']),
  gap: resp(gapSchema),
  /** Text and indicator of the selected tab. */
  activeColor: canvasColorSchema.optional(),
  tabColor: canvasColorSchema.optional(),
  ...commonShape,
})
export type SiteTabsProps = z.infer<typeof siteTabsSchema>

export const siteTabSchema = z.object({
  label: z.string().max(80),
  icon: optionalIconSchema,
  padding: resp(canvasSpacingSchema),
  gap: resp(gapSchema),
  ...commonShape,
})
export type SiteTabProps = z.infer<typeof siteTabSchema>

export const siteAccordionSchema = z.object({
  /** Several items open at once (otherwise opening one closes the rest). */
  multiple: z.boolean(),
  variant: z.enum(['separated', 'bordered', 'minimal']),
  icon: z.enum(['chevron', 'plus']),
  /** Heading level of the titles (document outline). */
  headingLevel: z.enum(['h2', 'h3', 'h4', 'h5', 'h6']),
  titlePreset: z.enum(['h4', 'h5', 'h6', 'lead', 'body']),
  gap: resp(gapSchema),
  itemBackground: cardColor,
  borderColor: cardColor,
  radius: canvasRadiusSchema.optional(),
  ...commonShape,
})
export type SiteAccordionProps = z.infer<typeof siteAccordionSchema>

export const siteAccordionItemSchema = z.object({
  title: z.string().max(300),
  /** Starts open. */
  open: z.boolean(),
  gap: resp(gapSchema),
  ...commonShape,
})
export type SiteAccordionItemProps = z.infer<typeof siteAccordionItemSchema>

export const POPUP_TRIGGERS = [
  'click',
  'load',
  'delay',
  'scroll',
  'exit',
] as const

export const sitePopupSchema = z.object({
  /** Name in the editor and accessible name of the dialog. */
  name: z.string().max(80),
  /** `click`: only through interactions (and `#anchor` links). */
  trigger: z.enum(POPUP_TRIGGERS),
  /** Seconds (`delay`). */
  delay: z.number().min(0).max(300),
  /** % of the page scrolled (`scroll`). */
  scrollPercent: z.number().min(5).max(100),
  /** How often an automatic trigger opens it for the same visitor. */
  frequency: z.enum(['always', 'session', 'once']),
  width: resp(z.number().min(240).max(1400)),
  position: z.enum(['center', 'top', 'bottom', 'bottom-left', 'bottom-right']),
  background: canvasBackgroundSchema,
  textColor: canvasColorSchema.optional(),
  padding: resp(canvasSpacingSchema),
  gap: resp(gapSchema),
  radius: canvasRadiusSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  overlayColor: canvasColorSchema,
  /** % */
  overlayOpacity: z.number().min(0).max(100),
  closeOnOverlay: z.boolean(),
  showClose: z.boolean(),
  ...commonShape,
})
export type SitePopupProps = z.infer<typeof sitePopupSchema>

/** UTC offsets offered by the countdown (Brazil first). */
export const UTC_OFFSETS = [
  '-03:00',
  '-02:00',
  '-04:00',
  '-05:00',
  '+00:00',
  '-06:00',
  '-07:00',
  '-08:00',
  '+01:00',
  '+02:00',
  '+03:00',
  '+05:30',
  '+08:00',
  '+09:00',
] as const

export const siteCountdownSchema = z.object({
  /** `YYYY-MM-DD`. */
  date: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .max(10),
  /** `HH:mm`. */
  time: z
    .string()
    .regex(/^(\d{2}:\d{2})?$/)
    .max(5),
  /** Time zone of `date`/`time` as a UTC offset. */
  offset: z.enum(UTC_OFFSETS),
  units: z.enum(['dhms', 'dhm', 'hms']),
  showLabels: z.boolean(),
  style: z.enum(['boxes', 'plain']),
  /** Shown once the date has passed. */
  expiredText: z.string().max(200),
  size: resp(z.number().min(16).max(160)),
  align: resp(siteAlignSchema),
  numberColor: canvasColorSchema.optional(),
  labelColor: canvasColorSchema.optional(),
  boxBackground: canvasColorSchema.optional(),
  ...commonShape,
})
export type SiteCountdownProps = z.infer<typeof siteCountdownSchema>

export const siteStatsSchema = z.object({
  items: z
    .array(
      z.object({
        value: z.number().min(-1e12).max(1e12).optional(),
        prefix: z.string().max(12).optional(),
        suffix: z.string().max(12).optional(),
        label: z.string().max(160),
        decimals: z.number().int().min(0).max(3).optional(),
      }),
    )
    .max(12),
  columns: resp(z.number().int().min(1).max(6)),
  gap: resp(gapSchema),
  align: resp(siteAlignSchema),
  numberSize: resp(z.number().min(16).max(160)),
  numberColor: canvasColorSchema.optional(),
  labelColor: canvasColorSchema.optional(),
  /** Counts up from zero when the numbers come into view. */
  animate: z.boolean(),
  /** ms */
  duration: z.number().min(300).max(8000),
  dividers: z.boolean(),
  ...commonShape,
})
export type SiteStatsProps = z.infer<typeof siteStatsSchema>

export const siteTestimonialsSchema = z.object({
  items: z
    .array(
      z.object({
        quote: z.string().max(1000),
        name: z.string().max(120),
        role: z.string().max(160).optional(),
        avatar: canvasImageSchema.optional(),
        rating: z.number().int().min(0).max(5).optional(),
      }),
    )
    .max(24),
  layout: z.enum(['grid', 'slider']),
  columns: resp(z.number().int().min(1).max(4)),
  gap: resp(gapSchema),
  align: z.enum(['left', 'center']),
  showRating: z.boolean(),
  showAvatar: z.boolean(),
  autoplay: z.boolean(),
  interval: z.number().min(2).max(30),
  cardBackground: cardColor,
  starColor: cardColor,
  radius: canvasRadiusSchema.optional(),
  border: canvasBorderSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  ...commonShape,
})
export type SiteTestimonialsProps = z.infer<typeof siteTestimonialsSchema>

export const sitePricingSchema = z.object({
  plans: z
    .array(
      z.object({
        name: z.string().max(80),
        price: z.string().max(40),
        period: z.string().max(40).optional(),
        description: z.string().max(300).optional(),
        /** One feature per line. */
        features: z.string().max(3000),
        highlighted: z.boolean().optional(),
        badge: z.string().max(40).optional(),
        buttonLabel: z.string().max(80),
        link: canvasLinkSchema,
      }),
    )
    .max(6),
  columns: resp(z.number().int().min(1).max(4)),
  gap: resp(gapSchema),
  align: z.enum(['left', 'center']),
  buttonVariant: z.enum(SITE_BUTTON_VARIANTS),
  highlightButtonVariant: z.enum(SITE_BUTTON_VARIANTS),
  cardBackground: cardColor,
  highlightBackground: cardColor,
  highlightText: cardColor,
  checkColor: cardColor,
  radius: canvasRadiusSchema.optional(),
  border: canvasBorderSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  ...commonShape,
})
export type SitePricingProps = z.infer<typeof sitePricingSchema>

export const siteLogosSchema = z.object({
  items: z
    .array(
      z.object({
        image: canvasImageSchema,
        link: canvasLinkSchema.optional(),
      }),
    )
    .max(30),
  /** `marquee` scrolls the logos in a loop. */
  mode: z.enum(['grid', 'marquee']),
  columns: resp(z.number().int().min(1).max(8)),
  height: resp(z.number().min(12).max(240)),
  gap: resp(gapSchema),
  /** Seconds per loop (`marquee`). */
  speed: z.number().min(5).max(180),
  grayscale: z.boolean(),
  align: resp(siteAlignSchema),
  ...commonShape,
})
export type SiteLogosProps = z.infer<typeof siteLogosSchema>

export const siteMapSchema = z.object({
  address: z.string().max(300),
  zoom: z.number().int().min(1).max(20),
  height: resp(z.number().min(120).max(1600)),
  /** Privacy: the map (and Google) loads only after a click. */
  loadOnClick: z.boolean(),
  /** Accessible title of the map. */
  title: z.string().max(200),
  radius: canvasRadiusSchema.optional(),
  ...commonShape,
})
export type SiteMapProps = z.infer<typeof siteMapSchema>

export const siteWhatsappSchema = z.object({
  /** International number (digits; `+`, spaces and dashes are ignored). */
  phone: z
    .string()
    .max(30)
    .regex(/^[\d\s()+-]*$/),
  /** Comunicação connection the number came from (informative). */
  connectionId: z.string().max(64).optional(),
  /** Message the visitor starts with. */
  message: z.string().max(500),
  mode: z.enum(['floating', 'inline']),
  side: z.enum(['right', 'left']),
  label: z.string().max(60),
  showLabel: z.boolean(),
  size: z.enum(['md', 'lg']),
  color: canvasColorSchema,
  textColor: canvasColorSchema,
  align: resp(siteAlignSchema),
  ...commonShape,
})
export type SiteWhatsappProps = z.infer<typeof siteWhatsappSchema>

export const siteBeforeAfterSchema = z.object({
  before: canvasImageSchema,
  after: canvasImageSchema,
  beforeLabel: z.string().max(40),
  afterLabel: z.string().max(40),
  /** Initial divider position, %. */
  start: z.number().min(0).max(100),
  orientation: z.enum(['horizontal', 'vertical']),
  aspectRatio: z.enum(ASPECT_RATIOS),
  handleColor: canvasColorSchema,
  radius: canvasRadiusSchema.optional(),
  ...commonShape,
})
export type SiteBeforeAfterProps = z.infer<typeof siteBeforeAfterSchema>
