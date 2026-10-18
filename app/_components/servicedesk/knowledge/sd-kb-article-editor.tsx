'use client'

import {
  Archive01Icon,
  CloudUploadIcon,
  Copy01Icon,
  Delete02Icon,
  Globe02Icon,
  GlobeOffIcon,
  Image01Icon,
  InternetIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  SidebarRightIcon,
  SmileIcon,
  SquareLock02Icon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import type { Value } from 'platejs'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AiFeedbackControl } from '@/app/_components/steel-ai-quality/ai-feedback-buttons'
import { KB_EDITOR_COLUMN, KbRichEditor } from '@/components/editor/kb-editor'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from '@/components/ui/emoji-picker'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { uploadSdKbMediaXhr } from '@/src/hooks/use-sd-kb-media'
import {
  type UpdateSdKbArticleInput,
  useArchiveSdKbArticle,
  useDeleteSdKbArticle,
  useSdKbArticle,
  useSdKbCategories,
  useSdKbRelated,
  useSetSdKbArticleStatus,
  useUpdateSdKbArticle,
} from '@/src/hooks/use-sd-knowledge'
import type { SdKbArticleDTO } from '@/types/sd-kb-article'
import { SD_TONE_TEXT } from '../sd-tone'
import { SdKbArticleHeader } from './sd-kb-article-header'
import { SdKbArticleList } from './sd-kb-article-list'
import { SdKbArticleMeta } from './sd-kb-article-meta'
import { SdKbArticleView } from './sd-kb-article-view'
import { SdKbReviewPanel } from './sd-kb-review-panel'
import { SdKbReviewDueBadge } from './sd-kb-status-badge'
import { SdKbTagsInput } from './sd-kb-tags-input'
import { SdKbToc } from './sd-kb-toc'
import { SD_KB_STATUS_LABEL, sdKbHelpfulRatio } from './sd-kb-utils'

/**
 * Como na Wiki: o conteúdo vai para o servidor num autosave com debounce
 * (sem Yjs aqui, então o intervalo é menor que o de 1,5 s do Nexo). Título
 * também salva sozinho; metadados salvam na hora.
 */
const CONTENT_AUTOSAVE_MS = 800
const TITLE_AUTOSAVE_MS = 800

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface SdKbArticleEditorProps {
  workspaceId: string
  workspaceSlug: string
  userId: string
  userName: string
  article: SdKbArticleDTO
  canDelete: boolean
}

