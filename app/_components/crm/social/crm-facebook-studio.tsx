'use client'

import {
  Analytics01Icon,
  Comment01Icon,
  Facebook01Icon,
  FavouriteIcon,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  CrmSocialApiError,
  isCrmSocialReconnectError,
  useCrmFacebookInsights,
  useCrmFacebookOverview,
  useCrmFacebookPosts,
  useDeleteCrmFacebookPost,
  usePublishCrmFacebookPost,
} from '@/src/hooks/use-crm-social-facebook'
import { useCrmTextAi } from '@/src/hooks/use-crm-text-ai'
import type {
  CrmFacebookInsightsRange,
  CrmFacebookPost,
} from '@/src/schemas/crm-social-facebook.schema'
import {
  CHART_THEME,
  formatAxisLabel,
  getFortnightKey,
  toNivoSeries,
} from './chart-utils'

const nf = new Intl.NumberFormat('pt-BR')

const RANGES: { value: CrmFacebookInsightsRange; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '28d', label: '28 dias' },
  { value: '90d', label: '90 dias' },
]

function StatCard({
  icon,
  label,
  value,
}: {
  icon: typeof FavouriteIcon
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
  message,
}: {
  workspaceId: string
  message: string
}) {
  return (
    <div className='mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center'>
      <div className='flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-card/70 text-muted-foreground'>
        <SteelIcon icon={Facebook01Icon} className='size-6' />
      </div>
      <div className='space-y-1.5'>
        <h2 className='font-heading font-semibold text-xl tracking-tight'>
          Conecte o Facebook
        </h2>
        <p className='text-muted-foreground text-sm'>{message}</p>
      </div>
      <a
        href={`/api/workspaces/${workspaceId}/crm/social/facebook/connect`}
        className={buttonVariants()}
      >
        Conectar conta
      </a>
    </div>
  )
}

