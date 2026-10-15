import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { SiteCmsFieldType } from '@/src/lib/canvas-site/cms'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  box,
  heading,
  type NodeSpec,
  section,
  spec,
  text,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'

/**
 * Templates of the dynamic pages (blog index, single post, category, tag
 * and author archives, collection item). Each is a `TEMPLATE` global whose
 * `name` is the key below, edited in the canvas like any page and
 * published with the site. A site without one renders the default built
 * here, so the blog works before anyone touches a template.
 */

export const BLOG_TEMPLATE_KEYS = [
  'blog-index',
  'blog-post',
  'blog-category',
  'blog-tag',
  'blog-author',
] as const
export type BlogTemplateKey = (typeof BLOG_TEMPLATE_KEYS)[number]

export const COLLECTION_TEMPLATE_PREFIX = 'collection:'

export type SiteTemplateKey = BlogTemplateKey | `collection:${string}`

export const BLOG_TEMPLATE_LABELS: Record<BlogTemplateKey, string> = {
  'blog-index': 'Página do blog',
  'blog-post': 'Post',
  'blog-category': 'Categoria',
  'blog-tag': 'Tag',
  'blog-author': 'Autor',
}

export function isBlogTemplateKey(key: string): key is BlogTemplateKey {
  return (BLOG_TEMPLATE_KEYS as readonly string[]).includes(key)
}

export function collectionTemplateKey(collectionId: string): string {
  return `${COLLECTION_TEMPLATE_PREFIX}${collectionId}`
}

/** Collection id of a `collection:<id>` key (`null` otherwise). */
export function collectionIdOfTemplate(key: string): string | null {
  return key.startsWith(COLLECTION_TEMPLATE_PREFIX)
    ? key.slice(COLLECTION_TEMPLATE_PREFIX.length) || null
    : null
}

export function isTemplateKey(key: string): key is SiteTemplateKey {
  return isBlogTemplateKey(key) || collectionIdOfTemplate(key) !== null
}

/** Label of a template in the editor (`Modelo: Post`). */
export function templateLabel(
  key: string,
  collectionName?: (id: string) => string | undefined,
): string {
  if (isBlogTemplateKey(key)) return `Modelo: ${BLOG_TEMPLATE_LABELS[key]}`
  const collectionId = collectionIdOfTemplate(key)
  const name = collectionId ? collectionName?.(collectionId) : undefined
  return name ? `Modelo: item de ${name}` : 'Modelo: item da coleção'
}

/** Which template a missing one falls back to (archives share the index
 * layout with the archive header on). */
export const TEMPLATE_FALLBACK: Partial<
  Record<BlogTemplateKey, BlogTemplateKey>
> = {
  'blog-category': 'blog-index',
  'blog-tag': 'blog-index',
  'blog-author': 'blog-index',
}

const narrow = { maxWidth: { base: 1120 } }

function archiveList(extra: Record<string, unknown> = {}): NodeSpec {
  return spec(SITE_TYPES.postList, {
    source: 'archive',
    perPage: 9,
    pagination: true,
    ...extra,
  })
}

function sidebar(): NodeSpec {
  return box({ gap: 32 }, [
    spec(SITE_TYPES.blogSearch, { maxWidth: { value: 100, unit: '%' } }),
    spec(SITE_TYPES.postTerms, { title: 'Categorias' }),
    spec(SITE_TYPES.postTerms, {
      taxonomy: 'tags',
      title: 'Tags',
      display: 'chips',
      showCount: false,
    }),
  ])
}

const BUILDERS: Record<BlogTemplateKey, () => NodeSpec[]> = {
  'blog-index': () => [
    section({ ...narrow }, [
      heading('h1', 'Blog'),
      text('Novidades, dicas e conteúdos sobre o nosso trabalho.', {
        preset: 'lead',
      }),
    ]),
    section({ ...narrow }, [
      archiveList({ featuredFirst: true, showArchiveHeader: false }),
    ]),
  ],
  'blog-post': () => [
    section({ ...narrow }, [spec(SITE_TYPES.post, {})]),
    section({ ...narrow }, [
      box({ maxWidth: { base: { value: 760, unit: 'px' } }, gap: 24 }, [
        spec(SITE_TYPES.postAuthor, {}),
      ]),
    ]),
    section({ ...narrow }, [
      heading('h2', 'Leia também'),
      spec(SITE_TYPES.postList, { source: 'related', perPage: 3 }),
    ]),
  ],
  'blog-category': () => [
    section({ ...narrow }, [
      box(
        {
          layout: 'grid',
          columns: { base: 2, tablet: 1, mobile: 1 },
          columnsTemplate: { base: '2fr 1fr', tablet: '1fr' },
          gap: { base: 48, mobile: 32 },
        },
        [
          box({ gap: 24 }, [
            archiveList({
              showArchiveHeader: true,
              columns: { base: 2, tablet: 2, mobile: 1 },
            }),
          ]),
          sidebar(),
        ],
      ),
    ]),
  ],
  'blog-tag': () => [
    section({ ...narrow }, [
      archiveList({ showArchiveHeader: true, layout: 'list' }),
    ]),
  ],
  'blog-author': () => [
    section({ ...narrow }, [
      spec(SITE_TYPES.postAuthor, { linkName: false }),
      archiveList({ showArchiveHeader: false }),
    ]),
  ],
}

/** Default document of a blog template. */
export function defaultBlogTemplate(key: BlogTemplateKey): CanvasDocument {
  return toDocument(BUILDERS[key]())
}

export interface TemplateField {
  key: string
  label: string
  type: SiteCmsFieldType
}

/** Default item page of a collection: the title, the first image and
 * every other field with its label. */
export function defaultCollectionTemplate(
  fields: TemplateField[],
): CanvasDocument {
  const image = fields.find((field) => field.type === 'image')
  const rest = fields.filter((field) => field !== image)
  const children: NodeSpec[] = [
    spec(SITE_TYPES.collectionField, {
      fieldKey: 'title',
      display: 'heading',
      level: 'h1',
    }),
  ]
  if (image) {
    children.push(
      spec(SITE_TYPES.collectionField, {
        fieldKey: image.key,
        display: 'auto',
      }),
    )
  }
  for (const field of rest) {
    children.push(
      spec(SITE_TYPES.collectionField, {
        fieldKey: field.key,
        display: 'auto',
        label: field.type === 'richtext' ? '' : `${field.label}:`,
      }),
    )
  }
  return toDocument([
    section({ maxWidth: { base: 880 } }, [box({ gap: 24 }, children)]),
  ])
}
