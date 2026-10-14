'use client'

import {
  Analytics01Icon,
  Comment01Icon,
  FavouriteIcon,
  NewTwitterIcon,
  Share08Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
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
import {
  isCrmSocialReconnectError,
  useCrmTwitterOverview,
  useCrmTwitterRecentTweets,
  useDeleteCrmTweet,
  usePublishCrmTweet,
} from '@/src/hooks/use-crm-social-twitter'
import { useCrmTextAi } from '@/src/hooks/use-crm-text-ai'
import type { CrmTweet } from '@/src/schemas/crm-social-twitter.schema'

const TWEET_MAX = 280

const nf = new Intl.NumberFormat('pt-BR')

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
        <SteelIcon icon={NewTwitterIcon} size={24} />
      </div>
      <div className='space-y-1.5'>
        <h2 className='font-heading font-semibold text-xl tracking-tight'>
          Conecte o X (Twitter)
        </h2>
        <p className='text-muted-foreground text-sm'>{message}</p>
      </div>
      <a
        href={`/api/workspaces/${workspaceId}/crm/social/twitter/connect`}
        className={buttonVariants()}
      >
        Conectar X (Twitter)
      </a>
    </div>
  )
}

function TweetPreview({
  name,
  username,
  avatarUrl,
  text,
  imageFile,
}: {
  name?: string | null
  username: string
  avatarUrl?: string | null
  text: string
  imageFile?: File
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  return (
    <div className='mx-auto max-w-[380px] overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm'>
      <div className='flex gap-3 p-3 pb-2'>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={username}
            className='size-10 shrink-0 rounded-full border border-border/50 object-cover'
          />
        ) : (
          <div className='flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-900/10 text-neutral-900 dark:bg-white/10 dark:text-white'>
            <SteelIcon icon={NewTwitterIcon} size={18} />
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1'>
            <span className='truncate font-semibold text-sm'>
              {name ?? username}
            </span>
            <span className='shrink-0 text-muted-foreground text-sm'>
              @{username}
            </span>
          </div>

          {text ? (
            <p className='mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed'>
              {text}
            </p>
          ) : (
            <p className='mt-1 text-muted-foreground/50 text-sm italic'>
              O tweet aparecerá aqui…
            </p>
          )}

          {previewUrl && (
            <div className='mt-2 overflow-hidden rounded-xl border border-border/50'>
              <div className='aspect-video w-full bg-muted'>
                <img
                  src={previewUrl}
                  alt='preview'
                  className='size-full object-cover'
                />
              </div>
            </div>
          )}

          <div className='mt-3 flex items-center gap-5 text-muted-foreground'>
            <span className='flex items-center gap-1.5 text-xs'>
              <SteelIcon icon={Comment01Icon} size={16} />0
            </span>
            <span className='flex items-center gap-1.5 text-xs'>
              <SteelIcon icon={Share08Icon} size={16} />0
            </span>
            <span className='flex items-center gap-1.5 text-xs'>
              <SteelIcon icon={FavouriteIcon} size={16} />0
            </span>
            <span className='flex items-center gap-1.5 text-xs'>
              <SteelIcon icon={Analytics01Icon} size={16} />0
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TweetDetail({
  tweet,
  name,
  username,
  avatarUrl,
  deleting,
  onDelete,
}: {
  tweet: CrmTweet
  name?: string | null
  username: string
  avatarUrl?: string | null
  deleting: boolean
  onDelete: () => void
}) {
  const date = tweet.createdAt
    ? new Date(tweet.createdAt).toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <div className='space-y-4 p-5'>
      <div className='flex items-start gap-3'>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={username}
            className='size-11 shrink-0 rounded-full border border-border/50 object-cover'
          />
        ) : (
          <div className='flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-900/10 text-neutral-900 dark:bg-white/10 dark:text-white'>
            <SteelIcon icon={NewTwitterIcon} size={18} />
          </div>
        )}
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5'>
            <span className='font-semibold text-sm'>{name ?? username}</span>
            <span className='text-muted-foreground text-sm'>@{username}</span>
          </div>
          {date && <p className='text-muted-foreground text-xs'>{date}</p>}
        </div>
        <SteelIcon
          icon={NewTwitterIcon}
          size={20}
          className='ml-auto shrink-0 text-muted-foreground/60'
        />
      </div>

      <p className='whitespace-pre-wrap break-words text-base leading-relaxed'>
        {tweet.text}
      </p>

      {tweet.metrics && (
        <>
          <div className='border-border/60 border-t pt-3'>
            <div className='flex flex-wrap items-center gap-5 text-sm'>
              <span>
                <span className='font-semibold'>
                  {nf.format(tweet.metrics.retweetCount)}
                </span>{' '}
                <span className='text-muted-foreground'>Retweets</span>
              </span>
              <span>
                <span className='font-semibold'>
                  {nf.format(tweet.metrics.likeCount)}
                </span>{' '}
                <span className='text-muted-foreground'>Curtidas</span>
              </span>
              {tweet.metrics.impressionCount > 0 && (
                <span>
                  <span className='font-semibold'>
                    {nf.format(tweet.metrics.impressionCount)}
                  </span>{' '}
                  <span className='text-muted-foreground'>Impressões</span>
                </span>
              )}
            </div>
          </div>

          <div className='flex items-center gap-5 border-border/60 border-t pt-2 text-muted-foreground'>
            <span className='flex items-center gap-2 py-1 text-sm'>
              <SteelIcon icon={Comment01Icon} size={18} />
              {nf.format(tweet.metrics.replyCount)}
            </span>
            <span className='flex items-center gap-2 py-1 text-sm'>
              <SteelIcon icon={Share08Icon} size={18} />
              {nf.format(tweet.metrics.retweetCount)}
            </span>
            <span className='flex items-center gap-2 py-1 text-sm'>
              <SteelIcon icon={FavouriteIcon} size={18} />
              {nf.format(tweet.metrics.likeCount)}
            </span>
            <span className='flex items-center gap-2 py-1 text-sm'>
              <SteelIcon icon={Analytics01Icon} size={18} />
              {nf.format(tweet.metrics.impressionCount)}
            </span>
          </div>
        </>
      )}

      <a
        href={tweet.url}
        target='_blank'
        rel='noreferrer'
        className={`${buttonVariants({ variant: 'outline', size: 'sm' })} block w-full text-center`}
      >
        Abrir no X
      </a>

      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-full text-destructive hover:text-destructive'
            >
              Excluir tweet
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tweet</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita — o tweet será removido do X.
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
    </div>
  )
}

