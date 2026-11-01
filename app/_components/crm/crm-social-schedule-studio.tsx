'use client'

import {
  Calendar01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Delete02Icon,
  ImageAdd02Icon,
  SentIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useRef, useState } from 'react'
import { CRM_SOCIAL_PLATFORM_META } from '@/app/_components/crm/social/social-platform-meta'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCancelCrmScheduledPost,
  useCreateCrmScheduledPost,
  useCrmScheduledPosts,
  useCrmSocialConnections,
  useDeleteCrmScheduledPost,
  usePublishCrmScheduledPost,
  useRescheduleCrmScheduledPost,
} from '@/src/hooks/use-crm-social'
import {
  CRM_INSTAGRAM_POST_TYPE_MEDIA,
  CRM_PLATFORM_MEDIA_REQUIREMENT,
  CRM_PLATFORM_TEXT_LIMIT,
  CRM_PUBLISHABLE_PLATFORMS,
  type CrmPublishablePlatform,
} from '@/src/schemas/crm-social.schema'
import type { CrmInstagramPostType } from '@/src/schemas/crm-social-instagram.schema'
import type {
  CrmScheduledPostDTO,
  CrmScheduledPostStatusDTO,
  CrmScheduledPostTargetStatusDTO,
} from '@/types/crm-social'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function metaFor(platform: CrmPublishablePlatform) {
  return CRM_SOCIAL_PLATFORM_META.find((m) => m.platform === platform)
}

const STATUS_LABEL: Record<CrmScheduledPostStatusDTO, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendado',
  PUBLISHING: 'Publicando',
  PUBLISHED: 'Publicado',
  PARTIALLY_FAILED: 'Parcial',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
}

const STATUS_COLOR: Record<CrmScheduledPostStatusDTO, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-blue-500/10 text-blue-600',
  PUBLISHING: 'bg-amber-500/10 text-amber-600',
  PUBLISHED: 'bg-green-500/10 text-green-600',
  PARTIALLY_FAILED: 'bg-orange-500/10 text-orange-600',
  FAILED: 'bg-destructive/10 text-destructive',
  CANCELED: 'bg-muted text-muted-foreground',
}

const TARGET_COLOR: Record<CrmScheduledPostTargetStatusDTO, string> = {
  PENDING: 'text-muted-foreground',
  PUBLISHING: 'text-amber-600',
  PUBLISHED: 'text-green-600',
  FAILED: 'text-destructive',
  CANCELED: 'text-muted-foreground line-through',
}

const INSTAGRAM_POST_TYPE_LABELS: Record<CrmInstagramPostType, string> = {
  FEED: 'Publicação (feed)',
  REELS: 'Reels',
  STORIES: 'Stories',
}

/* -------------------------------- Composer -------------------------------- */

