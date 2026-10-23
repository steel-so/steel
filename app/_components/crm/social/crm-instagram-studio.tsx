'use client'

import {
  Analytics01Icon,
  Bookmark01Icon,
  Comment01Icon,
  EyeIcon,
  FavouriteIcon,
  InstagramIcon,
  PlayIcon,
  Share08Icon,
  UserMultipleIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { ResponsiveLine } from '@nivo/line'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { AiTextarea } from '@/components/ui/ai-text-field'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { GhostAiProvider } from '@/components/ui/ghost-ai'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  CrmSocialApiError,
  isCrmSocialReconnectError,
  useCrmInstagramEngagement,
  useCrmInstagramInsights,
  useCrmInstagramMedia,
  useCrmInstagramOverview,
  useCrmInstagramStories,
  useDeleteCrmInstagramMedia,
  usePublishCrmInstagramPost,
} from '@/src/hooks/use-crm-social-instagram'
import { useCrmTextAi } from '@/src/hooks/use-crm-text-ai'
import {
  CRM_INSTAGRAM_POST_TYPE_LABELS,
  type CrmInstagramActiveStory,
  type CrmInstagramInsightsRange,
  type CrmInstagramMedia,
  type CrmInstagramMediaEngagement,
  type CrmInstagramPostType,
} from '@/src/schemas/crm-social-instagram.schema'
import {
  CHART_THEME,
  formatAxisLabel,
  getFortnightKey,
  toNivoSeries,
} from './chart-utils'

const nf = new Intl.NumberFormat('pt-BR')

const RANGES: { value: CrmInstagramInsightsRange; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '28d', label: '28 dias' },
  { value: '90d', label: '90 dias' },
]

const POST_TYPES: CrmInstagramPostType[] = ['FEED', 'REELS', 'STORIES']

function StatCard({
  icon,
  label,
  value,
}: {
  icon: typeof EyeIcon
  label: string
  value: number
}) {
  return (
    <Card size='sm' className='gap-1 px-4 py-3'>
      <div className='flex items-center gap-1.5 text-muted-foreground text-xs'>
        <SteelIcon icon={icon} className='size-3.5' />
        {label}
      </div>
      <span className='font-heading font-semibold text-2xl tabular-nums tracking-tight'>
        {nf.format(value)}
      </span>
    </Card>
  )
}

/** Card de um post do "Top 5 mais quentes (7d)" — capa + métricas somadas. */
function TopMediaCard({
  item,
  rank,
}: {
  item: CrmInstagramMediaEngagement
  rank: number
}) {
  const imgSrc = item.mediaType === 'VIDEO' ? item.thumbnailUrl : item.mediaUrl
  const card = (
    <Card className='group relative overflow-hidden p-0'>
      <span className='absolute top-2 left-2 z-10 flex size-5 items-center justify-center rounded-full bg-black/70 font-semibold text-[11px] text-white'>
        {rank}
      </span>
      <div className='aspect-square w-full bg-muted'>
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={item.caption ?? ''}
            className='size-full object-cover transition-transform group-hover:scale-[1.03]'
          />
        ) : (
          <div className='flex size-full items-center justify-center text-muted-foreground/30'>
            <SteelIcon icon={InstagramIcon} className='size-8' />
          </div>
        )}
        <div className='absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-[11px] text-white'>
          <span className='flex items-center gap-1 tabular-nums'>
            <SteelIcon icon={FavouriteIcon} className='size-3' />
            {nf.format(item.likeCount)}
          </span>
          <span className='flex items-center gap-1 tabular-nums'>
            <SteelIcon icon={Comment01Icon} className='size-3' />
            {nf.format(item.commentsCount)}
          </span>
          <span className='flex items-center gap-1 tabular-nums'>
            <SteelIcon icon={Bookmark01Icon} className='size-3' />
            {nf.format(item.saved)}
          </span>
        </div>
      </div>
    </Card>
  )

  if (!item.permalink) return card
  return (
    <a
      href={item.permalink}
      target='_blank'
      rel='noreferrer'
      className='block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      {card}
    </a>
  )
}

