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

const commonShape = {
  visibility: canvasVisibilitySchema.optional(),
  anchor: siteAnchorSchema.optional(),
  margin: resp(canvasSpacingSchema).optional(),
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