function Composer({
  workspaceId,
  connected,
  onCreated,
}: {
  workspaceId: string
  connected: Set<CrmPublishablePlatform>
  onCreated: () => void
}) {
  const createPost = useCreateCrmScheduledPost(workspaceId)
  const fileRef = useRef<HTMLInputElement>(null)

  const [platforms, setPlatforms] = useState<CrmPublishablePlatform[]>([])
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [mode, setMode] = useState<'now' | 'schedule'>('schedule')
  const [scheduledFor, setScheduledFor] = useState('')
  const [igPostType, setIgPostType] = useState<CrmInstagramPostType>('FEED')
  const [youtubePrivacy, setYoutubePrivacy] = useState<
    'public' | 'unlisted' | 'private'
  >('public')
  const [tiktokPrivacy, setTiktokPrivacy] = useState<
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY'
  >('SELF_ONLY')

  const hasImage = files.some((f) => f.type.startsWith('image/'))
  const hasVideo = files.some((f) => f.type.startsWith('video/'))
  const needsInstagram = platforms.includes('INSTAGRAM')
  const needsYoutube = platforms.includes('YOUTUBE')
  const needsTiktok = platforms.includes('TIKTOK')

  const textLimit = platforms.length
    ? Math.min(...platforms.map((p) => CRM_PLATFORM_TEXT_LIMIT[p]))
    : 5000

  function toggle(platform: CrmPublishablePlatform) {
    if (!connected.has(platform)) return
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((p) => p !== platform)
        : [...current, platform],
    )
  }

  function validate(): string | null {
    if (platforms.length === 0) return 'Selecione ao menos uma plataforma.'
    if (content.length > textLimit) {
      return `O texto excede o limite de ${textLimit} caracteres.`
    }
    for (const platform of platforms) {
      if (platform === 'INSTAGRAM') {
        const req = CRM_INSTAGRAM_POST_TYPE_MEDIA[igPostType]
        if (req === 'image' && !hasImage) {
          return `${INSTAGRAM_POST_TYPE_LABELS[igPostType]} no Instagram exige uma imagem.`
        }
        if (req === 'video' && !hasVideo) {
          return `${INSTAGRAM_POST_TYPE_LABELS[igPostType]} no Instagram exige um vídeo.`
        }
        if (req === 'either' && !hasImage && !hasVideo) {
          return `${INSTAGRAM_POST_TYPE_LABELS[igPostType]} no Instagram exige uma imagem ou vídeo.`
        }
        continue
      }
      const req = CRM_PLATFORM_MEDIA_REQUIREMENT[platform]
      const label = metaFor(platform)?.label ?? platform
      if (req === 'image' && !hasImage) return `${label} exige uma imagem.`
      if (req === 'video' && !hasVideo) return `${label} exige um vídeo.`
    }
    if (mode === 'schedule') {
      if (!scheduledFor) return 'Informe a data e hora do agendamento.'
      if (new Date(scheduledFor).getTime() <= Date.now()) {
        return 'A data do agendamento deve estar no futuro.'
      }
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      notify.error(problem)
      return
    }
    try {
      await createPost.mutateAsync({
        content,
        title: title.trim() || undefined,
        mode,
        scheduledFor:
          mode === 'schedule'
            ? new Date(scheduledFor).toISOString()
            : undefined,
        platforms,
        options: {
          instagram: needsInstagram ? { postType: igPostType } : undefined,
          youtube: needsYoutube
            ? { privacy: youtubePrivacy, tags: [] }
            : undefined,
          tiktok: needsTiktok
            ? {
                privacy: tiktokPrivacy,
                disableComment: false,
                disableDuet: false,
                disableStitch: false,
              }
            : undefined,
        },
        media: files,
      })
      notify.success(
        mode === 'now' ? 'Publicação enviada!' : 'Post agendado com sucesso!',
      )
      setPlatforms([])
      setContent('')
      setTitle('')
      setFiles([])
      setScheduledFor('')
      setIgPostType('FEED')
      if (fileRef.current) fileRef.current.value = ''
      onCreated()
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <Card className='p-4 sm:p-6'>
      <form onSubmit={handleSubmit} className='flex flex-col gap-5'>
        <div className='space-y-2'>
          <span className='font-medium text-sm'>Plataformas</span>
          <div className='flex flex-wrap gap-2'>
            {CRM_PUBLISHABLE_PLATFORMS.map((platform) => {
              const meta = metaFor(platform)
              const isConnected = connected.has(platform)
              const isOn = platforms.includes(platform)
              return (
                <button
                  key={platform}
                  type='button'
                  disabled={!isConnected}
                  onClick={() => toggle(platform)}
                  title={
                    isConnected
                      ? undefined
                      : 'Conecte esta conta no studio da plataforma (menu Social)'
                  }
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isOn
                      ? 'border-primary bg-primary/5'
                      : 'border-border/70 hover:bg-muted/50'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {meta && (
                    <span
                      className={`flex size-5 items-center justify-center rounded ${meta.color}`}
                    >
                      <SteelIcon
                        icon={meta.icon}
                        strokeWidth={2}
                        className='size-3 text-white'
                      />
                    </span>
                  )}
                  {meta?.label ?? platform}
                  {isOn && (
                    <SteelIcon
                      icon={CheckmarkCircle02Icon}
                      strokeWidth={2}
                      className='size-3.5 text-primary'
                    />
                  )}
                </button>
              )
            })}
          </div>
          {platforms.some(
            (p) => CRM_PLATFORM_MEDIA_REQUIREMENT[p] === 'video',
          ) && (
            <p className='text-muted-foreground text-xs'>
              YouTube e TikTok exigem um arquivo de vídeo.
            </p>
          )}
        </div>

        {needsInstagram && (
          <div className='space-y-2'>
            <span className='font-medium text-sm'>
              Modelo de post (Instagram)
            </span>
            <Select
              items={(['FEED', 'REELS', 'STORIES'] as const).map((v) => ({
                value: v,
                label: INSTAGRAM_POST_TYPE_LABELS[v],
              }))}
              value={igPostType}
              onValueChange={(v) =>
                v && setIgPostType(v as CrmInstagramPostType)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(['FEED', 'REELS', 'STORIES'] as const).map((v) => (
                    <SelectItem key={v} value={v}>
                      {INSTAGRAM_POST_TYPE_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              {igPostType === 'FEED' &&
                'Publicação no feed — exige uma imagem.'}
              {igPostType === 'REELS' && 'Reels — exige um arquivo de vídeo.'}
              {igPostType === 'STORIES' &&
                'Stories (24h) — aceita imagem ou vídeo.'}
            </p>
          </div>
        )}

        {needsYoutube && (
          <FieldGroup>
            <Field>
              <span className='font-medium text-sm'>Título (YouTube)</span>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='Título do vídeo'
                maxLength={100}
              />
            </Field>
          </FieldGroup>
        )}

        <div className='space-y-2'>
          <span className='font-medium text-sm'>Conteúdo</span>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder='Escreva o texto do post…'
            rows={5}
            maxLength={textLimit}
            className='resize-none'
          />
          <span className='text-muted-foreground text-xs'>
            {content.length}/{textLimit}
          </span>
        </div>

        <div className='space-y-2'>
          <span className='font-medium text-sm'>Mídia</span>
          <Input
            ref={fileRef}
            type='file'
            accept='image/*,video/*'
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 && (
            <ul className='space-y-1 text-muted-foreground text-xs'>
              {files.map((f) => (
                <li key={f.name} className='flex items-center gap-1.5'>
                  <SteelIcon icon={ImageAdd02Icon} strokeWidth={2} />
                  {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)
                </li>
              ))}
            </ul>
          )}
        </div>

        {(needsYoutube || needsTiktok) && (
          <div className='grid gap-4 sm:grid-cols-2'>
            {needsYoutube && (
              <div className='space-y-2'>
                <span className='font-medium text-sm'>
                  Privacidade (YouTube)
                </span>
                <Select
                  items={[
                    { value: 'public', label: 'Público' },
                    { value: 'unlisted', label: 'Não listado' },
                    { value: 'private', label: 'Privado' },
                  ]}
                  value={youtubePrivacy}
                  onValueChange={(v) =>
                    v && setYoutubePrivacy(v as typeof youtubePrivacy)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value='public'>Público</SelectItem>
                      <SelectItem value='unlisted'>Não listado</SelectItem>
                      <SelectItem value='private'>Privado</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}
            {needsTiktok && (
              <div className='space-y-2'>
                <span className='font-medium text-sm'>
                  Privacidade (TikTok)
                </span>
                <Select
                  items={[
                    { value: 'PUBLIC_TO_EVERYONE', label: 'Público' },
                    { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Amigos' },
                    { value: 'FOLLOWER_OF_CREATOR', label: 'Seguidores' },
                    { value: 'SELF_ONLY', label: 'Somente eu' },
                  ]}
                  value={tiktokPrivacy}
                  onValueChange={(v) =>
                    v && setTiktokPrivacy(v as typeof tiktokPrivacy)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value='PUBLIC_TO_EVERYONE'>
                        Público
                      </SelectItem>
                      <SelectItem value='MUTUAL_FOLLOW_FRIENDS'>
                        Amigos
                      </SelectItem>
                      <SelectItem value='FOLLOWER_OF_CREATOR'>
                        Seguidores
                      </SelectItem>
                      <SelectItem value='SELF_ONLY'>Somente eu</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <div className='space-y-2'>
          <span className='font-medium text-sm'>Quando publicar</span>
          <div className='flex flex-wrap items-center gap-3'>
            <Button
              type='button'
              variant={mode === 'now' ? 'default' : 'outline'}
              size='sm'
              onClick={() => setMode('now')}
            >
              Agora
            </Button>
            <Button
              type='button'
              variant={mode === 'schedule' ? 'default' : 'outline'}
              size='sm'
              onClick={() => setMode('schedule')}
            >
              Agendar
            </Button>
            {mode === 'schedule' && (
              <Input
                type='datetime-local'
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className='w-auto'
              />
            )}
          </div>
        </div>

        <div className='flex justify-end'>
          <Button type='submit' disabled={createPost.isPending}>
            <SteelIcon
              icon={mode === 'now' ? SentIcon : Calendar01Icon}
              strokeWidth={2}
              className='mr-1.5 size-4'
            />
            {createPost.isPending
              ? 'Enviando…'
              : mode === 'now'
                ? 'Publicar agora'
                : 'Agendar'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ---------------------------------- List ---------------------------------- */

function RescheduleButton({
  workspaceId,
  postId,
}: {
  workspaceId: string
  postId: string
}) {
  const [editing, setEditing] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')
  const reschedule = useRescheduleCrmScheduledPost(workspaceId)

  async function save() {
    if (!scheduledFor) {
      setEditing(false)
      return
    }
    try {
      await reschedule.mutateAsync({
        postId,
        scheduledFor: new Date(scheduledFor).toISOString(),
      })
      notify.success('Post reagendado')
      setEditing(false)
      setScheduledFor('')
    } catch (err) {
      notify.error(err)
    }
  }

  if (editing) {
    return (
      <div className='flex items-center gap-1.5'>
        <Input
          autoFocus
          type='datetime-local'
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
          className='h-7 w-auto text-xs'
        />
        <Button
          size='xs'
          onClick={save}
          disabled={reschedule.isPending || !scheduledFor}
        >
          Salvar
        </Button>
      </div>
    )
  }

  return (
    <Button variant='outline' size='xs' onClick={() => setEditing(true)}>
      <SteelIcon icon={Calendar01Icon} strokeWidth={2} />
      Reagendar
    </Button>
  )
}

function PostCard({
  post,
  workspaceId,
  onCancel,
  onPublish,
  onDelete,
  publishing,
  canceling,
}: {
  post: CrmScheduledPostDTO
  workspaceId: string
  onCancel: () => void
  onPublish: () => void
  onDelete: () => void
  publishing: boolean
  canceling: boolean
}) {
  const canCancel =
    post.status === 'SCHEDULED' ||
    post.status === 'FAILED' ||
    post.status === 'PARTIALLY_FAILED'
  const canPublishNow =
    post.status !== 'PUBLISHED' && post.status !== 'PUBLISHING'

  return (
    <Card className='flex flex-col gap-3 p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <span
            className={`rounded-full px-2 py-0.5 font-medium text-xs ${STATUS_COLOR[post.status]}`}
          >
            {STATUS_LABEL[post.status]}
          </span>
          {post.scheduledFor && (
            <span className='flex items-center gap-1 text-muted-foreground text-xs'>
              <SteelIcon
                icon={Clock01Icon}
                strokeWidth={2}
                className='size-3.5'
              />
              {dateFmt.format(new Date(post.scheduledFor))}
            </span>
          )}
        </div>
        {canCancel && (
          <Button
            variant='ghost'
            size='icon-xs'
            onClick={onCancel}
            disabled={canceling}
            title='Cancelar agendamento'
            className='text-destructive hover:text-destructive'
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        )}
      </div>

      {post.content && (
        <p className='line-clamp-3 whitespace-pre-wrap break-words text-sm'>
          {post.content}
        </p>
      )}

      <div className='flex flex-wrap items-center gap-3'>
        {post.targets?.map((t) => {
          const meta = metaFor(t.platform as CrmPublishablePlatform)
          return (
            <span
              key={t.id}
              className={`flex items-center gap-1.5 text-xs ${TARGET_COLOR[t.status]}`}
              title={t.error ?? undefined}
            >
              {meta && (
                <span
                  className={`flex size-4 items-center justify-center rounded ${meta.color}`}
                >
                  <SteelIcon
                    icon={meta.icon}
                    strokeWidth={2}
                    className='size-2.5 text-white'
                  />
                </span>
              )}
              {meta?.label ?? t.platform}
            </span>
          )
        })}
        {post.media && post.media.length > 0 && (
          <span className='text-muted-foreground text-xs'>
            {post.media.length} mídia(s)
          </span>
        )}
      </div>

      {post.lastError && (
        <p className='text-destructive text-xs'>{post.lastError}</p>
      )}

      <div className='flex items-center justify-end gap-2 border-border/60 border-t pt-3'>
        {canPublishNow && (
          <Button
            variant='outline'
            size='xs'
            onClick={onPublish}
            disabled={publishing}
          >
            <SteelIcon icon={SentIcon} strokeWidth={2} />
            Publicar agora
          </Button>
        )}
        {canCancel && (
          <RescheduleButton workspaceId={workspaceId} postId={post.id} />
        )}
        <Button
          variant='ghost'
          size='icon-xs'
          onClick={onDelete}
          title='Excluir'
        >
          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </div>
    </Card>
  )
}

/* --------------------------------- Studio --------------------------------- */

export function CrmSocialScheduleStudio({
  workspaceId,
}: {
  workspaceId: string
}) {
  const { data: posts, isLoading, refetch } = useCrmScheduledPosts(workspaceId)
  const { data: connections } = useCrmSocialConnections(workspaceId)
  const deletePost = useDeleteCrmScheduledPost(workspaceId)
  const publishPost = usePublishCrmScheduledPost(workspaceId)
  const cancelPost = useCancelCrmScheduledPost(workspaceId)

  const connected = useMemo(() => {
    const set = new Set<CrmPublishablePlatform>()
    for (const c of connections ?? []) {
      if (
        c.status === 'CONNECTED' &&
        (CRM_PUBLISHABLE_PLATFORMS as readonly string[]).includes(c.platform)
      ) {
        set.add(c.platform as CrmPublishablePlatform)
      }
    }
    return set
  }, [connections])

  async function handleDelete(postId: string) {
    try {
      await deletePost.mutateAsync(postId)
      notify.success('Post removido')
    } catch (err) {
      notify.error(err)
    }
  }

  async function handlePublish(postId: string) {
    try {
      await publishPost.mutateAsync(postId)
      notify.success('Tentativa de publicação registrada')
    } catch (err) {
      notify.error(err)
    }
  }

  async function handleCancel(postId: string) {
    try {
      await cancelPost.mutateAsync(postId)
      notify.success('Post cancelado')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='mx-auto w-full max-w-5xl'>
      <header className='mb-6'>
        <h2 className='font-heading font-semibold text-xl tracking-tight'>
          Agendar posts
        </h2>
        <p className='text-muted-foreground text-sm'>
          Componha uma vez e publique em várias redes — agora ou na data
          marcada.
        </p>
      </header>

      <div className='grid gap-8 lg:grid-cols-[1fr_400px]'>
        <Composer
          workspaceId={workspaceId}
          connected={connected}
          onCreated={refetch}
        />

        <div className='space-y-3'>
          <h3 className='font-heading font-semibold text-base text-muted-foreground tracking-tight'>
            Agendamentos
          </h3>
          {isLoading ? (
            <div className='space-y-3'>
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-24 w-full' />
            </div>
          ) : posts?.length === 0 ? (
            <p className='rounded-lg border border-border/60 border-dashed p-6 text-center text-muted-foreground text-sm'>
              Nenhum post agendado ainda.
            </p>
          ) : (
            <div className='space-y-3'>
              {posts?.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  workspaceId={workspaceId}
                  onCancel={() => handleCancel(post.id)}
                  onPublish={() => handlePublish(post.id)}
                  onDelete={() => handleDelete(post.id)}
                  publishing={publishPost.isPending}
                  canceling={cancelPost.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