function ReconnectNotice({
  workspaceId,
  message,
}: {
  workspaceId: string
  message: string
}) {
  return (
    <div className='mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center'>
      <div className='flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-card/70 text-muted-foreground'>
        <SteelIcon icon={InstagramIcon} className='size-6' />
      </div>
      <div className='space-y-1.5'>
        <h2 className='font-heading font-semibold text-xl tracking-tight'>
          Conecte o Instagram
        </h2>
        <p className='text-muted-foreground text-sm'>{message}</p>
      </div>
      <a
        href={`/api/workspaces/${workspaceId}/crm/social/instagram/connect`}
        className={buttonVariants()}
      >
        Conectar conta
      </a>
    </div>
  )
}

function InstagramPostPreview({
  username,
  avatarUrl,
  caption,
  previewFile,
}: {
  username: string
  avatarUrl?: string | null
  caption: string
  previewFile?: File
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(previewFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [previewFile])

  const isVideo = previewFile?.type.startsWith('video/')

  return (
    <div className='w-full overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm'>
      <div className='flex items-center gap-2.5 px-3 py-3'>
        <div className='rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-0.5'>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={username}
              className='size-9 rounded-full border-2 border-background object-cover'
            />
          ) : (
            <div className='flex size-9 items-center justify-center rounded-full bg-background'>
              <SteelIcon
                icon={InstagramIcon}
                className='size-5 text-pink-500'
              />
            </div>
          )}
        </div>
        <span className='font-semibold text-sm'>{username || 'username'}</span>
        <span className='ml-auto select-none text-lg text-muted-foreground leading-none'>
          ···
        </span>
      </div>

      <div className='aspect-square w-full bg-muted'>
        {previewUrl ? (
          isVideo ? (
            // biome-ignore lint/a11y/useMediaCaption: preview local, sem faixa de legenda disponível
            <video
              src={previewUrl}
              className='size-full object-cover'
              controls
            />
          ) : (
            <img
              src={previewUrl}
              alt='preview'
              className='size-full object-cover'
            />
          )
        ) : (
          <div className='flex size-full flex-col items-center justify-center gap-3 text-muted-foreground/30'>
            <SteelIcon icon={InstagramIcon} className='size-14' />
            <span className='text-sm'>Selecione uma mídia</span>
          </div>
        )}
      </div>

      <div className='space-y-2.5 px-3 py-3'>
        <div className='flex items-center gap-4'>
          <SteelIcon icon={FavouriteIcon} className='size-6' />
          <SteelIcon icon={Comment01Icon} className='size-6' />
          <SteelIcon icon={Share08Icon} className='size-6' />
          <SteelIcon icon={Bookmark01Icon} className='ml-auto size-6' />
        </div>
        {caption ? (
          <p className='break-words text-sm leading-snug'>
            <span className='font-semibold'>{username}</span>{' '}
            <span className='line-clamp-3'>{caption}</span>
          </p>
        ) : (
          <p className='text-muted-foreground/40 text-sm italic'>
            A legenda aparecerá aqui…
          </p>
        )}
      </div>
    </div>
  )
}

