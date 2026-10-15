'use client'

import {
  AiMagicIcon,
  ArrowLeft01Icon,
  LinkSquare02Icon,
  Settings02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import type { Value } from 'platejs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { ApiError } from '@/src/hooks/_fetch'
import { crmSitesApi, crmSitesKeys } from '@/src/hooks/use-crm-sites'
import {
  siteBlogApi,
  siteBlogKeys,
  useSitePost,
} from '@/src/hooks/use-site-blog'
import type { PlateValue } from '@/src/lib/sites/blog/plate'
import type {
  SitePostSeoDTO,
  SitePostStatusDTO,
  UpdateSitePostDTO,
} from '@/src/schemas/site-blog.schema'
import type { SiteDTO } from '@/types/site'
import type { SitePostDTO } from '@/types/site-blog'
import { runTextAi, WritePostDialog } from './blog-ai'
import { PostBodyEditor } from './post-body-editor'
import { PostSettings } from './post-settings'
import { PostStatusBadge } from './post-status-badge'

/** What the post editor edits (saved with one PATCH). */
export interface PostDraft {
  title: string
  slug: string
  excerpt: string
  content: Value
  coverImageUrl: string | null
  coverImageAlt: string
  authorId: string | null
  categoryIds: string[]
  tagIds: string[]
  newTags: string[]
  featured: boolean
  seo: SitePostSeoDTO
  /** ISO publication date (schedule); `null` = now on publish. */
  publishedAt: string | null
}

export function draftOf(post: SitePostDTO): PostDraft {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? '',
    content: post.content as Value,
    coverImageUrl: post.coverImageUrl,
    coverImageAlt: post.coverImageAlt ?? '',
    authorId: post.author?.id ?? null,
    categoryIds: post.categories.map((term) => term.id),
    tagIds: post.tags.map((term) => term.id),
    newTags: [],
    featured: post.featured,
    seo: post.seo,
    publishedAt: post.publishedAt,
  }
}

/** SEO without the FAQ rows left blank (the API requires both texts). */
export function cleanSeo(seo: SitePostSeoDTO): SitePostSeoDTO {
  if (!seo.search?.questions) return seo
  return {
    ...seo,
    search: {
      ...seo.search,
      questions: seo.search.questions
        .map((item) => ({
          question: item.question.trim(),
          answer: item.answer.trim(),
        }))
        .filter((item) => item.question && item.answer),
    },
  }
}

/** PATCH body of a draft with the requested status. */
export function payloadOf(
  draft: PostDraft,
  status?: SitePostStatusDTO,
  publishNow = false,
): UpdateSitePostDTO {
  return {
    title: draft.title.trim() || 'Sem título',
    slug: draft.slug,
    excerpt: draft.excerpt.trim() || null,
    content: draft.content as PlateValue,
    coverImageUrl: draft.coverImageUrl,
    coverImageAlt: draft.coverImageAlt.trim() || null,
    authorId: draft.authorId,
    categoryIds: draft.categoryIds,
    tagIds: draft.tagIds,
    newTags: draft.newTags,
    featured: draft.featured,
    seo: cleanSeo(draft.seo),
    ...(status
      ? {
          status,
          publishedAt: publishNow
            ? null
            : draft.publishedAt
              ? new Date(draft.publishedAt)
              : null,
        }
      : {}),
  }
}

function EditorSkeleton() {
  return (
    <div className='flex h-full flex-col' aria-busy='true'>
      <Skeleton className='h-12 w-full rounded-none' />
      <div className='flex min-h-0 flex-1 gap-px'>
        <Skeleton className='min-h-0 flex-1 rounded-none opacity-60' />
        <Skeleton className='hidden w-80 rounded-none lg:block' />
      </div>
    </div>
  )
}

/**
 * Full-screen editor of one blog post: title and body (Plate) in the
 * middle, the post settings on the right (a sheet on small screens), save
 * and publish in the top bar, and the AI helpers. Leaving with unsaved
 * changes asks first.
 */
