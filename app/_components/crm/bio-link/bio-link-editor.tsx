'use client'

import {
  ArrowLeft01Icon,
  Image01Icon,
  SmartPhone01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MediaPickButton } from '@/app/_components/crm/sites/media-pick-button'
import { SiteStatusBadge } from '@/app/_components/crm/sites/site-status-badge'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  bioLinkKeys,
  bioLinksApi,
  useBioLink,
  useBioLinkOptions,
} from '@/src/hooks/use-bio-links'
import { crmSitesApi } from '@/src/hooks/use-crm-sites'
import { bioBlockProblem } from '@/src/lib/bio-link/blocks'
import { isValidBioSlug } from '@/src/lib/bio-link/slug'
import type {
  BioBlockDTO,
  BioThemeDTO,
  UpdateBioLinkDTO,
} from '@/src/schemas/bio-link.schema'
import type { BioLinkDTO } from '@/types/bio-link'
import { BioAppearancePanel } from './bio-appearance-panel'
import { BioBlockList } from './bio-block-list'
import { BioMetricsPanel } from './bio-metrics-panel'
import { BioPhonePreview } from './bio-phone-preview'
import { BioSharePanel } from './bio-share-panel'

interface Draft {
  name: string
  slug: string
  title: string
  description: string
  avatarUrl: string | null
  theme: BioThemeDTO
  blocks: BioBlockDTO[]
  noIndex: boolean
}

function toDraft(page: BioLinkDTO): Draft {
  return {
    name: page.name,
    slug: page.slug,
    title: page.title ?? '',
    description: page.description ?? '',
    avatarUrl: page.avatarUrl,
    theme: page.theme,
    blocks: page.blocks,
    noIndex: page.noIndex,
  }
}

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function ProfileSection({
  workspaceId,
  draft,
  onChange,
}: {
  workspaceId: string
  draft: Draft
  onChange: (patch: Partial<Draft>) => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function upload(file: File | undefined) {
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type)) {
      notify.error('Use uma imagem JPG, PNG ou WebP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      notify.error('A imagem deve ter até 5 MB.')
      return
    }
    setUploading(true)
    try {
      const item = await crmSitesApi(workspaceId).uploadMedia(file)
      onChange({ avatarUrl: item.url })
    } catch (error) {
      notify.error(error, 'Não foi possível enviar a imagem')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section className='grid gap-4'>
      <h2 className='font-semibold text-base'>Perfil</h2>
      <div className='flex flex-wrap items-center gap-4'>
        {draft.avatarUrl ? (
          <img
            src={draft.avatarUrl}
            alt='Foto ou logo da página'
            className='size-20 shrink-0 rounded-full border object-cover'
          />
        ) : (
          <span className='flex size-20 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground'>
            <SteelIcon icon={Image01Icon} className='size-6' />
          </span>
        )}
        <div className='flex flex-wrap gap-2'>
          <input
            ref={fileRef}
            type='file'
            accept={AVATAR_TYPES.join(',')}
            className='sr-only'
            tabIndex={-1}
            aria-label='Enviar foto ou logo'
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <SteelIcon icon={Image01Icon} data-icon='inline-start' />
            {uploading ? 'Enviando…' : 'Enviar foto ou logo'}
          </Button>
          <MediaPickButton
            workspaceId={workspaceId}
            onPick={(url) => onChange({ avatarUrl: url })}
          />
          {draft.avatarUrl ? (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onChange({ avatarUrl: null })}
            >
              Remover
            </Button>
          ) : null}
        </div>
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor={titleId}>Nome na página</Label>
        <Input
          id={titleId}
          value={draft.title}
          maxLength={80}
          placeholder={draft.name}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor={descriptionId}>Descrição</Label>
        <Textarea
          id={descriptionId}
          value={draft.description}
          maxLength={300}
          rows={3}
          placeholder='Conte em uma frase o que você faz.'
          onChange={(event) => onChange({ description: event.target.value })}
        />
        <p className='text-right text-muted-foreground text-xs'>
          {draft.description.length}/300
        </p>
      </div>
    </section>
  )
}

function EditorSkeleton() {
  return (
    <div className='mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 sm:px-6'>
      <Skeleton className='h-9 w-1/2' />
      <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <div className='grid gap-3'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-24 w-full' />
        </div>
        <Skeleton className='hidden h-[580px] w-[300px] rounded-[2.6rem] lg:block' />
      </div>
    </div>
  )
}