function StoryCard({
  story,
  deleting,
  onDelete,
}: {
  story: CrmInstagramActiveStory
  deleting: boolean
  onDelete: () => void
}) {
  const date = story.timestamp
    ? new Date(story.timestamp).toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'short',
      })
    : null

  return (
    <Card className='group relative shrink-0 overflow-hidden p-0'>
      <div className='aspect-[9/16] w-28 bg-muted'>
        {story.mediaUrl ? (
          <img src={story.mediaUrl} alt='' className='size-full object-cover' />
        ) : (
          <div className='flex size-full items-center justify-center text-muted-foreground/30'>
            <SteelIcon icon={InstagramIcon} className='size-6' />
          </div>
        )}
      </div>
      <div className='absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-[10px] text-white'>
        {date && <span>{date}</span>}
        <span className='flex items-center gap-0.5 tabular-nums'>
          <SteelIcon icon={EyeIcon} className='size-2.5' />
          {story.reach}
        </span>
      </div>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <button
              type='button'
              className='absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100'
              aria-label='Excluir story'
            >
              ×
            </button>
          }
        />
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir story</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita — a story será removida do
              Instagram.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={deleting}
              onClick={onDelete}
            >
              {deleting ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function InstagramMediaModal({
  item,
  username,
  avatarUrl,
  deleting,
  onDelete,
}: {
  item: CrmInstagramMedia
  username: string
  avatarUrl?: string | null
  deleting: boolean
  onDelete: () => void
}) {
  const date = item.timestamp
    ? new Date(item.timestamp).toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  return (
    <div className='flex h-full flex-col overflow-hidden rounded-xl md:flex-row'>
      <div className='relative flex min-h-[260px] items-center justify-center bg-black md:min-h-0 md:w-[58%]'>
        {item.mediaType === 'VIDEO' && item.mediaUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: mídia do Instagram não fornece faixas de legenda
          <video
            src={item.mediaUrl}
            poster={item.thumbnailUrl ?? undefined}
            controls
            autoPlay
            className='max-h-[65vh] w-full'
          />
        ) : item.mediaUrl ? (
          <img
            src={item.mediaUrl}
            alt={item.caption ?? ''}
            className='max-h-[65vh] w-full object-contain'
          />
        ) : (
          <div className='flex flex-col items-center justify-center gap-2 text-white/20'>
            <SteelIcon icon={InstagramIcon} className='size-14' />
          </div>
        )}
      </div>

      <div className='flex min-h-0 flex-col md:w-[42%]'>
        <div className='flex shrink-0 items-center gap-2.5 border-b border-border/60 px-4 py-3'>
          <div className='rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-0.5'>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={username}
                className='size-9 rounded-full border-2 border-background object-cover'
              />
            ) : (
              <div className='flex size-9 items-center justify-center rounded-full bg-background'>
                <SteelIcon
                  icon={InstagramIcon}
                  className='size-4 text-pink-500'
                />
              </div>
            )}
          </div>
          <span className='font-semibold text-sm'>{username}</span>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto p-4'>
          {item.caption ? (
            <p className='text-sm leading-relaxed'>
              <span className='font-semibold'>{username}</span> {item.caption}
            </p>
          ) : null}
          {date && (
            <p className='mt-3 text-muted-foreground text-xs uppercase tracking-wide'>
              {date}
            </p>
          )}
        </div>

        <div className='shrink-0 space-y-3 border-t border-border/60 px-4 py-3'>
          <div className='flex items-center gap-4'>
            <SteelIcon icon={FavouriteIcon} className='size-6' />
            <SteelIcon icon={Comment01Icon} className='size-6' />
            <SteelIcon icon={Share08Icon} className='size-6' />
            <SteelIcon icon={Bookmark01Icon} className='ml-auto size-6' />
          </div>
          {item.permalink && (
            <a
              href={item.permalink}
              target='_blank'
              rel='noreferrer'
              className={`${buttonVariants({ variant: 'outline', size: 'sm' })} block w-full text-center`}
            >
              Abrir no Instagram
            </a>
          )}

          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='w-full text-destructive hover:text-destructive'
                >
                  Excluir publicação
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir publicação</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação não pode ser desfeita — a publicação será removida
                  do Instagram.
                  {item.mediaType === 'CAROUSEL_ALBUM' &&
                    ' O álbum inteiro será excluído (não é possível remover apenas um item do carrossel).'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  variant='destructive'
                  disabled={deleting}
                  onClick={onDelete}
                >
                  {deleting ? 'Excluindo…' : 'Excluir'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}

function PostComposer({
  workspaceId,
  connectionId,
  caption,
  onCaptionChange,
  postType,
  onPostTypeChange,
  onMediaChange,
  onCoverChange,
}: {
  workspaceId: string
  connectionId?: string
  caption: string
  onCaptionChange: (v: string) => void
  postType: CrmInstagramPostType
  onPostTypeChange: (v: CrmInstagramPostType) => void
  onMediaChange: (f: File | undefined) => void
  onCoverChange: (f: File | undefined) => void
}) {
  const publish = usePublishCrmInstagramPost(workspaceId, connectionId)
  const assistText = useCrmTextAi(workspaceId, 'SOCIAL', () => ({
    platform: `Instagram · ${postType === 'REELS' ? 'Reels' : postType === 'STORIES' ? 'Stories' : 'Feed'}`,
  }))

  const mediaAccept =
    postType === 'REELS'
      ? 'video/*'
      : postType === 'STORIES'
        ? 'image/*,video/*'
        : 'image/*'
  const mediaHint =
    postType === 'REELS'
      ? 'Vídeo obrigatório (Reels).'
      : postType === 'STORIES'
        ? 'Imagem ou vídeo, até 10 MB (imagem) ou 256 MB (vídeo).'
        : 'Imagem obrigatória (JPEG ou PNG), até 10 MB.'

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)

    const media = form.get('media')
    const hasMedia = media instanceof File && media.size > 0
    if (!hasMedia) {
      notify.error('Anexe uma mídia — o Instagram exige mídia para publicar.')
      return
    }
    const file = media as File
    const isVideo = file.type.startsWith('video/')
    if (postType === 'REELS' && !isVideo) {
      notify.error('Reels exige um arquivo de vídeo.')
      return
    }
    if (postType === 'FEED' && isVideo) {
      notify.error('Publicação no feed exige uma imagem.')
      return
    }
    form.delete('media')
    form.set(isVideo ? 'video' : 'image', file)
    const cover = form.get('cover')
    const hasCover =
      postType === 'REELS' && cover instanceof File && cover.size > 0
    if (!hasCover) form.delete('cover')
    if (connectionId) form.set('connectionId', connectionId)

    try {
      await publish.mutateAsync(form)
      notify.success('Publicado no Instagram.')
      formEl.reset()
      onCaptionChange('')
      onMediaChange(undefined)
      onCoverChange(undefined)
    } catch (err) {
      if (err instanceof CrmSocialApiError && isCrmSocialReconnectError(err)) {
        notify.error(`${err.message} Reconecte a conta nas configurações.`)
      } else {
        notify.error(err, 'Falha ao publicar')
      }
    }
  }

  return (
    <Card className='p-4 sm:p-6'>
      <GhostAiProvider assist={assistText}>
        <form className='space-y-4' onSubmit={handleSubmit}>
          <input type='hidden' name='postType' value={postType} />
          <div className='space-y-1.5'>
            <Label htmlFor='ig-post-type'>Tipo de publicação</Label>
            <Select
              items={POST_TYPES.map((t) => ({
                value: t,
                label: CRM_INSTAGRAM_POST_TYPE_LABELS[t],
              }))}
              value={postType}
              onValueChange={(v) => onPostTypeChange(v as CrmInstagramPostType)}
            >
              <SelectTrigger id='ig-post-type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {POST_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CRM_INSTAGRAM_POST_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='ig-caption'>Legenda</Label>
            <AiTextarea
              id='ig-caption'
              aiLabel='Legenda'
              name='caption'
              rows={5}
              maxLength={2200}
              placeholder='Escreva uma legenda (opcional)'
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='ig-media'>
              {postType === 'REELS'
                ? 'Vídeo'
                : postType === 'STORIES'
                  ? 'Mídia'
                  : 'Imagem'}
            </Label>
            <Input
              id='ig-media'
              name='media'
              type='file'
              accept={mediaAccept}
              required
              onChange={(e) => onMediaChange(e.target.files?.[0])}
            />
            <p className='text-muted-foreground text-xs'>{mediaHint}</p>
          </div>

          {postType === 'REELS' && (
            <div className='space-y-1.5'>
              <Label htmlFor='ig-cover'>Capa (opcional)</Label>
              <Input
                id='ig-cover'
                name='cover'
                type='file'
                accept='image/*'
                onChange={(e) => onCoverChange(e.target.files?.[0])}
              />
              <p className='text-muted-foreground text-xs'>
                Imagem de capa do Reels (JPEG, até 10 MB). Sem ela, a Meta usa
                um frame do próprio vídeo.
              </p>
            </div>
          )}

          <div className='flex justify-end'>
            <Button type='submit' disabled={publish.isPending}>
              {publish.isPending ? 'Publicando…' : 'Publicar'}
            </Button>
          </div>
        </form>
      </GhostAiProvider>
    </Card>
  )
}