/** Tela do artigo para agentes: editor Plate completo + metadados da KB. */
export function SdKbArticleEditor({
  workspaceId,
  workspaceSlug,
  userId,
  userName,
  article: initial,
  canDelete,
}: SdKbArticleEditorProps) {
  const router = useRouter()
  const { data: article = initial } = useSdKbArticle(
    workspaceId,
    initial.id,
    initial,
  )
  const update = useUpdateSdKbArticle(workspaceId, initial.id)
  const setStatus = useSetSdKbArticleStatus(workspaceId, initial.id)
  const archive = useArchiveSdKbArticle(workspaceId)
  const remove = useDeleteSdKbArticle(workspaceId)
  const categories = useSdKbCategories(workspaceId)
  const related = useSdKbRelated(workspaceId, initial.id)

  const [title, setTitle] = useState(initial.title)
  const [content, setContent] = useState<Value>(initial.content)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [preview, setPreview] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const pending = useRef<UpdateSdKbArticleInput>({})

  // Sair da página (ou fechar a aba) antes do debounce não perde a última
  // edição: o que estiver pendente vai num PATCH `keepalive`.
  useEffect(() => {
    const url = `/api/workspaces/${workspaceId}/servicedesk/knowledge/${initial.id}`
    function sendPending() {
      const data = pending.current
      if (Object.keys(data).length === 0) return
      pending.current = {}
      void fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', sendPending)
    return () => {
      window.removeEventListener('beforeunload', sendPending)
      if (contentTimer.current) clearTimeout(contentTimer.current)
      if (titleTimer.current) clearTimeout(titleTimer.current)
      sendPending()
    }
  }, [workspaceId, initial.id])

  function save(data: UpdateSdKbArticleInput) {
    setSaveState('saving')
    update.mutate(data, {
      onSuccess: () => setSaveState('saved'),
      onError: (error) => {
        setSaveState('error')
        notify.error(error)
      },
    })
  }

  function flush() {
    const data = pending.current
    pending.current = {}
    if (Object.keys(data).length > 0) save(data)
  }

  function scheduleContent(value: Value) {
    setContent(value)
    pending.current.content = value
    setSaveState('saving')
    if (contentTimer.current) clearTimeout(contentTimer.current)
    contentTimer.current = setTimeout(flush, CONTENT_AUTOSAVE_MS)
  }

  function scheduleTitle(value: string) {
    setTitle(value)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => {
      if (value !== article.title) save({ title: value })
    }, TITLE_AUTOSAVE_MS)
  }

  async function uploadCover(file: File) {
    setUploadingCover(true)
    try {
      const media = await uploadSdKbMediaXhr(
        workspaceId,
        article.id,
        file,
        () => {},
      )
      save({ coverImage: media.url })
    } catch (error) {
      notify.error(error, 'Erro ao enviar a capa')
    } finally {
      setUploadingCover(false)
    }
  }

  function togglePublish() {
    const next = article.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
    setStatus.mutate(next, {
      onSuccess: () =>
        notify.success(
          next === 'PUBLISHED'
            ? 'Artigo publicado'
            : 'Artigo voltou a rascunho',
        ),
      onError: notify.error,
    })
  }

  async function copyLink() {
    const url = `${window.location.origin}/${workspaceSlug}/servicedesk/knowledge/${article.id}`
    try {
      await navigator.clipboard.writeText(url)
      notify.success('Link copiado')
    } catch {
      notify.error('Não foi possível copiar o link')
    }
  }

  const published = article.status === 'PUBLISHED'
  const editorSelector = `[data-kb-editor="${article.id}"]`
  const ratio = sdKbHelpfulRatio(article)
  const categoryName =
    categories.data?.find((c) => c.id === article.categoryId)?.name ??
    article.category?.name

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* Standard header: `<` + Base de conhecimento > [name]. The actions go
          on the right of this same row. Publication state is a single icon
          toggle, and the KCS review plus the other side panels live in a
          drawer, so the text gets the whole width. */}
      <SdKbArticleHeader
        workspaceSlug={workspaceSlug}
        title={title}
        actions={
          <>
            <SdKbReviewDueBadge reviewDueAt={article.reviewDueAt} />
            <SaveIndicator state={saveState} />
            <Button
              variant={preview ? 'secondary' : 'ghost'}
              size='sm'
              aria-pressed={preview}
              onClick={() => {
                flush()
                setPreview((v) => !v)
              }}
            >
              <SteelIcon
                icon={preview ? PencilEdit02Icon : ViewIcon}
                strokeWidth={2}
              />
              {preview ? 'Editar' : 'Visualizar'}
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={published ? 'Despublicar' : 'Publicar'}
                    data-status={article.status}
                    disabled={setStatus.isPending}
                    onClick={togglePublish}
                  >
                    <SteelIcon
                      icon={published ? InternetIcon : GlobeOffIcon}
                      strokeWidth={2}
                      className={cn(published && SD_TONE_TEXT.emerald)}
                    />
                  </Button>
                }
              />
              <TooltipContent>
                {SD_KB_STATUS_LABEL[article.status]} ·{' '}
                {published ? 'clique para despublicar' : 'clique para publicar'}
              </TooltipContent>
            </Tooltip>
            <Drawer swipeDirection='right'>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DrawerTrigger
                      render={
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          aria-label='Revisão e detalhes'
                        />
                      }
                    />
                  }
                >
                  <SteelIcon icon={SidebarRightIcon} strokeWidth={2} />
                </TooltipTrigger>
                <TooltipContent>Revisão e detalhes</TooltipContent>
              </Tooltip>
              <DrawerContent className='data-[swipe-axis=x]:sm:[--drawer-content-width:26rem]'>
                <DrawerHeader className='pb-3'>
                  <DrawerTitle>Revisão e detalhes</DrawerTitle>
                  <DrawerDescription>
                    Ciclo KCS, propriedades e artigos relacionados.
                  </DrawerDescription>
                </DrawerHeader>
                <Tabs
                  defaultValue='review'
                  className='flex min-h-0 flex-1 flex-col gap-0'
                >
                  <TabsList className='mx-4 w-auto'>
                    <TabsTrigger value='review'>Revisão</TabsTrigger>
                    <TabsTrigger value='properties'>Propriedades</TabsTrigger>
                  </TabsList>
                  <div className='mt-3 min-h-0 flex-1 overflow-y-auto border-t p-4'>
                    <TabsContent value='review' className='space-y-6'>
                      <SdKbReviewPanel
                        workspaceId={workspaceId}
                        article={article}
                      />
                      {article.sourceTicketId ? (
                        <section className='space-y-2 rounded-lg border p-3 text-sm'>
                          <p className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                            Rascunho da IA
                          </p>
                          <AiFeedbackControl
                            workspaceId={workspaceId}
                            surface='SD_KCS_DRAFT'
                            targetId={article.id}
                            label='O rascunho gerado a partir do chamado ajudou?'
                          />
                        </section>
                      ) : null}
                      <section className='space-y-1 rounded-lg border p-3 text-sm'>
                        <p className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                          Utilidade
                        </p>
                        <p>
                          👍 {article.helpfulCount} · 👎{' '}
                          {article.notHelpfulCount}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          {ratio === null
                            ? 'Ainda sem votos.'
                            : `${ratio}% acharam útil`}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          Resolveu {article.reuseCount}{' '}
                          {article.reuseCount === 1 ? 'chamado' : 'chamados'}
                        </p>
                      </section>
                      <SdKbToc
                        content={content}
                        containerSelector={editorSelector}
                      />
                      {(related.data?.length ?? 0) > 0 && (
                        <section className='space-y-1'>
                          <p className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                            Relacionados
                          </p>
                          <SdKbArticleList
                            articles={related.data ?? []}
                            hrefFor={(a) =>
                              `/${workspaceSlug}/servicedesk/knowledge/${a.id}`
                            }
                          />
                        </section>
                      )}
                    </TabsContent>
                    <TabsContent value='properties' className='space-y-6'>
                      <PropertyField label='Visibilidade'>
                        <fieldset
                          aria-label='Visibilidade'
                          className='m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0'
                        >
                          {(['INTERNAL', 'PORTAL'] as const).map((v) => {
                            const active = article.visibility === v
                            return (
                              <button
                                key={v}
                                type='button'
                                aria-pressed={active}
                                onClick={() =>
                                  !active && save({ visibility: v })
                                }
                                className={cn(
                                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                                  active
                                    ? 'border-primary bg-primary/5 text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                )}
                              >
                                <SteelIcon
                                  icon={
                                    v === 'PORTAL'
                                      ? Globe02Icon
                                      : SquareLock02Icon
                                  }
                                  size={16}
                                  strokeWidth={2}
                                  className={cn(active && 'text-primary')}
                                />
                                {v === 'PORTAL' ? 'Portal' : 'Interno'}
                              </button>
                            )
                          })}
                        </fieldset>
                        <p className='text-muted-foreground text-xs'>
                          {article.visibility === 'PORTAL'
                            ? published
                              ? 'Visível para solicitantes no portal.'
                              : 'Vai aparecer no portal quando publicado.'
                            : 'Só agentes veem este artigo.'}
                        </p>
                      </PropertyField>
                      <PropertyField label='Categoria'>
                        <Select
                          value={article.categoryId ?? '__none__'}
                          onValueChange={(v) =>
                            save({
                              categoryId: v === '__none__' ? null : String(v),
                            })
                          }
                        >
                          <SelectTrigger
                            aria-label='Categoria'
                            className='w-full'
                          >
                            <span>{categoryName ?? 'Sem categoria'}</span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='__none__'>
                              Sem categoria
                            </SelectItem>
                            {categories.data?.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </PropertyField>
                      <PropertyField label='Tags'>
                        <SdKbTagsInput
                          value={article.tags}
                          onChange={(tags) => save({ tags })}
                        />
                      </PropertyField>
                      <PropertyField label='Informações'>
                        <SdKbArticleMeta article={article} />
                      </PropertyField>
                    </TabsContent>
                  </div>
                </Tabs>
              </DrawerContent>
            </Drawer>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Mais ações'
                  >
                    <SteelIcon icon={MoreHorizontalIcon} strokeWidth={2} />
                  </Button>
                }
              />
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={copyLink}>
                  <SteelIcon icon={Copy01Icon} strokeWidth={2} />
                  Copiar link
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    archive.mutate(article.id, {
                      onSuccess: () => {
                        notify.success('Artigo arquivado')
                        router.push(`/${workspaceSlug}/servicedesk/knowledge`)
                      },
                      onError: notify.error,
                    })
                  }
                >
                  <SteelIcon icon={Archive01Icon} strokeWidth={2} />
                  Arquivar
                </DropdownMenuItem>
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant='destructive'
                      onClick={() => {
                        if (
                          window.confirm(
                            'Excluir definitivamente este artigo e os subartigos?',
                          )
                        ) {
                          remove.mutate(article.id, {
                            onSuccess: () => {
                              notify.success('Artigo excluído')
                              router.push(
                                `/${workspaceSlug}/servicedesk/knowledge`,
                              )
                            },
                            onError: notify.error,
                          })
                        }
                      }}
                    >
                      <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                      Excluir
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {preview ? (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <SdKbArticleView
            workspaceId={workspaceId}
            article={{ ...article, title, content }}
            showStatus
            recordView={false}
            hrefForRelated={(a) =>
              `/${workspaceSlug}/servicedesk/knowledge/${a.id}`
            }
          />
        </div>
      ) : (
        // The editor owns the layout: a full-width toolbar that never scrolls
        // and, below it, one scroll area with the title and the text in the
        // same centered column.
        <div
          data-kb-editor={article.id}
          className='flex min-h-0 flex-1 flex-col'
        >
          <KbRichEditor
            key={article.id}
            workspaceId={workspaceId}
            articleId={article.id}
            userId={userId}
            userName={userName}
            content={initial.content}
            onChange={scheduleContent}
            className='flex-1'
            header={
              <>
                <div className='group/cover relative'>
                  {article.coverImage ? (
                    <img
                      src={article.coverImage}
                      alt=''
                      className='h-44 w-full object-cover'
                    />
                  ) : null}
                  <input
                    ref={coverInput}
                    type='file'
                    accept='image/png,image/jpeg,image/webp,image/gif'
                    className='hidden'
                    aria-label='Arquivo da capa'
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void uploadCover(file)
                      e.target.value = ''
                    }}
                  />
                </div>
                <div className={cn(KB_EDITOR_COLUMN, 'pt-6')}>
                  <div className='mb-2 flex flex-wrap items-center gap-1 text-muted-foreground'>
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button variant='ghost' size='xs'>
                            {article.icon ? (
                              <span className='text-base'>{article.icon}</span>
                            ) : (
                              <SteelIcon icon={SmileIcon} strokeWidth={2} />
                            )}
                            {article.icon ? 'Trocar ícone' : 'Adicionar ícone'}
                          </Button>
                        }
                      />
                      <PopoverContent className='h-80 w-72 p-0'>
                        <EmojiPicker
                          className='h-full'
                          onEmojiSelect={({ emoji }) => save({ icon: emoji })}
                        >
                          <EmojiPickerSearch />
                          <EmojiPickerContent />
                          <EmojiPickerFooter />
                        </EmojiPicker>
                      </PopoverContent>
                    </Popover>
                    {article.icon && (
                      <Button
                        variant='ghost'
                        size='xs'
                        onClick={() => save({ icon: null })}
                      >
                        Remover ícone
                      </Button>
                    )}
                    <Button
                      variant='ghost'
                      size='xs'
                      disabled={uploadingCover}
                      onClick={() => coverInput.current?.click()}
                    >
                      <SteelIcon
                        icon={uploadingCover ? Loading03Icon : Image01Icon}
                        strokeWidth={2}
                        className={cn(uploadingCover && 'animate-spin')}
                      />
                      {article.coverImage ? 'Trocar capa' : 'Adicionar capa'}
                    </Button>
                    {article.coverImage && (
                      <Button
                        variant='ghost'
                        size='xs'
                        onClick={() => save({ coverImage: null })}
                      >
                        Remover capa
                      </Button>
                    )}
                  </div>

                  {article.icon && (
                    <div className='mb-1 text-5xl'>{article.icon}</div>
                  )}
                  <input
                    aria-label='Título do artigo'
                    value={title}
                    onChange={(e) => scheduleTitle(e.target.value)}
                    onBlur={() => {
                      if (titleTimer.current) clearTimeout(titleTimer.current)
                      if (title !== article.title) save({ title })
                    }}
                    placeholder='Sem título'
                    maxLength={255}
                    className='w-full bg-transparent font-semibold text-3xl tracking-tight outline-none placeholder:text-muted-foreground/60'
                  />
                </div>
              </>
            }
          />
        </div>
      )}
    </div>
  )
}

function PropertyField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <section className='space-y-2'>
      <p className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
        {label}
      </p>
      {children}
    </section>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  const map = {
    saving: { icon: Loading03Icon, text: 'Salvando…', spin: true },
    saved: { icon: CloudUploadIcon, text: 'Salvo', spin: false },
    error: { icon: CloudUploadIcon, text: 'Erro ao salvar', spin: false },
  } as const
  const { icon, text, spin } = map[state]
  return (
    <span
      role='status'
      aria-live='polite'
      className={cn(
        'inline-flex items-center gap-1 text-muted-foreground text-xs',
        state === 'error' && 'text-destructive',
      )}
    >
      <SteelIcon
        icon={icon}
        size={13}
        strokeWidth={2}
        className={cn(spin && 'animate-spin')}
      />
      {text}
    </span>
  )
}
