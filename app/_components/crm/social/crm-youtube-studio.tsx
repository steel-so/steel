'use client'

import {
  Album02Icon,
  Comment01Icon,
  EyeIcon,
  FavouriteIcon,
  Share08Icon,
  Time01Icon,
  UserMultipleIcon,
  Video01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { ResponsiveLine } from '@nivo/line'
import type { ChangeEvent, SyntheticEvent } from 'react'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { AiInput, AiTextarea } from '@/components/ui/ai-text-field'
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  type CrmSocialApiError,
  useCrmYoutubeInsights,
  useCrmYoutubeOverview,
  useCrmYoutubeVideos,
  useDeleteCrmYoutubeVideo,
  usePublishCrmYoutubeVideo,
} from '@/src/hooks/use-crm-social-youtube'
import { useCrmTextAi } from '@/src/hooks/use-crm-text-ai'
import type {
  CrmSocialYoutubeInsightsRange,
  CrmSocialYoutubeVideoDTO,
} from '@/src/schemas/crm-social-youtube.schema'
import {
  CHART_THEME,
  formatAxisLabel,
  getFortnightKey,
  getMonthKey,
  toNivoSeries,
} from './chart-utils'

const nf = new Intl.NumberFormat('pt-BR')

const RANGES: { value: CrmSocialYoutubeInsightsRange; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '28d', label: '28 dias' },
  { value: '90d', label: '90 dias' },
  { value: '365d', label: '1 ano' },
]

const RECONNECT_CODES = new Set([
  'CRM_SOCIAL_CONNECTION_NOT_FOUND',
  'CRM_SOCIAL_SCOPE_MISSING',
  'CRM_SOCIAL_TOKEN_EXPIRED',
  'CRM_SOCIAL_NOT_CONFIGURED',
])

function isReconnectError(error: unknown): error is CrmSocialApiError {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    RECONNECT_CODES.has(String((error as { code?: string }).code))
  )
}

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

function ReconnectNotice({
  workspaceId,
  error,
}: {
  workspaceId: string
  error: CrmSocialApiError
}) {
  return (
    <div className='mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center'>
      <div className='flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-card/70 text-muted-foreground'>
        <SteelIcon icon={Video01Icon} className='size-6' />
      </div>
      <div className='space-y-1.5'>
        <h2 className='font-heading font-semibold text-xl tracking-tight'>
          Conecte o YouTube
        </h2>
        <p className='text-muted-foreground text-sm'>{error.message}</p>
      </div>
      <a
        href={`/api/workspaces/${workspaceId}/crm/social/youtube/connect`}
        className={buttonVariants()}
      >
        Conectar com YouTube
      </a>
    </div>
  )
}

type FilePreview = { objectUrl: string; duration: string }

function YoutubeVideoPreview({
  channelTitle,
  channelThumbnailUrl,
  title,
  privacyStatus,
  filePreview,
}: {
  channelTitle: string
  channelThumbnailUrl?: string | null
  title: string
  privacyStatus: string
  filePreview?: FilePreview | null
}) {
  const privacyLabel =
    privacyStatus === 'public'
      ? 'Público'
      : privacyStatus === 'unlisted'
        ? 'Não listado'
        : 'Privado'

  return (
    <div className='mx-auto max-w-[380px] overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm'>
      <div className='relative aspect-video w-full bg-muted'>
        {filePreview ? (
          <video
            src={filePreview.objectUrl}
            className='size-full object-cover'
            muted
            preload='metadata'
          />
        ) : (
          <div className='flex size-full flex-col items-center justify-center gap-2 text-muted-foreground/30'>
            <SteelIcon icon={Video01Icon} className='size-10' />
            <span className='text-xs'>Miniatura do vídeo</span>
          </div>
        )}
        <div className='absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 text-white text-xs'>
          {filePreview?.duration || '0:00'}
        </div>
      </div>

      <div className='flex gap-3 p-3'>
        {channelThumbnailUrl ? (
          <img
            src={channelThumbnailUrl}
            alt={channelTitle}
            className='size-9 shrink-0 rounded-full object-cover'
          />
        ) : (
          <div className='flex size-9 shrink-0 items-center justify-center rounded-full bg-red-600/10 text-red-600'>
            <SteelIcon icon={Video01Icon} className='size-4' />
          </div>
        )}
        <div className='min-w-0 flex-1'>
          {title ? (
            <p className='line-clamp-2 break-words font-semibold text-sm leading-snug'>
              {title}
            </p>
          ) : (
            <p className='text-muted-foreground/50 text-sm italic'>
              Título do vídeo…
            </p>
          )}
          <p className='mt-0.5 truncate text-muted-foreground text-xs'>
            {channelTitle}
          </p>
          <p className='text-muted-foreground text-xs'>
            0 visualizações · {privacyLabel}
          </p>
        </div>
      </div>

      <div className='flex items-center gap-1 border-border/60 border-t px-3 py-2'>
        <button
          type='button'
          className='flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground'
        >
          <SteelIcon icon={FavouriteIcon} className='size-4' />
          Gostei
        </button>
        <button
          type='button'
          className='flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground'
        >
          <SteelIcon icon={Share08Icon} className='size-4' />
          Compartilhar
        </button>
      </div>
    </div>
  )
}