export function CrmInstagramStudio({
  workspaceId,
  connectionId,
}: {
  workspaceId: string
  connectionId?: string
}) {
  const [range, setRange] = useState<CrmInstagramInsightsRange>('28d')
  const [caption, setCaption] = useState('')
  const [postType, setPostType] = useState<CrmInstagramPostType>('FEED')
  const [mediaFile, setMediaFile] = useState<File | undefined>()
  const [, setCoverFile] = useState<File | undefined>()
  const [selectedMedia, setSelectedMedia] = useState<CrmInstagramMedia | null>(
    null,
  )

  const overviewQuery = useCrmInstagramOverview(workspaceId, connectionId)
  const mediaQuery = useCrmInstagramMedia(workspaceId, connectionId)
  const storiesQuery = useCrmInstagramStories(workspaceId, connectionId)
  const insightsQuery = useCrmInstagramInsights(
    workspaceId,
    range,
    connectionId,
  )
  const engagementQuery = useCrmInstagramEngagement(workspaceId, connectionId)
  const deleteMedia = useDeleteCrmInstagramMedia(workspaceId, connectionId)

  const overview = overviewQuery.data
  const media = mediaQuery.data
  const stories = storiesQuery.data
  const insights = insightsQuery.data
  const engagement = engagementQuery.data

  if (overviewQuery.isLoading) {
    return (
      <div className='mx-auto w-full max-w-5xl space-y-6 py-6'>
        <Skeleton className='h-20 w-full' />
        <div className='grid grid-cols-3 gap-3'>
          <Skeleton className='h-20' />
          <Skeleton className='h-20' />
          <Skeleton className='h-20' />
        </div>
        <Skeleton className='h-72 w-full' />
      </div>
    )
  }

  if (!overview && isCrmSocialReconnectError(overviewQuery.error)) {
    return (
      <div className='py-6'>
        <ReconnectNotice
          workspaceId={workspaceId}
          message={overviewQuery.error.message}
        />
      </div>
    )
  }

  if (!overview) {
    return (
      <div className='py-6 text-center text-muted-foreground text-sm'>
        {overviewQuery.error instanceof Error
          ? overviewQuery.error.message
          : 'Não foi possível carregar o perfil.'}
        <div className='mt-3'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => overviewQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      </div>
    )
  }

  const insightsNeedsReconnect = isCrmSocialReconnectError(insightsQuery.error)

  return (
    <div className='mx-auto w-full max-w-5xl py-6'>
      <header className='mb-6 flex items-center gap-4'>
        {overview.profilePictureUrl ? (
          <img
            src={overview.profilePictureUrl}
            alt={overview.username}
            className='size-16 rounded-full border border-border/70'
          />
        ) : (
          <div className='flex size-16 items-center justify-center rounded-full bg-pink-500/10 text-pink-500'>
            <SteelIcon icon={InstagramIcon} className='size-7' />
          </div>
        )}
        <div className='min-w-0'>
          <h2 className='truncate font-heading font-semibold text-xl tracking-tight'>
            @{overview.username}
          </h2>
          {overview.name ? (
            <p className='truncate text-muted-foreground text-sm'>
              {overview.name}
            </p>
          ) : null}
          {overview.biography ? (
            <p className='mt-1 line-clamp-2 text-muted-foreground text-xs'>
              {overview.biography}
            </p>
          ) : null}
        </div>
      </header>

      <Tabs defaultValue='overview'>
        <div className='mb-6 border-b border-border/60'>
          <TabsList variant='line' className='w-full justify-start'>
            <TabsTrigger value='overview'>Visão Geral</TabsTrigger>
            <TabsTrigger value='post'>Post</TabsTrigger>
            <TabsTrigger value='analytics'>Analytics</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value='overview' className='space-y-4'>
          <div className='grid grid-cols-3 gap-3'>
            <StatCard
              icon={UserMultipleIcon}
              label='Seguidores'
              value={overview.followersCount}
            />
            <StatCard
              icon={UserMultipleIcon}
              label='Seguindo'
              value={overview.followsCount}
            />
            <StatCard
              icon={Analytics01Icon}
              label='Publicações'
              value={overview.mediaCount}
            />
          </div>

          {media && media.media.length > 0 ? (
            <div className='grid grid-cols-3 gap-1 sm:gap-2'>
              {media.media.map((item) => {
                const imgSrc =
                  item.mediaType === 'VIDEO' ? item.thumbnailUrl : item.mediaUrl
                return (
                  <button
                    key={item.id}
                    type='button'
                    onClick={() => setSelectedMedia(item)}
                    className='block w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  >
                    <Card className='group relative overflow-hidden p-0'>
                      <div className='aspect-square w-full bg-muted'>
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt={item.caption ?? ''}
                            className='size-full object-cover transition-transform group-hover:scale-[1.03]'
                          />
                        ) : (
                          <div className='flex size-full items-center justify-center text-muted-foreground/30'>
                            <SteelIcon
                              icon={InstagramIcon}
                              className='size-8'
                            />
                          </div>
                        )}
                        {item.mediaType === 'VIDEO' && (
                          <div className='absolute inset-0 flex items-center justify-center'>
                            <div className='flex size-8 items-center justify-center rounded-full bg-black/50 text-white'>
                              <SteelIcon icon={PlayIcon} className='size-4' />
                            </div>
                          </div>
                        )}
                        {item.mediaType === 'CAROUSEL_ALBUM' && (
                          <div className='absolute top-2 right-2'>
                            <div className='flex size-5 items-center justify-center rounded bg-black/50'>
                              <SteelIcon
                                icon={Analytics01Icon}
                                className='size-3 text-white'
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  </button>
                )
              })}
            </div>
          ) : media && media.media.length === 0 ? (
            <Card className='px-4 py-10 text-center text-muted-foreground text-sm'>
              <SteelIcon
                icon={InstagramIcon}
                className='mx-auto mb-2 size-6 opacity-60'
              />
              Nenhuma publicação recente.
            </Card>
          ) : null}

          {stories && stories.stories.length > 0 && (
            <div className='space-y-2 border-t border-border/60 pt-4'>
              <h3 className='font-heading font-semibold text-base tracking-tight'>
                Stories ativas
              </h3>
              <div className='flex gap-2 overflow-x-auto pb-1'>
                {stories.stories.map((story) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    deleting={
                      deleteMedia.isPending &&
                      deleteMedia.variables === story.id
                    }
                    onDelete={() => {
                      deleteMedia.mutate(story.id, {
                        onSuccess: () => notify.success('Story excluída.'),
                        onError: (error) =>
                          notify.error(error, 'Falha ao excluir a story'),
                      })
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value='post'>
          <div className='grid gap-6 lg:grid-cols-2'>
            <div className='space-y-3'>
              <h3 className='font-heading font-semibold text-base tracking-tight'>
                Publicar
              </h3>
              <PostComposer
                workspaceId={workspaceId}
                connectionId={connectionId}
                caption={caption}
                onCaptionChange={setCaption}
                postType={postType}
                onPostTypeChange={setPostType}
                onMediaChange={setMediaFile}
                onCoverChange={setCoverFile}
              />
            </div>
            <div className='space-y-3'>
              <h3 className='font-heading font-semibold text-base text-muted-foreground tracking-tight'>
                Pré-visualização
              </h3>
              <InstagramPostPreview
                username={overview.username}
                avatarUrl={overview.profilePictureUrl}
                caption={caption}
                previewFile={mediaFile}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value='analytics' className='space-y-4'>
          <div className='flex items-center justify-between gap-3'>
            <h3 className='font-heading font-semibold text-lg tracking-tight'>
              Insights
            </h3>
            <Tabs
              value={range}
              onValueChange={(v) => setRange(v as CrmInstagramInsightsRange)}
            >
              <TabsList>
                {RANGES.map((r) => (
                  <TabsTrigger key={r.value} value={r.value}>
                    {r.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {insightsNeedsReconnect ? (
            <Card className='px-4 py-6 text-center text-muted-foreground text-sm'>
              {insightsQuery.error instanceof Error
                ? insightsQuery.error.message
                : null}
            </Card>
          ) : insights ? (
            <>
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                <StatCard
                  icon={Analytics01Icon}
                  label='Visualizações'
                  value={insights.totals.impressions}
                />
                <StatCard
                  icon={EyeIcon}
                  label='Alcance'
                  value={insights.totals.reach}
                />
                <StatCard
                  icon={UserMultipleIcon}
                  label='Visitas ao perfil'
                  value={insights.totals.profileViews}
                />
              </div>
              <Card className='h-72 p-2 text-muted-foreground'>
                {insights.series.length > 0 ? (
                  (() => {
                    const gk = range === '90d' ? getFortnightKey : null
                    const s1 = toNivoSeries(
                      insights.series,
                      (p) => p.impressions,
                      gk,
                    )
                    const s2 = toNivoSeries(insights.series, (p) => p.reach, gk)
                    const s3 = toNivoSeries(
                      insights.series,
                      (p) => p.profileViews,
                      gk,
                    )
                    const ticks: string[] | number = gk ? s1.map((d) => d.x) : 7
                    return (
                      <ResponsiveLine
                        data={[
                          { id: 'Visualizações', data: s1 },
                          { id: 'Alcance', data: s2 },
                          { id: 'Visitas', data: s3 },
                        ]}
                        margin={{ top: 36, right: 20, bottom: 64, left: 52 }}
                        colors={['#ec4899', '#a855f7', '#f59e0b']}
                        curve='monotoneX'
                        pointSize={range === '7d' ? 5 : range === '28d' ? 3 : 0}
                        pointColor={{ from: 'color' }}
                        useMesh
                        xScale={{ type: 'point' }}
                        yScale={{ type: 'linear', min: 0, max: 'auto' }}
                        axisBottom={{
                          tickSize: 0,
                          tickPadding: 8,
                          tickRotation: -45,
                          tickValues: ticks,
                          format: formatAxisLabel,
                        }}
                        axisLeft={{ tickSize: 0, tickPadding: 8 }}
                        legends={[
                          {
                            anchor: 'bottom',
                            direction: 'row',
                            translateY: 56,
                            itemWidth: 110,
                            itemHeight: 16,
                            symbolSize: 10,
                          },
                        ]}
                        theme={CHART_THEME}
                      />
                    )
                  })()
                ) : (
                  <div className='flex h-full items-center justify-center text-sm'>
                    Sem dados no período.
                  </div>
                )}
              </Card>
            </>
          ) : (
            <Skeleton className='h-72 w-full' />
          )}

          <div className='space-y-3 border-t border-border/60 pt-4'>
            <h3 className='font-heading font-semibold text-lg tracking-tight'>
              Engajamento (7 dias)
            </h3>
            {engagement ? (
              <>
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                  <StatCard
                    icon={EyeIcon}
                    label='Views'
                    value={engagement.views7d}
                  />
                  <StatCard
                    icon={Bookmark01Icon}
                    label='Saves'
                    value={engagement.saves7d}
                  />
                  <StatCard
                    icon={UserMultipleIcon}
                    label='Visitar perfil'
                    value={engagement.profileViews7d}
                  />
                </div>
                {engagement.top5.length > 0 ? (
                  <div className='space-y-2'>
                    <p className='text-muted-foreground text-sm'>
                      Top 5 mais quentes
                    </p>
                    <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
                      {engagement.top5.map((item, i) => (
                        <TopMediaCard key={item.id} item={item} rank={i + 1} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <Card className='px-4 py-6 text-center text-muted-foreground text-sm'>
                    Nenhuma publicação nos últimos 7 dias.
                  </Card>
                )}
              </>
            ) : (
              <Skeleton className='h-40 w-full' />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={selectedMedia !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedMedia(null)
        }}
      >
        <DialogContent className='max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-3xl'>
          {selectedMedia && (
            <InstagramMediaModal
              item={selectedMedia}
              username={overview.username}
              avatarUrl={overview.profilePictureUrl}
              deleting={
                deleteMedia.isPending &&
                deleteMedia.variables === selectedMedia.id
              }
              onDelete={() => {
                deleteMedia.mutate(selectedMedia.id, {
                  onSuccess: () => {
                    notify.success('Publicação excluída.')
                    setSelectedMedia(null)
                  },
                  onError: (error) =>
                    notify.error(error, 'Falha ao excluir a publicação'),
                })
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