function FacebookPostPreview({
  pageName,
  avatarUrl,
  message,
  imageFile,
  videoFile,
}: {
  pageName: string
  avatarUrl?: string | null
  message: string
  imageFile?: File
  videoFile?: File
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const mediaFile = videoFile ?? imageFile

  useEffect(() => {
    if (!mediaFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(mediaFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [mediaFile])

  return (
    <div className='mx-auto max-w-[380px] overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm'>
      <div className='flex items-start gap-2.5 px-3 py-3'>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={pageName}
            className='size-10 rounded-full border border-border/50 object-cover'
          />
        ) : (
          <div className='flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-600/10 text-blue-600'>
            <SteelIcon icon={Facebook01Icon} className='size-5' />
          </div>
        )}
        <div className='min-w-0'>
          <p className='font-semibold text-sm leading-tight'>
            {pageName || 'Página'}
          </p>
          <p className='text-muted-foreground text-xs'>
            Agora · <span className='font-medium'>🌐</span>
          </p>
        </div>
      </div>

      {message ? (
        <p className='line-clamp-5 break-words px-3 pb-3 text-sm leading-relaxed'>
          {message}
        </p>
      ) : (
        <p className='px-3 pb-3 text-muted-foreground/50 text-xs italic'>
          A mensagem aparecerá aqui…
        </p>
      )}

      {previewUrl && videoFile && (
        <div className='aspect-[4/3] w-full bg-black'>
          <video
            src={previewUrl}
            controls
            muted
            className='size-full object-contain'
          />
        </div>
      )}
      {previewUrl && !videoFile && (
        <div className='aspect-[4/3] w-full bg-muted'>
          <img
            src={previewUrl}
            alt='preview'
            className='size-full object-cover'
          />
        </div>
      )}

      <div className='border-t border-border/60 px-3 py-1.5'>
        <div className='flex items-center divide-x divide-border/60'>
          <button
            type='button'
            className='flex flex-1 items-center justify-center gap-1.5 py-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
          >
            <SteelIcon icon={FavouriteIcon} className='size-4' />
            Curtir
          </button>
          <button
            type='button'
            className='flex flex-1 items-center justify-center gap-1.5 py-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
          >
            <SteelIcon icon={Comment01Icon} className='size-4' />
            Comentar
          </button>
          <button
            type='button'
            className='flex flex-1 items-center justify-center gap-1.5 py-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
          >
            <SteelIcon icon={Share08Icon} className='size-4' />
            Compartilhar
          </button>
        </div>
      </div>
    </div>
  )
}

function FacebookPostModal({
  post,
  pageName,
  avatarUrl,
  deleting,
  onDelete,
}: {
  post: CrmFacebookPost
  pageName: string
  avatarUrl?: string | null
  deleting: boolean
  onDelete: () => void
}) {
  const date = post.createdTime
    ? new Date(post.createdTime).toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null
  const text = post.message ?? post.story

  return (
    <div className='overflow-hidden rounded-xl'>
      {post.isVideo && post.permalinkUrl ? (
        <div className='aspect-video w-full bg-black'>
          <iframe
            src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(post.permalinkUrl)}&show_text=false`}
            title={text ?? 'Vídeo do Facebook'}
            allow='autoplay; encrypted-media; picture-in-picture'
            allowFullScreen
            className='size-full border-0'
          />
        </div>
      ) : (
        post.fullPicture && (
          <div className='max-h-[55vh] overflow-hidden bg-black'>
            <img
              src={post.fullPicture}
              alt=''
              className='max-h-[55vh] w-full object-contain'
            />
          </div>
        )
      )}

      <div className='space-y-4 p-5'>
        <div className='flex items-center gap-3'>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={pageName}
              className='size-10 rounded-full border border-border/50 object-cover'
            />
          ) : (
            <div className='flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-600/10 text-blue-600'>
              <SteelIcon icon={Facebook01Icon} className='size-5' />
            </div>
          )}
          <div>
            <p className='font-semibold text-sm leading-tight'>{pageName}</p>
            {date && <p className='text-muted-foreground text-xs'>{date}</p>}
          </div>
        </div>

        {text && (
          <p className='break-words whitespace-pre-wrap text-sm leading-relaxed'>
            {text}
          </p>
        )}

        <div className='flex items-center gap-1 border-t border-border/60 pt-3'>
          <button
            type='button'
            className='flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground'
          >
            <SteelIcon icon={FavouriteIcon} className='size-4' />
            Curtir
          </button>
          <button
            type='button'
            className='flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground'
          >
            <SteelIcon icon={Comment01Icon} className='size-4' />
            Comentar
          </button>
          <button
            type='button'
            className='flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground'
          >
            <SteelIcon icon={Share08Icon} className='size-4' />
            Compartilhar
          </button>
        </div>

        {post.permalinkUrl && (
          <a
            href={post.permalinkUrl}
            target='_blank'
            rel='noreferrer'
            className={`${buttonVariants({ variant: 'outline', size: 'sm' })} block w-full text-center`}
          >
            Abrir no Facebook
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
                Esta ação não pode ser desfeita — a publicação será removida do
                Facebook.
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

function PostComposer({
  workspaceId,
  connectionId,
  message,
  onMessageChange,
  onImageChange,
  onVideoChange,
}: {
  workspaceId: string
  connectionId?: string
  message: string
  onMessageChange: (v: string) => void
  onImageChange: (f: File | undefined) => void
  onVideoChange: (f: File | undefined) => void
}) {
  const publish = usePublishCrmFacebookPost(workspaceId, connectionId)
  const assistText = useCrmTextAi(workspaceId, 'SOCIAL', () => ({
    platform: 'Facebook',
  }))

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)

    const msg = (form.get('message') as string | null)?.trim() ?? ''
    const link = (form.get('link') as string | null)?.trim() ?? ''
    const image = form.get('image')
    const video = form.get('video')
    const hasImage = image instanceof File && image.size > 0
    const hasVideo = video instanceof File && video.size > 0
    if (!msg && !link && !hasImage && !hasVideo) {
      notify.error('Escreva uma mensagem, um link ou anexe uma imagem/vídeo.')
      return
    }
    if (!link) form.delete('link')
    // Imagem e vídeo usam endpoints diferentes na Meta — só um por post.
    // Vídeo tem prioridade se os dois forem selecionados.
    if (hasVideo) {
      form.delete('image')
    } else {
      form.delete('video')
    }
    if (!hasImage) form.delete('image')
    if (connectionId) form.set('connectionId', connectionId)

    try {
      await publish.mutateAsync(form)
      notify.success('Publicado no Facebook.')
      formEl.reset()
      onMessageChange('')
      onImageChange(undefined)
      onVideoChange(undefined)
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
          <div className='space-y-1.5'>
            <Label htmlFor='fb-message'>Mensagem</Label>
            <AiTextarea
              id='fb-message'
              aiLabel='Mensagem do post'
              name='message'
              rows={5}
              maxLength={5000}
              placeholder='O que você quer publicar?'
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='fb-link'>Link (opcional)</Label>
            <Input
              id='fb-link'
              name='link'
              type='url'
              placeholder='https://…'
            />
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='fb-image'>Imagem (opcional)</Label>
              <Input
                id='fb-image'
                name='image'
                type='file'
                accept='image/*'
                onChange={(e) => {
                  onImageChange(e.target.files?.[0])
                  if (e.target.files?.[0]) onVideoChange(undefined)
                }}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='fb-video'>Vídeo (opcional)</Label>
              <Input
                id='fb-video'
                name='video'
                type='file'
                accept='video/*'
                onChange={(e) => {
                  onVideoChange(e.target.files?.[0])
                  if (e.target.files?.[0]) onImageChange(undefined)
                }}
              />
            </div>
          </div>
          <p className='text-muted-foreground text-xs'>
            Imagem ou vídeo — não os dois. Imagem vira uma foto com a mensagem
            como legenda (máx. 10 MB); vídeo vira uma publicação de vídeo na
            Página (máx. 256 MB, pode levar alguns minutos para publicar).
          </p>

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

export function CrmFacebookStudio({
  workspaceId,
  connectionId,
}: {
  workspaceId: string
  connectionId?: string
}) {
  const [range, setRange] = useState<CrmFacebookInsightsRange>('28d')
  const [message, setMessage] = useState('')
  const [imageFile, setImageFile] = useState<File | undefined>()
  const [videoFile, setVideoFile] = useState<File | undefined>()
  const [selectedPost, setSelectedPost] = useState<CrmFacebookPost | null>(null)

  const overviewQuery = useCrmFacebookOverview(workspaceId, connectionId)
  const postsQuery = useCrmFacebookPosts(workspaceId, connectionId)
  const insightsQuery = useCrmFacebookInsights(workspaceId, range, connectionId)
  const deletePost = useDeleteCrmFacebookPost(workspaceId, connectionId)

  const overview = overviewQuery.data
  const posts = postsQuery.data
  const insights = insightsQuery.data

  if (overviewQuery.isLoading) {
    return (
      <div className='mx-auto w-full max-w-5xl space-y-6 py-6'>
        <Skeleton className='h-20 w-full' />
        <div className='grid grid-cols-2 gap-3'>
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
          : 'Não foi possível carregar a Página.'}
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
        {overview.pictureUrl ? (
          <img
            src={overview.pictureUrl}
            alt={overview.name}
            className='size-16 rounded-full border border-border/70'
          />
        ) : (
          <div className='flex size-16 items-center justify-center rounded-full bg-blue-600/10 text-blue-600'>
            <SteelIcon icon={Facebook01Icon} className='size-7' />
          </div>
        )}
        <div className='min-w-0'>
          <h2 className='truncate font-heading font-semibold text-xl tracking-tight'>
            {overview.name}
          </h2>
          {overview.link ? (
            <a
              href={overview.link}
              target='_blank'
              rel='noreferrer'
              className='truncate text-muted-foreground text-sm hover:text-foreground'
            >
              Abrir Página
            </a>
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
          <div className='grid grid-cols-2 gap-3'>
            <StatCard
              icon={FavouriteIcon}
              label='Curtidas'
              value={overview.fanCount}
            />
            <StatCard
              icon={UserMultipleIcon}
              label='Seguidores'
              value={overview.followersCount}
            />
          </div>

          {posts && posts.posts.length > 0 ? (
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
              {posts.posts.map((post) => {
                const text = post.message ?? post.story
                const date = post.createdTime
                  ? new Date(post.createdTime).toLocaleDateString('pt-BR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : null
                return (
                  <button
                    key={post.id}
                    type='button'
                    onClick={() => setSelectedPost(post)}
                    className='block cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  >
                    <Card size='sm' className='overflow-hidden p-0'>
                      {post.fullPicture && (
                        <div className='relative aspect-square w-full bg-muted'>
                          <img
                            src={post.fullPicture}
                            alt=''
                            className='size-full object-cover'
                          />
                          {post.isVideo && (
                            <div className='absolute inset-0 flex items-center justify-center'>
                              <div className='flex size-8 items-center justify-center rounded-full bg-black/50 text-white'>
                                <SteelIcon icon={PlayIcon} className='size-4' />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className='space-y-1 p-2.5'>
                        {text && (
                          <p className='line-clamp-2 text-xs leading-relaxed'>
                            {text}
                          </p>
                        )}
                        {date && (
                          <p className='text-muted-foreground text-[11px]'>
                            {date}
                          </p>
                        )}
                      </div>
                    </Card>
                  </button>
                )
              })}
            </div>
          ) : posts && posts.posts.length === 0 ? (
            <Card className='px-4 py-10 text-center text-muted-foreground text-sm'>
              <SteelIcon
                icon={Facebook01Icon}
                className='mx-auto mb-2 size-6 opacity-60'
              />
              Nenhuma publicação recente.
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value='post'>
          <div className='grid gap-6 lg:grid-cols-2'>
            <div className='space-y-3'>
              <h3 className='font-heading font-semibold text-base tracking-tight'>
                Publicar na Página
              </h3>
              <PostComposer
                workspaceId={workspaceId}
                connectionId={connectionId}
                message={message}
                onMessageChange={setMessage}
                onImageChange={setImageFile}
                onVideoChange={setVideoFile}
              />
            </div>
            <div className='space-y-3'>
              <h3 className='font-heading font-semibold text-base text-muted-foreground tracking-tight'>
                Pré-visualização
              </h3>
              <FacebookPostPreview
                pageName={overview.name}
                avatarUrl={overview.pictureUrl}
                message={message}
                imageFile={imageFile}
                videoFile={videoFile}
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
              onValueChange={(v) => setRange(v as CrmFacebookInsightsRange)}
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
                  label='Impressões'
                  value={insights.totals.impressions}
                />
                <StatCard
                  icon={FavouriteIcon}
                  label='Engajamentos'
                  value={insights.totals.engagements}
                />
                <StatCard
                  icon={UserMultipleIcon}
                  label='Novos fãs'
                  value={insights.totals.fanAdds}
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
                    const s2 = toNivoSeries(
                      insights.series,
                      (p) => p.engagements,
                      gk,
                    )
                    const ticks: string[] | number = gk ? s1.map((d) => d.x) : 7
                    return (
                      <ResponsiveLine
                        data={[
                          { id: 'Impressões', data: s1 },
                          { id: 'Engajamentos', data: s2 },
                        ]}
                        margin={{ top: 36, right: 20, bottom: 64, left: 52 }}
                        colors={['#2563eb', '#22c55e']}
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
        </TabsContent>
      </Tabs>

      <Dialog
        open={selectedPost !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPost(null)
        }}
      >
        <DialogContent className='gap-0 overflow-hidden p-0 sm:max-w-lg'>
          {selectedPost && (
            <FacebookPostModal
              post={selectedPost}
              pageName={overview.name}
              avatarUrl={overview.pictureUrl}
              deleting={deletePost.isPending}
              onDelete={() => {
                deletePost.mutate(selectedPost.id, {
                  onSuccess: () => {
                    notify.success('Publicação excluída.')
                    setSelectedPost(null)
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