function parseDuration(iso: string | null): string | null {
  if (!iso) return null
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return null
  const h = Number(m[1] ?? 0)
  const min = Number(m[2] ?? 0)
  const sec = Number(m[3] ?? 0)
  if (h > 0) {
    return `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${min}:${String(sec).padStart(2, '0')}`
}

function YoutubeVideoModal({
  video,
  channelTitle,
  channelThumbnailUrl,
  deleting,
  onDelete,
}: {
  video: CrmSocialYoutubeVideoDTO
  channelTitle: string
  channelThumbnailUrl?: string | null
  deleting: boolean
  onDelete: () => void
}) {
  const date = video.publishedAt
    ? new Date(video.publishedAt).toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null
  const durationLabel = parseDuration(video.duration)

  const stats = [
    { icon: EyeIcon, label: 'Visualizações', value: video.viewCount },
    { icon: FavouriteIcon, label: 'Curtidas', value: video.likeCount },
    { icon: Comment01Icon, label: 'Comentários', value: video.commentCount },
  ]

  return (
    <div className='overflow-hidden rounded-xl'>
      <div className='relative aspect-video w-full bg-neutral-950'>
        <iframe
          src={`https://www.youtube.com/embed/${video.videoId}?autoplay=0&rel=0`}
          title={video.title}
          allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
          allowFullScreen
          className='size-full border-0'
        />
      </div>

      <div className='space-y-4 p-5'>
        <h3 className='font-heading font-semibold text-base leading-snug tracking-tight'>
          {video.title}
        </h3>

        <div className='flex items-center gap-3'>
          {channelThumbnailUrl ? (
            <img
              src={channelThumbnailUrl}
              alt={channelTitle}
              className='size-9 rounded-full object-cover'
            />
          ) : (
            <div className='flex size-9 shrink-0 items-center justify-center rounded-full bg-red-600/10 text-red-600'>
              <SteelIcon icon={Video01Icon} className='size-4' />
            </div>
          )}
          <div>
            <p className='font-medium text-sm'>{channelTitle}</p>
            <div className='flex items-center gap-2 text-muted-foreground text-xs'>
              {date && <span>{date}</span>}
              {durationLabel && (
                <>
                  <span>·</span>
                  <span className='flex items-center gap-0.5'>
                    <SteelIcon icon={Time01Icon} className='size-3' />
                    {durationLabel}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <a
          href={video.url}
          target='_blank'
          rel='noreferrer'
          className={`${buttonVariants({ size: 'sm' })} block w-full text-center`}
        >
          Abrir no YouTube
        </a>

        <div className='grid grid-cols-3 gap-2 border-border/60 border-t pt-3'>
          {stats.map(({ icon, label, value }) => (
            <div
              key={label}
              className='flex flex-col items-center gap-0.5 rounded-lg border border-border/50 px-2 py-2 text-center'
            >
              <SteelIcon
                icon={icon}
                className='size-3.5 text-muted-foreground'
              />
              <span className='font-semibold text-sm tabular-nums'>
                {nf.format(value)}
              </span>
              <span className='text-[10px] text-muted-foreground leading-tight'>
                {label}
              </span>
            </div>
          ))}
        </div>

        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='w-full text-destructive hover:text-destructive'
              >
                Excluir vídeo
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir vídeo</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita — o vídeo será removido do
                YouTube.
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
  )
}

function VideoFileInput({
  id,
  name,
  required,
  onPreview,
}: {
  id: string
  name: string
  required?: boolean
  onPreview: (p: FilePreview | null) => void
}) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      onPreview(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    const vid = document.createElement('video')
    vid.preload = 'metadata'
    vid.src = objectUrl
    vid.onloadedmetadata = () => {
      const d = Math.round(vid.duration)
      const min = Math.floor(d / 60)
      const sec = String(d % 60).padStart(2, '0')
      onPreview({ objectUrl, duration: `${min}:${sec}` })
    }
    vid.onerror = () => {
      onPreview({ objectUrl, duration: '' })
    }
  }

  return (
    <Input
      id={id}
      name={name}
      type='file'
      accept='video/*'
      required={required}
      onChange={handleChange}
    />
  )
}

function UploadForm({
  workspaceId,
  onPublished,
  title,
  onTitleChange,
  privacyStatus,
  onPrivacyStatusChange,
  onPreview,
}: {
  workspaceId: string
  onPublished: () => void
  title: string
  onTitleChange: (v: string) => void
  privacyStatus: string
  onPrivacyStatusChange: (v: string) => void
  onPreview?: (p: FilePreview | null) => void
}) {
  const publish = usePublishCrmYoutubeVideo(workspaceId)
  const assistText = useCrmTextAi(workspaceId, 'SOCIAL', () => ({
    platform: 'YouTube',
    title,
  }))
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null)

  function handlePreview(p: FilePreview | null) {
    setFilePreview(p)
    onPreview?.(p)
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)

    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      notify.error('Selecione um arquivo de vídeo.')
      return
    }

    try {
      await publish.mutateAsync(form)
      notify.success('Vídeo enviado para o YouTube.')
      formEl.reset()
      onTitleChange('')
      if (filePreview) URL.revokeObjectURL(filePreview.objectUrl)
      handlePreview(null)
      onPublished()
    } catch (error) {
      if (isReconnectError(error)) {
        notify.error(`${error.message} Reconecte a conta do YouTube.`)
      } else {
        notify.error(error, 'Erro ao publicar vídeo no YouTube')
      }
    }
  }

  return (
    <Card className='p-4 sm:p-6'>
      <GhostAiProvider assist={assistText}>
        <form className='space-y-4' onSubmit={handleSubmit}>
          <div className='space-y-1.5'>
            <Label htmlFor='yt-title'>Título</Label>
            <AiInput
              id='yt-title'
              aiLabel='Título do vídeo'
              name='title'
              maxLength={100}
              required
              placeholder='Título do vídeo'
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='yt-description'>Descrição</Label>
            <AiTextarea
              id='yt-description'
              aiLabel='Descrição do vídeo'
              name='description'
              rows={4}
              maxLength={5000}
              placeholder='Descrição (opcional)'
            />
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='yt-privacy'>Visibilidade</Label>
              <Select
                name='privacyStatus'
                value={privacyStatus}
                onValueChange={(v) => v && onPrivacyStatusChange(v)}
              >
                <SelectTrigger id='yt-privacy'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='private'>Privado</SelectItem>
                  <SelectItem value='unlisted'>Não listado</SelectItem>
                  <SelectItem value='public'>Público</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='yt-tags'>Tags</Label>
              <Input
                id='yt-tags'
                name='tags'
                placeholder='separadas por vírgula'
              />
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='yt-file'>Arquivo de vídeo</Label>
            <VideoFileInput
              id='yt-file'
              name='file'
              required
              onPreview={handlePreview}
            />
            {filePreview ? (
              <div className='relative mt-1 overflow-hidden rounded-lg border border-border/60 bg-black'>
                <video
                  src={filePreview.objectUrl}
                  className='aspect-video w-full object-contain'
                  muted
                  preload='metadata'
                />
                {filePreview.duration && (
                  <div className='absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 font-medium text-white text-xs'>
                    {filePreview.duration}
                  </div>
                )}
              </div>
            ) : (
              <p className='text-muted-foreground text-xs'>
                Máximo 256 MB. O vídeo entra como privado por padrão.
              </p>
            )}
          </div>

          <div className='flex justify-end'>
            <Button type='submit' disabled={publish.isPending}>
              {publish.isPending ? 'Enviando…' : 'Publicar no YouTube'}
            </Button>
          </div>
        </form>
      </GhostAiProvider>
    </Card>
  )
}

