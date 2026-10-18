import z from 'zod'
import { docsPageSlug } from './docs-page.schema'

/**
 * Sidebar groups of the developer site (`/dev`), in reading order. Unlike
 * the manual, a group is not a folder: a page lives at
 * `content/dev/<path>.mdx` and is served at `/dev/<path>`, and its
 * frontmatter says which group it belongs to.
 */
export const DEV_SECTION_SLUGS = [
  'introducao',
  'fundamentos',
  'webhooks',
  'guias',
  'ferramentas',
  'mcp',
  'recursos',
] as const

export type DevSectionSlug = (typeof DEV_SECTION_SLUGS)[number]

/**
 * Url segments the pages can't take: `/dev/api` is the API reference (a
 * route handler), so a page there would never be reached.
 */
export const DEV_RESERVED_SEGMENTS = ['api'] as const

/**
 * Path of a page relative to `content/dev`, without `.mdx`: one or two
 * slug segments (`limites`, `guias/criar-lead`), never a reserved one at the
 * top.
 */
export const devPagePath = z
  .string()
  .refine((value) => {
    const segments = value.split('/')
    return (
      segments.length >= 1 &&
      segments.length <= 2 &&
      segments.every((segment) => docsPageSlug.safeParse(segment).success)
    )
  }, 'caminho inválido')
  .refine(
    (value) =>
      !(DEV_RESERVED_SEGMENTS as readonly string[]).includes(
        value.split('/')[0],
      ),
    'caminho reservado',
  )

/** Frontmatter of a `content/dev/**.mdx` file. */
export const DevPageFrontmatterSchema = z.object({
  title: z.string().trim().min(2).max(90),
  description: z.string().trim().min(20).max(220),
  section: z.enum(DEV_SECTION_SLUGS),
  /** Position inside the sidebar group. */
  order: z.number().int().min(0).max(999),
})

export type DevPageFrontmatter = z.infer<typeof DevPageFrontmatterSchema>
