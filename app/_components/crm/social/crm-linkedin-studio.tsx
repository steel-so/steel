'use client'

import {
  Analytics01Icon,
  Comment01Icon,
  FavouriteIcon,
  Linkedin01Icon,
  Mail01Icon,
  Share01Icon,
  UserCircleIcon,
  UserMultipleIcon,
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
import { GhostAiProvider } from '@/components/ui/ghost-ai'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  isCrmSocialReconnectError,
  useCrmLinkedinOverview,
  useDeleteCrmLinkedinPost,
  usePublishCrmLinkedinPost,
} from '@/src/hooks/use-crm-social-linkedin'
import { useCrmTextAi } from '@/src/hooks/use-crm-text-ai'
import type { CrmLinkedinOverview } from '@/src/schemas/crm-social-linkedin.schema'

const POST_MAX = 3000

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
        <SteelIcon icon={Linkedin01Icon} size={24} className='text-blue-700' />
      </div>
      <div className='space-y-1.5'>
        <h2 className='font-heading font-semibold text-xl tracking-tight'>
          Conecte o LinkedIn
        </h2>
        <p className='text-muted-foreground text-sm'>{message}</p>
      </div>
      <a
        href={`/api/workspaces/${workspaceId}/crm/social/linkedin/connect`}
        className={buttonVariants()}
      >
        Conectar LinkedIn
      </a>
    </div>
  )
}