function Editor({
  workspaceId,
  slug,
  page,
}: {
  workspaceId: string
  slug: string
  page: BioLinkDTO
}) {
  const queryClient = useQueryClient()
  const canEdit = useCan('landing-pages', 'EDIT')
  const options = useBioLinkOptions(workspaceId)
  const [saved, setSaved] = useState(page)
  const [draft, setDraft] = useState<Draft>(() => toDraft(page))
  const [busy, setBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const nameId = useId()

  const dirty = useMemo(
    () => JSON.stringify(toDraft(saved)) !== JSON.stringify(draft),
    [saved, draft],
  )
  const problems = useMemo(
    () => draft.blocks.filter((block) => bioBlockProblem(block) !== null),
    [draft.blocks],
  )
  const lock = !canEdit || busy
  const slugValid = isValidBioSlug(draft.slug)
  const nameValid = draft.name.trim().length > 0
  const canSave =
    canEdit && !busy && problems.length === 0 && slugValid && nameValid

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = (partial: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...partial }))

  async function persist(status?: 'DRAFT' | 'PUBLISHED') {
    if (!canSave) return
    setBusy(true)
    const body: UpdateBioLinkDTO = {
      name: draft.name.trim(),
      slug: draft.slug,
      title: draft.title.trim() || null,
      description: draft.description.trim() || null,
      avatarUrl: draft.avatarUrl,
      theme: draft.theme,
      blocks: draft.blocks,
      noIndex: draft.noIndex,
      ...(status ? { status } : {}),
    }
    try {
      const updated = await bioLinksApi(workspaceId).update(page.id, body)
      queryClient.setQueryData(
        bioLinkKeys.detail(workspaceId, page.id),
        updated,
      )
      void queryClient.invalidateQueries({
        queryKey: bioLinkKeys.list(workspaceId),
      })
      setSaved(updated)
      setDraft(toDraft(updated))
      notify.success(
        status === 'PUBLISHED'
          ? 'Página publicada.'
          : status === 'DRAFT'
            ? 'Página despublicada.'
            : updated.status === 'PUBLISHED'
              ? 'Alterações salvas e no ar.'
              : 'Rascunho salvo.',
      )
    } catch (error) {
      notify.error(error, 'Não foi possível salvar a página')
    } finally {
      setBusy(false)
    }
  }

  const published = saved.status === 'PUBLISHED'
  const preview = (
    <BioPhonePreview
      draft={{
        name: draft.name,
        title: draft.title,
        description: draft.description,
        avatarUrl: draft.avatarUrl,
        theme: draft.theme,
        blocks: draft.blocks,
      }}
    />
  )

  return (
    <div className='mx-auto grid w-full max-w-6xl gap-5 px-4 py-5 sm:px-6'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        <Link
          href={`/${slug}/crm/bio-links`}
          aria-label='Voltar para as páginas'
          className='flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
        </Link>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <h1 className='truncate font-semibold text-lg'>{saved.name}</h1>
          <SiteStatusBadge status={saved.status} />
          {dirty ? (
            <span
              role='status'
              className='shrink-0 text-muted-foreground text-xs'
            >
              Alterações não salvas
            </span>
          ) : null}
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            className='lg:hidden'
            onClick={() => setPreviewOpen(true)}
          >
            <SteelIcon icon={SmartPhone01Icon} data-icon='inline-start' />
            Prévia
          </Button>
          {canEdit ? (
            published ? (
              <>
                <Button
                  type='button'
                  variant='outline'
                  disabled={!canSave}
                  onClick={() => void persist('DRAFT')}
                >
                  Despublicar
                </Button>
                <Button
                  type='button'
                  disabled={!canSave || !dirty}
                  onClick={() => void persist()}
                  data-testid='bio-save'
                >
                  {busy ? 'Salvando…' : 'Salvar alterações'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type='button'
                  variant='outline'
                  disabled={!canSave || !dirty}
                  onClick={() => void persist()}
                  data-testid='bio-save'
                >
                  {busy ? 'Salvando…' : 'Salvar rascunho'}
                </Button>
                <Button
                  type='button'
                  disabled={!canSave}
                  onClick={() => void persist('PUBLISHED')}
                  data-testid='bio-publish'
                >
                  Publicar
                </Button>
              </>
            )
          ) : null}
        </div>
      </div>
      {problems.length > 0 ? (
        <p role='alert' className='text-destructive text-sm'>
          {problems.length === 1
            ? 'Há 1 item com problema, destacado na lista. Corrija para salvar.'
            : `Há ${problems.length} itens com problema, destacados na lista. Corrija para salvar.`}
        </p>
      ) : null}

      <div className='grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]'>
        <Tabs defaultValue='content' className='min-w-0'>
          <TabsList className='w-full justify-start overflow-x-auto sm:w-fit'>
            <TabsTrigger value='content'>Conteúdo</TabsTrigger>
            <TabsTrigger value='appearance'>Aparência</TabsTrigger>
            <TabsTrigger value='share'>Compartilhar</TabsTrigger>
            <TabsTrigger value='metrics'>Métricas</TabsTrigger>
          </TabsList>

          <TabsContent value='content' className='pt-4'>
            <fieldset disabled={lock} className='grid gap-8'>
              <ProfileSection
                workspaceId={workspaceId}
                draft={draft}
                onChange={patch}
              />
              <section className='grid gap-3'>
                <div>
                  <h2 className='font-semibold text-base'>Itens da página</h2>
                  <p className='text-muted-foreground text-sm'>
                    Arraste para mudar a ordem. Use o interruptor para ocultar
                    um item sem apagar.
                  </p>
                </div>
                <BioBlockList
                  blocks={draft.blocks}
                  options={options.data}
                  disabled={!canEdit}
                  onChange={(blocks) => patch({ blocks })}
                />
              </section>
            </fieldset>
          </TabsContent>

          <TabsContent value='appearance' className='pt-4'>
            <fieldset disabled={lock}>
              <BioAppearancePanel
                theme={draft.theme}
                onChange={(theme) => patch({ theme })}
              />
            </fieldset>
          </TabsContent>

          <TabsContent value='share' className='pt-4'>
            <fieldset disabled={lock} className='grid gap-6'>
              <div className='grid gap-1.5'>
                <Label htmlFor={nameId}>Nome interno</Label>
                <Input
                  id={nameId}
                  value={draft.name}
                  maxLength={80}
                  aria-invalid={!nameValid}
                  onChange={(event) => patch({ name: event.target.value })}
                />
                <p className='text-muted-foreground text-xs'>
                  Só aparece para você, na lista de páginas.
                </p>
              </div>
              <BioSharePanel
                workspaceId={workspaceId}
                bioLinkId={page.id}
                slug={draft.slug}
                savedSlug={saved.slug}
                url={saved.url}
                published={published}
                noIndex={draft.noIndex}
                onSlugChange={(next) => patch({ slug: next })}
                onNoIndexChange={(noIndex) => patch({ noIndex })}
              />
            </fieldset>
          </TabsContent>

          <TabsContent value='metrics' className='pt-4'>
            <BioMetricsPanel workspaceId={workspaceId} bioLinkId={page.id} />
          </TabsContent>
        </Tabs>

        <aside
          aria-label='Pré-visualização'
          className='sticky top-4 hidden lg:block'
        >
          {preview}
          <p className='mt-2 text-center text-muted-foreground text-xs'>
            Pré-visualização ao vivo
          </p>
        </aside>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>Pré-visualização</DialogTitle>
            <DialogDescription>
              Assim a página aparece no celular.
            </DialogDescription>
          </DialogHeader>
          {previewOpen ? preview : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** CRM › Atrair › Link da bio › editor of one page. */
export function BioLinkEditor({
  workspaceId,
  slug,
  bioLinkId,
}: {
  workspaceId: string
  slug: string
  bioLinkId: string
}) {
  const query = useBioLink(workspaceId, bioLinkId)
  if (query.isLoading) return <EditorSkeleton />
  if (query.error || !query.data) {
    return (
      <div className='mx-auto grid w-full max-w-md gap-3 px-4 py-16 text-center'>
        <p className='text-muted-foreground text-sm'>
          Não foi possível abrir esta página. Ela pode ter sido excluída.
        </p>
        <div className='flex justify-center gap-2'>
          <Button variant='outline' onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
          <Link
            href={`/${slug}/crm/bio-links`}
            className='inline-flex h-9 items-center rounded-md px-3 text-sm hover:bg-muted'
          >
            Voltar para a lista
          </Link>
        </div>
      </div>
    )
  }
  return <Editor workspaceId={workspaceId} slug={slug} page={query.data} />
}