function TweetComposer({
  workspaceId,
  text,
  onTextChange,
  onImageChange,
}: {
  workspaceId: string
  text: string
  onTextChange: (v: string) => void
  onImageChange: (f: File | undefined) => void
}) {
  const publish = usePublishCrmTweet(workspaceId)
  const assistText = useCrmTextAi(workspaceId, 'SOCIAL', () => ({
    platform: 'X (Twitter)',
  }))

  const remaining = TWEET_MAX - text.length
  const canSubmit =
    text.trim().length > 0 && remaining >= 0 && !publish.isPending

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)

    try {
      const result = await publish.mutateAsync(form)
      toast.success('Tweet publicado.', {
        action: result.permalink
          ? {
              label: 'Abrir',
              onClick: () => window.open(result.permalink ?? '', '_blank'),
            }
          : undefined,
      })
      formEl.reset()
      onTextChange('')
      onImageChange(undefined)
    } catch (error) {
      if (isCrmSocialReconnectError(error)) {
        toast.error(`${error.message} Reconecte a conta nas configurações.`)
      } else {
        toast.error(
          error instanceof Error ? error.message : 'Falha ao publicar.',
        )
      }
    }
  }

  return (
    <Card className='p-4 sm:p-6'>
      <GhostAiProvider assist={assistText}>
        <form className='space-y-4' onSubmit={handleSubmit}>
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='tw-text'>Tweet</Label>
              <span
                className={`text-xs tabular-nums ${
                  remaining < 0 ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {remaining}
              </span>
            </div>
            <AiTextarea
              id='tw-text'
              aiLabel='Texto do post'
              name='text'
              rows={5}
              maxLength={TWEET_MAX}
              placeholder='O que está acontecendo?'
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='tw-image'>Imagem (opcional)</Label>
            <Input
              id='tw-image'
              name='image'
              type='file'
              accept='image/jpeg,image/png,image/webp,image/gif'
              onChange={(e) => onImageChange(e.target.files?.[0])}
            />
            <p className='text-muted-foreground text-xs'>
              JPEG, PNG, WebP ou GIF, até 10 MB. O upload de mídia depende do
              nível de acesso do app no X.
            </p>
          </div>

          <div className='flex justify-end'>
            <Button type='submit' disabled={!canSubmit}>
              {publish.isPending ? 'Publicando…' : 'Publicar'}
            </Button>
          </div>
        </form>
      </GhostAiProvider>
    </Card>
  )
}

export function CrmTwitterStudio({ workspaceId }: { workspaceId: string }) {
  const overviewQuery = useCrmTwitterOverview(workspaceId)
  const tweetsQuery = useCrmTwitterRecentTweets(workspaceId)
  const deleteTweet = useDeleteCrmTweet(workspaceId)

  const overview = overviewQuery.data
  const tweets = tweetsQuery.data

  const [text, setText] = useState('')
  const [imageFile, setImageFile] = useState<File | undefined>()
  const [selectedTweet, setSelectedTweet] = useState<CrmTweet | null>(null)

  if (overviewQuery.isLoading && !overview) {
    return (
      <div className='mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-56 w-full' />
      </div>
    )
  }

  if (
    !overview &&
    overviewQuery.error &&
    isCrmSocialReconnectError(overviewQuery.error)
  ) {
    return (
      <div className='px-4 py-6 sm:px-6'>
        <ReconnectNotice
          workspaceId={workspaceId}
          message={overviewQuery.error.message}
        />
      </div>
    )
  }

  if (!overview) {
    return (
      <div className='px-4 py-6 text-center text-muted-foreground text-sm sm:px-6'>
        {overviewQuery.error?.message ?? 'Não foi possível carregar o perfil.'}
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

  return (
    <div className='mx-auto w-full max-w-5xl px-4 py-6 sm:px-6'>
      <header className='mb-6 flex items-center gap-4'>
        {overview.profileImageUrl ? (
          <img
            src={overview.profileImageUrl}
            alt={overview.username}
            className='size-16 rounded-full border border-border/70'
          />
        ) : (
          <div className='flex size-16 items-center justify-center rounded-full bg-neutral-900/10 text-neutral-900 dark:bg-white/10 dark:text-white'>
            <SteelIcon icon={NewTwitterIcon} size={28} />
          </div>
        )}
        <div className='min-w-0'>
          <h2 className='truncate font-heading font-semibold text-xl tracking-tight'>
            {overview.name ?? `@${overview.username}`}
          </h2>
          {overview.username ? (
            <p className='truncate text-muted-foreground text-sm'>
              @{overview.username}
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

        <TabsContent value='overview' className='space-y-3'>
          {tweets && tweets.tweets.length > 0 ? (
            tweets.tweets.map((tweet) => {
              const date = tweet.createdAt
                ? new Date(tweet.createdAt).toLocaleDateString('pt-BR', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : null
              return (
                <button
                  key={tweet.id}
                  type='button'
                  onClick={() => setSelectedTweet(tweet)}
                  className='block w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
                >
                  <Card className='space-y-2 p-3 transition-colors hover:bg-muted/40'>
                    <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
                      {tweet.text}
                    </p>
                    <div className='flex items-center gap-4 text-muted-foreground text-xs'>
                      {tweet.metrics && (
                        <>
                          <span className='flex items-center gap-1'>
                            <SteelIcon icon={FavouriteIcon} size={14} />
                            {tweet.metrics.likeCount}
                          </span>
                          <span className='flex items-center gap-1'>
                            <SteelIcon icon={Share08Icon} size={14} />
                            {tweet.metrics.retweetCount}
                          </span>
                          <span className='flex items-center gap-1'>
                            <SteelIcon icon={Comment01Icon} size={14} />
                            {tweet.metrics.replyCount}
                          </span>
                          <span className='flex items-center gap-1'>
                            <SteelIcon icon={Analytics01Icon} size={14} />
                            {tweet.metrics.impressionCount}
                          </span>
                        </>
                      )}
                      {date && <span className='ml-auto'>{date}</span>}
                    </div>
                  </Card>
                </button>
              )
            })
          ) : (
            <Card className='px-4 py-6 text-center text-muted-foreground text-sm'>
              <SteelIcon
                icon={NewTwitterIcon}
                size={32}
                className='mx-auto mb-3 opacity-40'
              />
              <p>
                Nenhum tweet recente encontrado ou acesso à timeline não
                disponível no plano atual da API do X.
              </p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value='post'>
          <div className='grid gap-6 lg:grid-cols-2'>
            <div className='space-y-3'>
              <h3 className='font-heading font-semibold text-base tracking-tight'>
                Publicar
              </h3>
              <TweetComposer
                workspaceId={workspaceId}
                text={text}
                onTextChange={setText}
                onImageChange={setImageFile}
              />
            </div>
            <div className='space-y-3'>
              <h3 className='font-heading font-semibold text-base text-muted-foreground tracking-tight'>
                Pré-visualização
              </h3>
              <TweetPreview
                name={overview.name}
                username={overview.username}
                avatarUrl={overview.profileImageUrl}
                text={text}
                imageFile={imageFile}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value='analytics'>
          <Card className='px-4 py-6 text-center text-muted-foreground text-sm'>
            <SteelIcon
              icon={Analytics01Icon}
              size={32}
              className='mx-auto mb-3 opacity-40'
            />
            <p>
              Analytics não estão disponíveis no plano gratuito da API do X
              (Twitter).
            </p>
            <p className='mt-1 text-xs'>
              Um plano Basic ou superior é necessário para acessar métricas de
              tweets.
            </p>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={selectedTweet !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedTweet(null)
        }}
      >
        <DialogContent className='gap-0 overflow-hidden p-0 sm:max-w-md'>
          {selectedTweet && (
            <TweetDetail
              tweet={selectedTweet}
              name={overview.name}
              username={overview.username}
              avatarUrl={overview.profileImageUrl}
              deleting={
                deleteTweet.isPending &&
                deleteTweet.variables === selectedTweet.id
              }
              onDelete={() => {
                deleteTweet.mutate(selectedTweet.id, {
                  onSuccess: () => {
                    toast.success('Tweet excluído.')
                    setSelectedTweet(null)
                  },
                  onError: (error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : 'Falha ao excluir o tweet',
                    ),
                })
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