function LinkedinPostPreview({
  name,
  picture,
  text,
  imageFile,
}: {
  name: string | null
  picture: string | null
  text: string
  imageFile?: File | null
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
    <div className='w-full overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm'>
      <div className='flex items-start gap-3 p-4 pb-3'>
        {picture ? (
          <img
            src={picture}
            alt={name ?? 'Perfil'}
            className='size-12 shrink-0 rounded-full object-cover'
          />
        ) : (
          <div className='flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-700/10'>
            <SteelIcon
              icon={UserCircleIcon}
              size={28}
              className='text-blue-700'
            />
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <p className='font-semibold text-sm leading-snug'>
            {name ?? 'Seu nome'}
          </p>
          <p className='mt-0.5 text-muted-foreground/60 text-xs'>Agora · 🌐</p>
        </div>
      </div>
      <div className='px-4 pb-4'>
        {text ? (
          <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
            {text}
          </p>
        ) : (
          <p className='text-muted-foreground/40 text-sm italic'>
            O conteúdo do post aparecerá aqui…
          </p>
        )}
      </div>
      {previewUrl && (
        <div className='aspect-video w-full border-border/60 border-t bg-muted'>
          <img
            src={previewUrl}
            alt='preview'
            className='size-full object-cover'
          />
        </div>
      )}
      <div className='border-border/60 border-t px-4 py-2.5'>
        <div className='flex items-center gap-5 text-muted-foreground text-xs'>
          <span className='flex items-center gap-1.5'>
            <SteelIcon icon={FavouriteIcon} size={16} />
            Curtir
          </span>
          <span className='flex items-center gap-1.5'>
            <SteelIcon icon={Comment01Icon} size={16} />
            Comentar
          </span>
          <span className='flex items-center gap-1.5'>
            <SteelIcon icon={Share01Icon} size={16} />
            Compartilhar
          </span>
        </div>
      </div>
    </div>
  )
}

function PostComposer({
  workspaceId,
  overview,
}: {
  workspaceId: string
  overview: CrmLinkedinOverview
}) {
  const publish = usePublishCrmLinkedinPost(workspaceId)
  const assistText = useCrmTextAi(workspaceId, 'SOCIAL', () => ({
    platform: 'LinkedIn',
  }))
  const deletePost = useDeleteCrmLinkedinPost(workspaceId)
  const [text, setText] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [lastPostUrn, setLastPostUrn] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData()
    form.set('text', text)
    if (image) form.set('image', image)

    try {
      const result = await publish.mutateAsync(form)
      toast.success('Post publicado no LinkedIn.')
      setText('')
      setImage(null)
      setLastPostUrn(
        result.postUrn && result.postUrn !== 'unknown' ? result.postUrn : null,
      )
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
    <div className='grid gap-6 lg:grid-cols-2'>
      <div className='space-y-3'>
        <h3 className='font-heading font-semibold text-base tracking-tight'>
          Publicar no LinkedIn
        </h3>
        <Card className='p-4 sm:p-6'>
          <GhostAiProvider assist={assistText}>
            <form onSubmit={handleSubmit} className='flex flex-col gap-3'>
              <AiTextarea
                aiLabel='Texto do post'
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='O que você quer compartilhar?'
                rows={6}
                maxLength={POST_MAX}
                className='resize-none'
              />
              <div className='space-y-1.5'>
                <Label htmlFor='li-image'>Imagem (opcional)</Label>
                <Input
                  id='li-image'
                  type='file'
                  accept='image/jpeg,image/png,image/webp,image/gif'
                  onChange={(e) => setImage(e.target.files?.[0] ?? null)}
                />
                <p className='text-muted-foreground text-xs'>
                  JPEG, PNG, WebP ou GIF, até 10 MB.
                </p>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-xs'>
                  {text.length}/{POST_MAX}
                </span>
                <Button
                  type='submit'
                  size='sm'
                  disabled={!text.trim() || publish.isPending}
                >
                  <SteelIcon icon={Share01Icon} size={14} className='mr-1.5' />
                  {publish.isPending ? 'Publicando…' : 'Publicar'}
                </Button>
              </div>
            </form>
          </GhostAiProvider>
        </Card>

        {lastPostUrn && (
          <Card className='flex items-center justify-between gap-3 p-3'>
            <p className='text-muted-foreground text-xs'>
              Publicado. O LinkedIn não lista posts antigos via API, então só é
              possível excluir o que acabou de ser publicado.
            </p>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='shrink-0 text-destructive hover:text-destructive'
                  >
                    Excluir
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir publicação</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação não pode ser desfeita — a publicação será removida
                    do LinkedIn.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deletePost.isPending}>
                    Cancelar
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant='destructive'
                    disabled={deletePost.isPending}
                    onClick={() => {
                      deletePost.mutate(lastPostUrn, {
                        onSuccess: () => {
                          toast.success('Publicação excluída.')
                          setLastPostUrn(null)
                        },
                        onError: (error) =>
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : 'Falha ao excluir a publicação',
                          ),
                      })
                    }}
                  >
                    {deletePost.isPending ? 'Excluindo…' : 'Excluir'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Card>
        )}
      </div>
      <div className='space-y-3'>
        <h3 className='font-heading font-semibold text-base text-muted-foreground tracking-tight'>
          Pré-visualização
        </h3>
        <LinkedinPostPreview
          name={overview.name}
          picture={overview.picture}
          text={text}
          imageFile={image}
        />
      </div>
    </div>
  )
}

export function CrmLinkedinStudio({ workspaceId }: { workspaceId: string }) {
  const overviewQuery = useCrmLinkedinOverview(workspaceId)
  const overview = overviewQuery.data

  if (overviewQuery.isLoading && !overview) {
    return (
      <div className='mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-40 w-full' />
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
        {overview.picture ? (
          <img
            src={overview.picture}
            alt={overview.name ?? 'LinkedIn'}
            className='size-16 rounded-full border border-border/70 object-cover'
          />
        ) : (
          <div className='flex size-16 items-center justify-center rounded-full bg-blue-700/10 text-blue-700'>
            <SteelIcon icon={Linkedin01Icon} size={28} />
          </div>
        )}
        <div className='min-w-0'>
          <h2 className='truncate font-heading font-semibold text-xl tracking-tight'>
            {overview.name ?? 'LinkedIn'}
          </h2>
          {overview.headline && (
            <p className='truncate text-muted-foreground text-sm'>
              {overview.headline}
            </p>
          )}
          {overview.email && (
            <p className='flex items-center gap-1 truncate text-muted-foreground text-xs'>
              <SteelIcon icon={Mail01Icon} size={14} className='shrink-0' />
              {overview.email}
            </p>
          )}
        </div>
      </header>

      <Tabs defaultValue='overview'>
        <div className='mb-6 border-border/60 border-b'>
          <TabsList variant='line' className='w-full justify-start'>
            <TabsTrigger value='overview'>Visão Geral</TabsTrigger>
            <TabsTrigger value='post'>Post</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value='overview' className='space-y-4'>
          <Card className='divide-y divide-border/60'>
            <div className='flex items-center gap-3 p-4'>
              <SteelIcon
                icon={UserCircleIcon}
                size={16}
                className='shrink-0 text-muted-foreground'
              />
              <span className='w-24 shrink-0 text-muted-foreground text-sm'>
                Nome
              </span>
              <span className='font-medium text-sm'>
                {overview.name ?? '—'}
              </span>
            </div>
            {overview.headline && (
              <div className='flex items-start gap-3 p-4'>
                <SteelIcon
                  icon={UserMultipleIcon}
                  size={16}
                  className='mt-0.5 shrink-0 text-muted-foreground'
                />
                <span className='w-24 shrink-0 text-muted-foreground text-sm'>
                  Cargo
                </span>
                <span className='text-sm'>{overview.headline}</span>
              </div>
            )}
            {overview.email && (
              <div className='flex items-center gap-3 p-4'>
                <SteelIcon
                  icon={Mail01Icon}
                  size={16}
                  className='shrink-0 text-muted-foreground'
                />
                <span className='w-24 shrink-0 text-muted-foreground text-sm'>
                  Email
                </span>
                <span className='text-sm'>{overview.email}</span>
              </div>
            )}
          </Card>
          <Card className='flex items-start gap-3 p-4'>
            <SteelIcon
              icon={Analytics01Icon}
              size={16}
              className='mt-0.5 shrink-0 text-muted-foreground'
            />
            <p className='text-muted-foreground text-sm'>
              Métricas avançadas (impressões, engajamento) estão disponíveis
              apenas para contas com acesso ao{' '}
              <span className='font-medium text-foreground'>
                LinkedIn Marketing Partner Program
              </span>
              .
            </p>
          </Card>
        </TabsContent>

        <TabsContent value='post'>
          <PostComposer workspaceId={workspaceId} overview={overview} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
