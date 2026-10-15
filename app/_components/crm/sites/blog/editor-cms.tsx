'use client'

import { useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useSiteBlogCategories,
  useSiteBlogTags,
  useSiteCmsPreview,
  useSiteCollections,
} from '@/src/hooks/use-site-blog'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import type { SiteCmsContext } from '@/src/lib/canvas-site/cms'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { SITE_CMS_FIELD_LABELS } from '@/src/lib/sites/blog/collections'
import { type CmsRequest, cmsResolver } from '@/src/lib/sites/blog/resolve'
import { collectionIdOfTemplate } from '@/src/lib/sites/blog/templates'
import type { SiteGlobalDTO } from '@/types/site'
import { type SiteEditorTarget, useSiteEditor } from '../site-editor-context'

/**
 * Blog and collection content of the editor canvas: the site's posts
 * (drafts included), terms and items — or the sample blog when there is
 * no post yet — resolved for what is being edited (a page, the post
 * template with the newest post, an archive template with its first term,
 * a collection item template with its first item). Lists follow the
 * inspector live (`postList`/`collectionList`).
 */
export function useEditorCms(
  workspaceId: string,
  siteId: string,
  target: SiteEditorTarget,
  globals: SiteGlobalDTO[],
  timezone?: string,
): SiteCmsContext | undefined {
  const preview = useSiteCmsPreview(workspaceId, siteId)
  const data = preview.data
  return useMemo(() => {
    if (!data) return undefined
    const global =
      target.kind === 'global'
        ? globals.find((item) => item.id === target.id)
        : undefined
    const key = global?.kind === 'TEMPLATE' ? global.name : null
    const request: CmsRequest = {
      path: '/blog',
      blogRoute: null,
      page: 1,
      query: '',
    }
    const { blog } = data
    if (key === 'blog-index') request.blogRoute = { kind: 'index' }
    if (key === 'blog-post' && data.post) {
      request.blogRoute = { kind: 'post', slug: data.post.slug }
      request.post = data.post
    }
    if (key === 'blog-category' && blog.categories[0]) {
      request.blogRoute = { kind: 'category', slug: blog.categories[0].slug }
    }
    if (key === 'blog-tag' && blog.tags[0]) {
      request.blogRoute = { kind: 'tag', slug: blog.tags[0].slug }
    }
    if (key === 'blog-author' && blog.authors[0]) {
      request.blogRoute = { kind: 'author', slug: blog.authors[0].slug }
    }
    const collectionId = key ? collectionIdOfTemplate(key) : null
    const first = collectionId
      ? data.collections[collectionId]?.items[0]
      : undefined
    if (collectionId && first) {
      request.item = { collectionId, itemId: first.id }
    }
    return cmsResolver({
      blog,
      collections: data.collections,
      request,
      href: (path) => path,
      timezone,
      sample: data.sample,
    })
  }, [data, target, globals, timezone])
}

const NONE = '__none'

function TermPicker({
  value,
  onChange,
  kind,
}: CustomControlProps & { kind: 'category' | 'tag' }) {
  const { workspaceId, site } = useSiteEditor()
  const categories = useSiteBlogCategories(workspaceId, site.id)
  const tags = useSiteBlogTags(workspaceId, site.id)
  const terms = (kind === 'category' ? categories.data : tags.data) ?? []
  const current = typeof value === 'string' && value ? value : NONE
  return (
    <Select
      value={current}
      onValueChange={(next) => {
        if (typeof next !== 'string') return
        onChange(next === NONE ? '' : next)
      }}
    >
      <SelectTrigger className='h-8 w-full text-xs'>
        <SelectValue>
          {(selected: string | null) =>
            !selected || selected === NONE
              ? kind === 'category'
                ? 'Todas as categorias'
                : 'Todas as tags'
              : (terms.find((term) => term.slug === selected)?.name ?? selected)
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          {kind === 'category' ? 'Todas as categorias' : 'Todas as tags'}
        </SelectItem>
        {terms.map((term) => (
          <SelectItem key={term.id} value={term.slug}>
            {term.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Inspector control: a blog category of the site (by slug). */
export function SiteBlogCategoryPicker(props: CustomControlProps) {
  return <TermPicker {...props} kind='category' />
}

/** Inspector control: a blog tag of the site (by slug). */
export function SiteBlogTagPicker(props: CustomControlProps) {
  return <TermPicker {...props} kind='tag' />
}

/** Inspector control of `site.collection-list`: a collection of the site. */
export function SiteCollectionPicker({ value, onChange }: CustomControlProps) {
  const { workspaceId, site } = useSiteEditor()
  const collections = useSiteCollections(workspaceId, site.id)
  const list = collections.data ?? []
  const current = typeof value === 'string' && value ? value : NONE
  return (
    <div className='grid gap-1.5'>
      <Select
        value={current}
        onValueChange={(next) => {
          if (typeof next !== 'string') return
          onChange(next === NONE ? '' : next)
        }}
      >
        <SelectTrigger className='h-8 w-full text-xs'>
          <SelectValue>
            {(selected: string | null) =>
              !selected || selected === NONE
                ? 'Escolha uma coleção'
                : (list.find((item) => item.id === selected)?.name ??
                  'Coleção removida')
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Nenhuma</SelectItem>
          {list.map((collection) => (
            <SelectItem key={collection.id} value={collection.id}>
              {collection.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {list.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Crie uma coleção na aba Coleções.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Inspector control of a collection field: the fields of the list's
 * collection (`site.collection-list`) or of the collection whose item
 * template is open (`site.collection-field`).
 */
export function SiteCollectionFieldPicker({
  value,
  onChange,
  node,
}: CustomControlProps) {
  const { workspaceId, site, target, globals } = useSiteEditor()
  const collections = useSiteCollections(workspaceId, site.id)
  const global = globals.find(
    (item) => target.kind === 'global' && item.id === target.id,
  )
  const collectionId =
    node.type === SITE_TYPES.collectionList
      ? String(node.props.collectionId ?? '')
      : global?.kind === 'TEMPLATE'
        ? collectionIdOfTemplate(global.name)
        : null
  const collection = collections.data?.find((item) => item.id === collectionId)
  const fields = [
    ...(node.type === SITE_TYPES.collectionField
      ? [{ key: 'title', label: 'Título do item', type: 'text' as const }]
      : []),
    ...(collection?.fields ?? []),
  ]
  const current = typeof value === 'string' && value ? value : NONE
  return (
    <Select
      value={current}
      onValueChange={(next) => {
        if (typeof next !== 'string') return
        onChange(next === NONE ? '' : next)
      }}
    >
      <SelectTrigger className='h-8 w-full text-xs'>
        <SelectValue>
          {(selected: string | null) =>
            !selected || selected === NONE
              ? 'Nenhum'
              : (fields.find((field) => field.key === selected)?.label ??
                selected)
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Nenhum</SelectItem>
        {fields.map((field) => (
          <SelectItem key={field.key} value={field.key}>
            {field.label}
            <span className='ml-auto text-muted-foreground text-xs'>
              {SITE_CMS_FIELD_LABELS[field.type]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
