import { z } from 'zod'
import {
  canvasBorderSchema,
  canvasColorSchema,
  canvasRadiusSchema,
  canvasShadowSchema,
  canvasSizeSchema,
  responsiveSchema,
} from '@/src/lib/canvas/values'
import {
  ASPECT_RATIOS,
  commonShape,
  HEADING_LEVELS,
  siteAlignSchema,
} from './schemas'

/**
 * Props of the blog and collection elements (slice site-blog). They render
 * dynamic content (`SiteRenderContext.cms`); the props only say what to
 * show and how.
 */

const resp = responsiveSchema
const gap = z.number().min(0).max(400)
/** Category/tag slug filter (`''` = any). */
const termSlug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9-]*$/)

const cardShape = {
  radius: canvasRadiusSchema.optional(),
  border: canvasBorderSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  /** Card background (cards layout). */
  background: canvasColorSchema.optional(),
}

export const POST_LIST_SOURCES = [
  'latest',
  'archive',
  'featured',
  'related',
] as const

export const POST_LIST_LAYOUTS = ['grid', 'list', 'cards'] as const

export const sitePostListSchema = z.object({
  /** `archive` follows the page (category, tag, author, search, page
   * number); `related` shows posts sharing categories/tags with the
   * current post. */
  source: z.enum(POST_LIST_SOURCES),
  categorySlug: termSlug.optional(),
  tagSlug: termSlug.optional(),
  layout: z.enum(POST_LIST_LAYOUTS),
  columns: resp(z.number().int().min(1).max(4)),
  perPage: z.number().int().min(1).max(24),
  pagination: z.boolean(),
  /** The first post spans the whole row, larger. */
  featuredFirst: z.boolean(),
  showCover: z.boolean(),
  showExcerpt: z.boolean(),
  showDate: z.boolean(),
  showAuthor: z.boolean(),
  showCategories: z.boolean(),
  showReadingTime: z.boolean(),
  /** Title and description of the archive above the list. */
  showArchiveHeader: z.boolean(),
  titleLevel: z.enum(['h2', 'h3', 'h4']),
  aspectRatio: z.enum(ASPECT_RATIOS),
  gap: resp(gap),
  emptyText: z.string().max(200),
  ...cardShape,
  ...commonShape,
})
export type SitePostListProps = z.infer<typeof sitePostListSchema>

export const sitePostSchema = z.object({
  showTitle: z.boolean(),
  showMeta: z.boolean(),
  showCover: z.boolean(),
  /** The excerpt as a lead paragraph under the title. */
  showExcerpt: z.boolean(),
  showTags: z.boolean(),
  showFaq: z.boolean(),
  /** "Atualizado em" when the post changed after publication. */
  showUpdated: z.boolean(),
  maxWidth: resp(canvasSizeSchema).optional(),
  align: resp(siteAlignSchema).optional(),
  ...commonShape,
})
export type SitePostProps = z.infer<typeof sitePostSchema>

export const sitePostTermsSchema = z.object({
  taxonomy: z.enum(['categories', 'tags']),
  /** `post`: only the terms of the current post. */
  scope: z.enum(['all', 'post']),
  display: z.enum(['list', 'chips']),
  showCount: z.boolean(),
  title: z.string().max(120),
  gap: resp(gap).optional(),
  ...commonShape,
})
export type SitePostTermsProps = z.infer<typeof sitePostTermsSchema>

export const siteBlogSearchSchema = z.object({
  label: z.string().max(80),
  placeholder: z.string().max(120),
  buttonLabel: z.string().max(40),
  maxWidth: resp(canvasSizeSchema).optional(),
  ...commonShape,
})
export type SiteBlogSearchProps = z.infer<typeof siteBlogSearchSchema>

export const sitePostAuthorSchema = z.object({
  showAvatar: z.boolean(),
  showBio: z.boolean(),
  showLinks: z.boolean(),
  /** Link the name to the author page. */
  linkName: z.boolean(),
  layout: z.enum(['row', 'column']),
  ...cardShape,
  ...commonShape,
})
export type SitePostAuthorProps = z.infer<typeof sitePostAuthorSchema>

/** Field key of a collection (`title` is the item title). */
const fieldKey = z
  .string()
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$|^$/)

export const siteCollectionListSchema = z.object({
  collectionId: z.string().max(64),
  layout: z.enum(['grid', 'list']),
  columns: resp(z.number().int().min(1).max(4)),
  limit: z.number().int().min(1).max(48),
  sort: z.enum(['position', 'newest', 'title']),
  imageField: fieldKey.optional(),
  textField: fieldKey.optional(),
  metaField: fieldKey.optional(),
  showButton: z.boolean(),
  buttonLabel: z.string().max(40),
  titleLevel: z.enum(['h2', 'h3', 'h4']),
  aspectRatio: z.enum(ASPECT_RATIOS),
  gap: resp(gap),
  emptyText: z.string().max(200),
  ...cardShape,
  ...commonShape,
})
export type SiteCollectionListProps = z.infer<typeof siteCollectionListSchema>

export const siteCollectionFieldSchema = z.object({
  /** Field of the current item (`title` = item title). */
  fieldKey,
  /** `heading` renders text as a title of `level`. */
  display: z.enum(['auto', 'heading']),
  level: z.enum(HEADING_LEVELS),
  /** Shown before the value (`Local:`), empty for none. */
  label: z.string().max(60),
  align: resp(siteAlignSchema).optional(),
  color: canvasColorSchema.optional(),
  ...commonShape,
})
export type SiteCollectionFieldProps = z.infer<typeof siteCollectionFieldSchema>
