'use client'

import {
  Add01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  Search01Icon,
  StarIcon,
  Tag01Icon,
  UserGroupIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { crmSitesKeys } from '@/src/hooks/use-crm-sites'
import {
  siteBlogApi,
  siteBlogKeys,
  useSitePosts,
} from '@/src/hooks/use-site-blog'
import { formatSiteDate } from '@/src/lib/sites/blog/format'
import {
  BLOG_TEMPLATE_KEYS,
  BLOG_TEMPLATE_LABELS,
  isBlogTemplateKey,
} from '@/src/lib/sites/blog/templates'
import type { SitePostStatusDTO } from '@/src/schemas/site-blog.schema'
import type { SiteGlobalDTO } from '@/types/site'
import { useSiteEditor } from '../site-editor-context'
import { useOpenTarget } from '../use-open-target'
import { BlogAuthorsDialog } from './blog-authors-dialog'
import { BlogTermsDialog } from './blog-terms-dialog'
import { PostStatusBadge } from './post-status-badge'

/**
 * "Blog" tab of the site editor: the posts (search, status filter, bulk
 * publish/draft/feature/delete), a new post, categories/tags and authors,
 * and the blog page templates opened in the canvas. Posts go live on their
 * own; the templates are published with the site.
 */

type StatusFilter = 'ALL' | SitePostStatusDTO

const STATUS_LABELS: Record<StatusFilter, string> = {
  ALL: 'Todos',
  PUBLISHED: 'Publicados',
  SCHEDULED: 'Agendados',
  DRAFT: 'Rascunhos',
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

function Templates({ templates }: { templates: SiteGlobalDTO[] }) {
  const { workspaceId, site, globals, setGlobals, canEdit } = useSiteEditor()
  const openTarget = useOpenTarget()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      const created = await siteBlogApi(workspaceId, site.id).ensureTemplates()
      const ids = new Set(globals.map((global) => global.id))
      setGlobals([...globals, ...created.filter((item) => !ids.has(item.id))])
      void queryClient.invalidateQueries({
        queryKey: crmSitesKeys.globals(workspaceId, site.id),
      })
      notify.success(
        'Páginas do blog criadas. Publique o site para colocá-las no ar.',
      )
    } catch (error) {
      notify.error(error, 'Não foi possível criar as páginas do blog')
    } finally {
      setBusy(false)
    }
  }

  if (templates.length === 0) {
    return (
      <div className='grid gap-2 rounded-lg border border-dashed p-3'>
        <p className='font-medium text-sm'>Páginas do blog</p>
        <p className='text-muted-foreground text-xs'>
          O blog já funciona com um layout padrão. Crie as páginas para editar
          no canvas a página do blog, do post, das categorias, das tags e do
          autor.
        </p>
        <Button
          size='sm'
          variant='outline'
          className='justify-self-start'
          disabled={!canEdit || busy}
          onClick={() => void create()}
        >
          Personalizar páginas do blog
        </Button>
      </div>
    )
  }

  const byKey = new Map(templates.map((global) => [global.name, global]))
  return (
    <div className='grid gap-1.5'>
      <p className='font-medium text-muted-foreground text-xs'>
        Páginas do blog (modelos)
      </p>
      <ul className='grid gap-1'>
        {BLOG_TEMPLATE_KEYS.map((key) => {
          const global = byKey.get(key)
          return (
            <li key={key}>
              {global ? (
                <button
                  type='button'
                  className='flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  onClick={() =>
                    void openTarget({ kind: 'global', id: global.id })
                  }
                >
                  {BLOG_TEMPLATE_LABELS[key]}
                  <span className='text-muted-foreground text-xs'>Editar</span>
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {templates.length < BLOG_TEMPLATE_KEYS.length ? (
        <Button
          size='xs'
          variant='ghost'
          className='justify-self-start'
          disabled={busy}
          onClick={() => void create()}
        >
          Recriar páginas que faltam
        </Button>
      ) : null}
    </div>
  )
}

export function BlogPanel() {
  const { workspaceId, slug, site, globals, canEdit, canDelete } =
    useSiteEditor()
  const { save } = useCanvasEditor()
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useMemo(
    () => siteBlogApi(workspaceId, site.id),
    [workspaceId, site.id],
  )
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [authorsOpen, setAuthorsOpen] = useState(false)
  const query = useDebounced(search.trim(), 300)
  const posts = useSitePosts(workspaceId, site.id, {
    search: query || undefined,
    status: status === 'ALL' ? undefined : status,
    pageSize: 50,
  })
  const items = posts.data?.items ?? []
  const templates = globals.filter(
    (global) => global.kind === 'TEMPLATE' && isBlogTemplateKey(global.name),
  )
  const timezone = site.settings.timezone

  const postHref = (postId: string) =>
    `/${slug}/crm/sites/${site.id}/blog/${postId}`

  async function openPost(postId: string) {
    // Leave the canvas saved: the post editor is another screen.
    await save()
    router.push(postHref(postId))
  }

  async function createPost() {
    setCreating(true)
    try {
      const post = await api.createPost({ title: 'Novo post' })
      await openPost(post.id)
    } catch (error) {
      notify.error(error, 'Não foi possível criar o post')
      setCreating(false)
    }
  }

  async function bulk(
    action: 'publish' | 'draft' | 'feature' | 'unfeature' | 'delete',
  ) {
    const ids = [...selected]
    if (
      action === 'delete' &&
      !window.confirm(
        ids.length === 1
          ? 'Excluir o post selecionado? Isso não pode ser desfeito.'
          : `Excluir ${ids.length} posts? Isso não pode ser desfeito.`,
      )
    ) {
      return
    }
    try {
      const result = await api.bulkPosts({ ids, action })
      setSelected(new Set())
      await queryClient.invalidateQueries({
        queryKey: siteBlogKeys.all(workspaceId, site.id),
      })
      notify.success(
        result.affected === 1
          ? '1 post atualizado.'
          : `${result.affected} posts atualizados.`,
      )
    } catch (error) {
      notify.error(error, 'Não foi possível aplicar a ação')
    }
  }

  const allSelected =
    items.length > 0 && items.every((post) => selected.has(post.id))

  return (
    <div className='flex flex-col gap-4 p-3' data-testid='site-blog-panel'>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='font-semibold text-sm'>Blog</h2>
        <Button
          size='sm'
          disabled={!canEdit || creating}
          onClick={() => void createPost()}
        >
          <SteelIcon icon={Add01Icon} data-icon='inline-start' />
          Novo post
        </Button>
      </div>

      <div className='grid gap-2'>
        <div className='relative'>
          <SteelIcon
            icon={Search01Icon}
            className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            aria-label='Buscar posts'
            placeholder='Buscar posts'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='h-8 pl-8'
          />
        </div>
        <Select
          value={status}
          onValueChange={(next) => next && setStatus(next as StatusFilter)}
        >
          <SelectTrigger aria-label='Filtrar por status' className='h-8 w-full'>
            <SelectValue>
              {(value: string | null) =>
                STATUS_LABELS[(value ?? 'ALL') as StatusFilter]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((value) => (
              <SelectItem key={value} value={value}>
                {STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 ? (
        <div
          role='toolbar'
          aria-label='Ações em massa'
          className='grid gap-2 rounded-lg border bg-muted/40 p-2'
        >
          <p className='text-xs'>
            {selected.size === 1
              ? '1 post selecionado'
              : `${selected.size} posts selecionados`}
          </p>
          <div className='flex flex-wrap gap-1'>
            <Button
              size='xs'
              variant='outline'
              onClick={() => void bulk('publish')}
            >
              Publicar
            </Button>
            <Button
              size='xs'
              variant='outline'
              onClick={() => void bulk('draft')}
            >
              Rascunho
            </Button>
            <Button
              size='xs'
              variant='outline'
              onClick={() => void bulk('feature')}
            >
              Destacar
            </Button>
            <Button
              size='xs'
              variant='outline'
              onClick={() => void bulk('unfeature')}
            >
              Tirar destaque
            </Button>
            {canDelete ? (
              <Button
                size='xs'
                variant='outline'
                className='text-destructive'
                onClick={() => void bulk('delete')}
              >
                <SteelIcon icon={Delete02Icon} data-icon='inline-start' />
                Excluir
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {posts.isLoading ? (
        <div className='grid gap-2'>
          <Skeleton className='h-12' />
          <Skeleton className='h-12' />
          <Skeleton className='h-12' />
        </div>
      ) : items.length === 0 ? (
        <p className='rounded-lg border border-dashed p-3 text-center text-muted-foreground text-xs'>
          {query || status !== 'ALL'
            ? 'Nenhum post com esses filtros.'
            : 'Nenhum post ainda. Escreva o primeiro em “Novo post”.'}
        </p>
      ) : (
        <div className='grid gap-1'>
          <div className='flex items-center gap-2 px-1'>
            <Checkbox
              id='site-blog-select-all'
              checked={allSelected}
              onCheckedChange={(next) =>
                setSelected(
                  next ? new Set(items.map((post) => post.id)) : new Set(),
                )
              }
            />
            <Label
              htmlFor='site-blog-select-all'
              className='font-normal text-muted-foreground text-xs'
            >
              Selecionar todos
            </Label>
          </div>
          <ul className='grid gap-1'>
            {items.map((post) => (
              <li
                key={post.id}
                className='group flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-muted/60'
              >
                <Checkbox
                  aria-label={`Selecionar ${post.title}`}
                  className='mt-0.5'
                  checked={selected.has(post.id)}
                  onCheckedChange={(next) =>
                    setSelected((current) => {
                      const copy = new Set(current)
                      if (next) copy.add(post.id)
                      else copy.delete(post.id)
                      return copy
                    })
                  }
                />
                <button
                  type='button'
                  className='grid min-w-0 flex-1 gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  onClick={() => void openPost(post.id)}
                >
                  <span className='flex items-center gap-1 truncate font-medium text-sm'>
                    {post.featured ? (
                      <SteelIcon
                        icon={StarIcon}
                        className='size-3.5 shrink-0 text-primary'
                        aria-label='Em destaque'
                      />
                    ) : null}
                    <span className='truncate'>{post.title}</span>
                  </span>
                  <span className='flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs'>
                    <PostStatusBadge status={post.status} />
                    {post.publishedAt
                      ? formatSiteDate(post.publishedAt, timezone)
                      : null}
                  </span>
                </button>
                <SteelIcon
                  icon={PencilEdit02Icon}
                  className='mt-1 size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100'
                />
              </li>
            ))}
          </ul>
          {(posts.data?.total ?? 0) > items.length ? (
            <p className='px-1 text-muted-foreground text-xs'>
              Mostrando {items.length} de {posts.data?.total}. Use a busca para
              achar os outros.
            </p>
          ) : null}
        </div>
      )}

      <div className='grid gap-1 border-t pt-3'>
        <Button
          variant='ghost'
          size='sm'
          className='justify-start'
          onClick={() => setTermsOpen(true)}
        >
          <SteelIcon icon={Tag01Icon} data-icon='inline-start' />
          Categorias e tags
        </Button>
        <Button
          variant='ghost'
          size='sm'
          className='justify-start'
          onClick={() => setAuthorsOpen(true)}
        >
          <SteelIcon icon={UserGroupIcon} data-icon='inline-start' />
          Autores
        </Button>
      </div>

      <Templates templates={templates} />

      <BlogTermsDialog
        open={termsOpen}
        onOpenChange={setTermsOpen}
        workspaceId={workspaceId}
        siteId={site.id}
        api={api}
      />
      <BlogAuthorsDialog
        open={authorsOpen}
        onOpenChange={setAuthorsOpen}
        workspaceId={workspaceId}
        siteId={site.id}
        api={api}
      />
    </div>
  )
}