export function CrmYoutubeStudio({ workspaceId }: { workspaceId: string }) {
  const overviewQuery = useCrmYoutubeOverview(workspaceId)
  const videosQuery = useCrmYoutubeVideos(workspaceId)
  const [range, setRange] = useState<CrmSocialYoutubeInsightsRange>('28d')
  const insightsQuery = useCrmYoutubeInsights(workspaceId, range)
  const deleteVideo = useDeleteCrmYoutubeVideo(workspaceId)

  const overview = overviewQuery.data
  const videos = videosQuery.data
  const insights = insightsQuery.data

  const [title, setTitle] = useState('')
  const [privacyStatus, setPrivacyStatus] = useState('private')
  const [selectedVideo, setSelectedVideo] =
    useState<CrmSocialYoutubeVideoDTO | null>(null)
  const [uploadPreview, setUploadPreview] = useState<FilePreview | null>(null)

  if (overviewQuery.isLoading && !overview) {
    return (
      <div className='mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6'>
        <Skeleton className='h-20 w-full' />
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
          <Skeleton className='h-20' />
          <Skeleton className='h-20' />
          <Skeleton className='h-20' />
        </div>
        <Skeleton className='h-72 w-full' />
      </div>
    )
  }

  if (!overview && isReconnectError(overviewQuery.error)) {
    return (
      <div className='px-4 py-6 sm:px-6'>
        <ReconnectNotice
          workspaceId={workspaceId}
          error={overviewQuery.error}
        />
      </div>
    )
  }

  if (!overview) {
    return (
      <div className='px-4 py-6 text-center text-muted-foreground text-sm sm:px-6'>
        {overviewQuery.error?.message ?? 'Não foi possível carregar o canal.'}
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

  const insightsNeedsReconnect =
    !insights && isReconnectError(insightsQuery.error)

  return (
    <div className='mx-auto w-full max-w-5xl px-4 py-6 sm:px-6'>
      <header className='mb-6 flex items-center gap-4'>
        {overview.thumbnailUrl ? (
          <img
            src={overview.thumbnailUrl}
            alt={overview.title}
            className='size-16 rounded-full border border-border/70'
          />
        ) : (
          <div className='flex size-16 items-center justify-center rounded-full bg-red-600/10 text-red-600'>
            <SteelIcon icon={Video01Icon} className='size-7' />
          </div>
        )}
        <div className='min-w-0'>
          <h2 className='truncate font-heading font-semibold text-xl tracking-tight'>
            {overview.title}
          </h2>
          {overview.customUrl ? (
            <p className='truncate text-muted-foreground text-sm'>
              {overview.customUrl}
            </p>
          ) : null}
        </div>
      </header>

      <Tabs defaultValue='overview'>
        <div className='mb-6 border-border/60 border-b'>
          <TabsList variant='line' className='w-full justify-start'>
            <TabsTrigger value='overview'>Visão Geral</TabsTrigger>
            <TabsTrigger value='post'>Post</TabsTrigger>
            <TabsTrigger value='analytics'>Analytics</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value='overview' className='space-y-4'>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
            <StatCard
              icon={UserMultipleIcon}
              label='Inscritos'
              value={overview.subscriberCount}
            />
            <StatCard
              icon={EyeIcon}
              label='Visualizações'
              value={overview.viewCount}
            />
            <StatCard
              icon={Album02Icon}
              label='Vídeos'
              value={overview.videoCount}
            />
          </div>

          {videos && videos.videos.length > 0 ? (
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              {videos.videos.map((video) => {
                const date = video.publishedAt
                  ? new Date(video.publishedAt).toLocaleDateString('pt-BR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : null
                return (
                  <button
                    key={video.videoId}
                    type='button'
                    onClick={() => setSelectedVideo(video)}
                    className='block w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  >
                    <Card className='group overflow-hidden p-0'>
                      <div className='relative aspect-video w-full bg-muted'>
                        {video.thumbnailUrl ? (
                          <img
                            src={video.thumbnailUrl}
                            alt={video.title}
                            className='size-full object-cover transition-transform group-hover:scale-[1.03]'
                          />
                        ) : (
                          <div className='flex size-full items-center justify-center text-muted-foreground/30'>
                            <SteelIcon icon={Video01Icon} className='size-10' />
                          </div>
                        )}
                      </div>
                      <div className='space-y-0.5 p-3'>
                        <p className='line-clamp-2 font-medium text-sm leading-snug'>
                          {video.title}
                        </p>
                        {date && (
                          <p className='text-muted-foreground text-xs'>
                            {date}
                          </p>
                        )}
                      </div>
                    </Card>
                  </button>
                )
              })}
            </div>
          ) : videos && videos.videos.length === 0 ? (
            <Card className='px-4 py-10 text-center text-muted-foreground text-sm'>
              <SteelIcon
                icon={Video01Icon}
                className='mx-auto mb-2 size-6 opacity-60'
              />
              Nenhum vídeo recente.
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value='post'>
          <div className='grid gap-6 lg:grid-cols-2'>
            <div className='space-y-3'>
              <h3 className='font-heading font-semibold text-base tracking-tight'>
                Publicar vídeo
              </h3>
              <UploadForm
                workspaceId={workspaceId}
                onPublished={() => setUploadPreview(null)}
                title={title}
                onTitleChange={setTitle}
                privacyStatus={privacyStatus}
                onPrivacyStatusChange={setPrivacyStatus}
                onPreview={setUploadPreview}
              />
            </div>
            <div className='space-y-3'>
              <h3 className='font-heading font-semibold text-base text-muted-foreground tracking-tight'>
                Pré-visualização
              </h3>
              <YoutubeVideoPreview
                channelTitle={overview.title}
                channelThumbnailUrl={overview.thumbnailUrl}
                title={title}
                privacyStatus={privacyStatus}
                filePreview={uploadPreview}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value='analytics' className='space-y-4'>
          <div className='flex items-center justify-between gap-3'>
            <h3 className='font-heading font-semibold text-lg tracking-tight'>
              Análises
            </h3>
            <Tabs
              value={range}
              onValueChange={(v) =>
                setRange(v as CrmSocialYoutubeInsightsRange)
              }
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
              {insightsQuery.error?.message}
            </Card>
          ) : insights ? (
            <>
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                <StatCard
                  icon={EyeIcon}
                  label='Visualizações no período'
                  value={insights.totals.views}
                />
                <StatCard
                  icon={Video01Icon}
                  label='Minutos assistidos'
                  value={insights.totals.estimatedMinutesWatched}
                />
                <StatCard
                  icon={UserMultipleIcon}
                  label='Inscritos ganhos'
                  value={insights.totals.subscribersGained}
                />
              </div>
              <Card className='h-72 p-2 text-muted-foreground'>
                {insights.series.length > 0 ? (
                  (() => {
                    const gk =
                      range === '90d'
                        ? getFortnightKey
                        : range === '365d'
                          ? getMonthKey
                          : null
                    const s1 = toNivoSeries(insights.series, (p) => p.views, gk)
                    const ticks: string[] | number = gk ? s1.map((d) => d.x) : 7
                    return (
                      <ResponsiveLine
                        data={[{ id: 'Visualizações', data: s1 }]}
                        margin={{ top: 36, right: 20, bottom: 48, left: 52 }}
                        colors={['#ef4444']}
                        curve='monotoneX'
                        enableArea
                        areaOpacity={0.12}
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
        </TabsContent>
      </Tabs>

      <Dialog
        open={selectedVideo !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedVideo(null)
        }}
      >
        <DialogContent className='sm:max-w-xl gap-0 overflow-hidden p-0'>
          {selectedVideo && (
            <YoutubeVideoModal
              video={selectedVideo}
              channelTitle={overview.title}
              channelThumbnailUrl={overview.thumbnailUrl}
              deleting={
                deleteVideo.isPending &&
                deleteVideo.variables === selectedVideo.videoId
              }
              onDelete={() => {
                deleteVideo.mutate(selectedVideo.videoId, {
                  onSuccess: () => {
                    notify.success('Vídeo excluído.')
                    setSelectedVideo(null)
                  },
                  onError: (error) =>
                    notify.error(error, 'Falha ao excluir o vídeo'),
                })
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