export function PostEditor({
  workspaceId,
  slug,
  siteId,
  postId,
  userId,
  userName,
}: {
  workspaceId: string
  slug: string
  siteId: string
  postId: string
  userId: string
  userName: string
}) {
  const api = useMemo(
    () => siteBlogApi(workspaceId, siteId),
    [workspaceId, siteId],
  )
  const queryClient = useQueryClient()
  const post = useSitePost(workspaceId, siteId, postId)
  const site = useQuery<SiteDTO>({
    queryKey: crmSitesKeys.site(workspaceId, siteId),
    queryFn: () => crmSitesApi(workspaceId).get(siteId),
  })
  const [draft, setDraft] = useState<PostDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bodyKey, setBodyKey] = useState(0)
  const [writeOpen, setWriteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [titles, setTitles] = useState<string[] | null>(null)
  const loaded = useRef<string | null>(null)

  useEffect(() => {
    if (post.data && loaded.current !== post.data.id) {
      loaded.current = post.data.id
      setDraft(draftOf(post.data))
      setDirty(false)
    }
  }, [post.data])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = useCallback((patch: Partial<PostDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    setDirty(true)
  }, [])

  const save = useCallback(
    async (status?: SitePostStatusDTO, publishNow = false) => {
      if (!draft) return false
      setSaving(true)
      try {
        const saved = await api.updatePost(
          postId,
          payloadOf(draft, status, publishNow),
        )
        queryClient.setQueryData(
          siteBlogKeys.post(workspaceId, siteId, postId),
          saved,
        )
        void queryClient.invalidateQueries({
          queryKey: siteBlogKeys.all(workspaceId, siteId),
        })
        setDraft((current) =>
          current
            ? {
                ...current,
                slug: saved.slug,
                tagIds: saved.tags.map((tag) => tag.id),
                newTags: [],
                publishedAt: saved.publishedAt,
              }
            : current,
        )
        setDirty(false)
        if (status === 'PUBLISHED' && saved.status === 'PUBLISHED') {
          notify.success('Post publicado.')
        } else if (saved.status === 'SCHEDULED' && status) {
          notify.success('Post agendado.')
        } else {
          notify.success('Post salvo.')
        }
        return true
      } catch (error) {
        notify.error(error, 'Não foi possível salvar o post')
        return false
      } finally {
        setSaving(false)
      }
    },
    [api, draft, postId, queryClient, siteId, workspaceId],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const back = `/${slug}/crm/sites/${siteId}`

  if (post.error) {
    const missing =
      post.error instanceof ApiError &&
      (post.error.status === 404 || post.error.status === 403)
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
        <p className='max-w-sm text-muted-foreground text-sm'>
          {missing
            ? 'Este post não existe mais ou você não tem acesso a ele.'
            : 'Não foi possível abrir o post. Tente novamente em instantes.'}
        </p>
        <Button
          variant='outline'
          size='sm'
          nativeButton={false}
          render={<Link href={back} />}
        >
          Voltar para o site
        </Button>
      </div>
    )
  }
  if (!post.data || !draft) return <EditorSkeleton />

  const status = post.data.status
  const timezone = site.data?.settings.timezone
  const publicUrl =
    site.data && status === 'PUBLISHED' && site.data.status === 'PUBLISHED'
      ? `${site.data.url}${post.data.path}`
      : null

  const settings = (
    <PostSettings
      workspaceId={workspaceId}
      siteId={siteId}
      api={api}
      draft={draft}
      status={status}
      timezone={timezone}
      onChange={update}
    />
  )

  async function ai(action: 'summary' | 'titles' | 'faq') {
    if (!draft) return
    const result = await runTextAi(api, action, {
      title: draft.title,
      content: draft.content,
      focusKeyword: draft.seo.search?.focusKeyword,
    })
    if (!result) return
    if (action === 'titles') setTitles(result.titles ?? [])
    if (action === 'summary' && result.excerpt) {
      update({
        excerpt: result.excerpt,
        seo: {
          ...draft.seo,
          description: draft.seo.description || result.description,
        },
      })
      notify.success('Resumo sugerido pela IA. Revise antes de salvar.')
    }
    if (action === 'faq' && result.faq?.length) {
      const questions = [...(draft.seo.search?.questions ?? []), ...result.faq]
      update({
        seo: {
          ...draft.seo,
          search: { ...draft.seo.search, questions: questions.slice(0, 20) },
        },
      })
      notify.success(
        `${result.faq.length} perguntas adicionadas ao FAQ. Revise antes de salvar.`,
      )
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Voltar para o editor do site'
          nativeButton={false}
          render={<Link href={back} />}
          onClick={(event) => {
            if (dirty && !window.confirm('Sair sem salvar as alterações?')) {
              event.preventDefault()
            }
          }}
        >
          <SteelIcon icon={ArrowLeft01Icon} />
        </Button>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <p className='hidden truncate font-medium text-sm sm:block'>
            {draft.title || 'Sem título'}
          </p>
          <PostStatusBadge status={status} />
          {dirty ? (
            <Badge variant='outline' className='hidden sm:inline-flex'>
              Não salvo
            </Badge>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant='outline' size='sm'>
                <SteelIcon icon={AiMagicIcon} data-icon='inline-start' />
                <span className='hidden sm:inline'>IA</span>
              </Button>
            }
          />
          <DropdownMenuContent align='end' className='w-56'>
            <DropdownMenuItem onClick={() => setWriteOpen(true)}>
              Escrever post com IA
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void ai('titles')}>
              Sugerir títulos
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void ai('summary')}>
              Gerar resumo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void ai('faq')}>
              Transformar em FAQ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {publicUrl ? (
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Ver no site'
            nativeButton={false}
            render={
              <a href={publicUrl} target='_blank' rel='noopener noreferrer' />
            }
          >
            <SteelIcon icon={LinkSquare02Icon} />
          </Button>
        ) : null}
        <Button
          variant='ghost'
          size='icon-sm'
          className='lg:hidden'
          aria-label='Ajustes do post'
          onClick={() => setSettingsOpen(true)}
        >
          <SteelIcon icon={Settings02Icon} />
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={saving}
          onClick={() => void save()}
        >
          Salvar
        </Button>
        {status === 'PUBLISHED' ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size='sm' disabled={saving}>
                  Publicado
                </Button>
              }
            />
            <DropdownMenuContent align='end' className='w-56'>
              <DropdownMenuItem onClick={() => void save('PUBLISHED')}>
                Atualizar publicação
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void save('DRAFT')}>
                Voltar para rascunho
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size='sm' disabled={saving}>
                  Publicar
                </Button>
              }
            />
            <DropdownMenuContent align='end' className='w-60'>
              <DropdownMenuItem onClick={() => void save('PUBLISHED', true)}>
                Publicar agora
              </DropdownMenuItem>
              {draft.publishedAt &&
              new Date(draft.publishedAt).getTime() > Date.now() ? (
                <DropdownMenuItem onClick={() => void save('SCHEDULED')}>
                  Agendar para a data escolhida
                </DropdownMenuItem>
              ) : null}
              {status === 'SCHEDULED' ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void save('DRAFT')}>
                    Cancelar agendamento
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      <div className='flex min-h-0 flex-1'>
        <main className='min-w-0 flex-1'>
          <PostBodyEditor
            key={bodyKey}
            workspaceId={workspaceId}
            postId={postId}
            userId={userId}
            userName={userName}
            content={draft.content}
            onChange={(content) => update({ content })}
            header={
              <div className='mx-auto grid w-full max-w-[760px] gap-3 px-4 pt-8 sm:px-0'>
                {draft.coverImageUrl ? (
                  <img
                    src={draft.coverImageUrl}
                    alt=''
                    className='aspect-[16/7] w-full rounded-lg object-cover'
                  />
                ) : null}
                <Textarea
                  aria-label='Título do post'
                  value={draft.title}
                  maxLength={200}
                  rows={1}
                  placeholder='Título do post'
                  onChange={(event) => update({ title: event.target.value })}
                  className='field-sizing-content min-h-0 resize-none border-0 bg-transparent px-0 font-bold text-3xl shadow-none focus-visible:ring-0 sm:text-4xl dark:bg-transparent'
                />
                {titles ? (
                  <div className='grid gap-1 rounded-lg border bg-muted/30 p-2'>
                    <p className='px-1 font-medium text-muted-foreground text-xs'>
                      Títulos sugeridos pela IA
                    </p>
                    {titles.map((title) => (
                      <button
                        key={title}
                        type='button'
                        className='rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        onClick={() => {
                          update({ title })
                          setTitles(null)
                        }}
                      >
                        {title}
                      </button>
                    ))}
                    <Button
                      variant='ghost'
                      size='xs'
                      className='justify-self-end'
                      onClick={() => setTitles(null)}
                    >
                      Fechar
                    </Button>
                  </div>
                ) : null}
              </div>
            }
          />
        </main>
        <aside
          aria-label='Ajustes do post'
          className='hidden w-80 shrink-0 overflow-y-auto border-l lg:block'
        >
          {settings}
        </aside>
      </div>
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent
          side='right'
          className='w-full overflow-y-auto sm:max-w-sm'
        >
          <SheetHeader>
            <SheetTitle>Ajustes do post</SheetTitle>
          </SheetHeader>
          {settings}
        </SheetContent>
      </Sheet>
      <WritePostDialog
        open={writeOpen}
        onOpenChange={setWriteOpen}
        api={api}
        focusKeyword={draft.seo.search?.focusKeyword}
        onApply={(result) => {
          update({
            title: result.title || draft.title,
            excerpt: result.excerpt ?? draft.excerpt,
            content: (result.content as Value) ?? draft.content,
            seo: {
              ...draft.seo,
              description: draft.seo.description || result.description,
            },
          })
          // The body editor keeps its own value: remount it with the draft.
          setBodyKey((key) => key + 1)
          notify.success('Rascunho da IA aplicado. Revise antes de salvar.')
        }}
      />
    </div>
  )
}
