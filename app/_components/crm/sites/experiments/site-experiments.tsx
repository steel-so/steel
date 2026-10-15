'use client'

import {
  Add01Icon,
  ArrowLeft01Icon,
  Delete02Icon,
  FlaskConicalIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilEdit02Icon,
  PlayIcon,
  Refresh01Icon,
  Settings02Icon,
  StopIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useId, useMemo, useState } from 'react'
import { EmptyState } from '@/app/_components/steel-ai-usage/usage-charts'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { useCrmSite, useSiteForms } from '@/src/hooks/use-crm-sites'
import {
  useSiteExperimentMutations,
  useSiteExperiments,
} from '@/src/hooks/use-site-experiments'
import { DEFAULT_SITE_TIMEZONE } from '@/src/schemas/site.schema'
import type { SiteExperimentAction } from '@/src/schemas/site-experiment.schema'
import type { SitePageSummaryDTO } from '@/types/site'
import type {
  SiteExperimentDTO,
  SiteExperimentVariantKey,
} from '@/types/site-experiment'
import { SiteStatusBadge } from '../site-status-badge'
import { ExperimentResults } from './experiment-results'
import { ExperimentSettingsDialog } from './experiment-settings-dialog'
import { formatSiteDay, goalLabel, scheduleLabel } from './format'
import { ExperimentStateBadge } from './state-badge'

/** Results refresh while a test is on the air. */
export const RESULTS_REFRESH_MS = 30_000

const ACTION_COPY: Record<SiteExperimentAction, string> = {
  start: 'Teste iniciado: o site no ar já divide o tráfego.',
  pause: 'Teste pausado: todos veem o original.',
  resume: 'Teste retomado.',
  stop: 'Teste encerrado: todos veem o original.',
  restart: 'Teste reiniciado: os resultados recomeçam do zero.',
}

function primaryAction(experiment: SiteExperimentDTO): {
  action: SiteExperimentAction
  label: string
  icon: typeof PlayIcon
} | null {
  if (experiment.status === 'DRAFT') {
    return { action: 'start', label: 'Iniciar', icon: PlayIcon }
  }
  if (experiment.status === 'PAUSED') {
    return { action: 'resume', label: 'Retomar', icon: PlayIcon }
  }
  if (experiment.status === 'RUNNING' && experiment.state !== 'ENDED') {
    return { action: 'pause', label: 'Pausar', icon: PauseIcon }
  }
  return null
}

function ExperimentCard({
  experiment,
  pages,
  formNames,
  timezone,
  canEdit,
  editorHref,
  onAction,
  onSettings,
  onApply,
  onRemove,
}: {
  experiment: SiteExperimentDTO
  pages: SitePageSummaryDTO[]
  formNames: Record<string, string>
  timezone: string
  canEdit: boolean
  editorHref: string
  onAction: (action: SiteExperimentAction) => void
  onSettings: () => void
  onApply: (key: SiteExperimentVariantKey) => void
  onRemove: () => void
}) {
  const pageTitles = useMemo(
    () => Object.fromEntries(pages.map((page) => [page.id, page.title])),
    [pages],
  )
  const page = pageTitles[experiment.pageId] ?? 'Página removida'
  const schedule = scheduleLabel(experiment, timezone)
  const main = canEdit ? primaryAction(experiment) : null
  const open = experiment.status !== 'ENDED'
  const missing = experiment.unpublishedVariants

  return (
    <article
      className='grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:p-5'
      data-testid='experiment-card'
      aria-labelledby={`experiment-${experiment.id}`}
    >
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='grid min-w-0 gap-1'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <h2
              id={`experiment-${experiment.id}`}
              className='truncate font-semibold text-base'
            >
              {experiment.name}
            </h2>
            <ExperimentStateBadge state={experiment.state} />
          </div>
          <p className='text-muted-foreground text-xs'>
            {experiment.kind === 'SECTION' ? 'Seção' : 'Página inteira'} ·{' '}
            {page} · Meta:{' '}
            {goalLabel(experiment.goal, {
              forms: formNames,
              pages: pageTitles,
            })}
          </p>
          <p className='text-muted-foreground text-xs'>
            {experiment.startedAt
              ? `Rodada ${experiment.run} desde ${formatSiteDay(experiment.startedAt, timezone)}`
              : 'Ainda não começou'}
            {schedule ? ` · ${schedule}` : ''}
          </p>
        </div>
        {canEdit ? (
          <div className='flex items-center gap-1.5'>
            {main ? (
              <Button
                size='sm'
                variant={main.action === 'pause' ? 'outline' : 'default'}
                onClick={() => onAction(main.action)}
                data-testid={`experiment-${main.action}`}
              >
                <SteelIcon icon={main.icon} data-icon='inline-start' />
                {main.label}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Ações de ${experiment.name}`}
                className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-52'>
                {open ? (
                  <DropdownMenuItem onClick={onSettings}>
                    <SteelIcon icon={Settings02Icon} />
                    Configurar
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem render={<Link href={editorHref} />}>
                  <SteelIcon icon={PencilEdit02Icon} />
                  Editar variantes
                </DropdownMenuItem>
                {experiment.status === 'RUNNING' ||
                experiment.status === 'PAUSED' ? (
                  <DropdownMenuItem onClick={() => onAction('restart')}>
                    <SteelIcon icon={Refresh01Icon} />
                    Reiniciar
                  </DropdownMenuItem>
                ) : null}
                {open ? (
                  <DropdownMenuItem onClick={() => onAction('stop')}>
                    <SteelIcon icon={StopIcon} />
                    Encerrar
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive' onClick={onRemove}>
                  <SteelIcon icon={Delete02Icon} />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </header>

      {missing.length > 0 && open ? (
        <p
          role='note'
          className='rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-sm'
        >
          {missing.length === experiment.variants.length
            ? 'Publique o site para iniciar o teste: as variantes ainda não estão no ar.'
            : `Publique o site para iniciar o teste: ${missing
                .map(
                  (key) =>
                    experiment.variants.find((item) => item.key === key)
                      ?.name ?? key,
                )
                .join(
                  ', ',
                )} ainda não ${missing.length > 1 ? 'estão' : 'está'} no ar.`}
        </p>
      ) : null}

      {experiment.winnerKey ? (
        <p
          role='note'
          className='rounded-lg bg-muted px-3 py-2 text-sm'
          data-testid='experiment-applied'
        >
          {experiment.variants.find((item) => item.key === experiment.winnerKey)
            ?.name ?? experiment.winnerKey}{' '}
          foi aplicada ao rascunho. Publique o site para que todos vejam.
        </p>
      ) : null}

      {experiment.status === 'DRAFT' && !experiment.startedAt ? (
        <p className='text-muted-foreground text-sm'>
          Os resultados aparecem aqui depois que o teste começar.
        </p>
      ) : (
        <ExperimentResults
          experiment={experiment}
          canApply={canEdit && !experiment.winnerKey}
          onApply={onApply}
        />
      )}
    </article>
  )
}

function NewPageTestDialog({
  open,
  onOpenChange,
  pages,
  busy,
  onCreate,
  editorHref,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pages: SitePageSummaryDTO[]
  busy: boolean
  onCreate: (input: { name: string; pageId: string }) => void
  editorHref: string
}) {
  const id = useId()
  const [name, setName] = useState('')
  const [pageId, setPageId] = useState<string | null>(null)
  const choices = pages.filter((page) => !page.seo.noindex || page.isHome)
  const valid = name.trim().length > 0 && pageId !== null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md' data-testid='new-experiment'>
        <DialogHeader>
          <DialogTitle>Novo teste de página</DialogTitle>
          <DialogDescription>
            Criamos uma cópia oculta da página (a variante B) para você editar.
            Para testar só uma seção, selecione-a no editor, na aba Testes A/B.
          </DialogDescription>
        </DialogHeader>
        <form
          className='grid gap-4'
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) onCreate({ name: name.trim(), pageId: pageId as string })
          }}
        >
          <div className='grid gap-1.5'>
            <Label htmlFor={`${id}-name`}>Nome do teste</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={120}
              placeholder='Ex.: Página inicial com depoimentos'
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor={`${id}-page`}>Página</Label>
            <Select
              value={pageId}
              onValueChange={(value) =>
                setPageId(typeof value === 'string' ? value : null)
              }
            >
              <SelectTrigger id={`${id}-page`} className='w-full'>
                <SelectValue placeholder='Escolha a página'>
                  {(value: string | null) =>
                    choices.find((page) => page.id === value)?.title ??
                    'Escolha a página'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {choices.map((page) => (
                  <SelectItem key={page.id} value={page.id}>
                    {page.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              nativeButton={false}
              render={<Link href={editorHref} />}
            >
              Testar uma seção no editor
            </Button>
            <Button type='submit' disabled={!valid || busy}>
              {busy ? 'Criando…' : 'Criar teste'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ListSkeleton() {
  return (
    <div className='grid gap-4' aria-busy='true'>
      {[0, 1].map((item) => (
        <Skeleton key={item} className='h-56 rounded-xl' />
      ))}
    </div>
  )
}

/** "Testes A/B" screen of one site: tests, results and their actions. */
export function SiteExperiments({
  workspaceId,
  slug,
  siteId,
}: {
  workspaceId: string
  slug: string
  siteId: string
}) {
  const { site, pages } = useCrmSite(workspaceId, siteId)
  const forms = useSiteForms(workspaceId)
  const canEdit = useCan('landing-pages', 'EDIT')
  const experiments = useSiteExperiments(workspaceId, siteId, {
    refetchInterval: RESULTS_REFRESH_MS,
  })
  const mutations = useSiteExperimentMutations(workspaceId, siteId)
  const [creating, setCreating] = useState(false)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [applying, setApplying] = useState<{
    experiment: SiteExperimentDTO
    key: SiteExperimentVariantKey
  } | null>(null)
  const [removing, setRemoving] = useState<SiteExperimentDTO | null>(null)
  const timezone = site.data?.settings.timezone ?? DEFAULT_SITE_TIMEZONE
  const editorBase = `/${slug}/crm/sites/${siteId}`
  const formNames = useMemo(
    () =>
      Object.fromEntries(
        (forms.data ?? []).map((form) => [form.publicToken, form.name]),
      ),
    [forms.data],
  )
  const list = experiments.data ?? []
  const settingsFor = list.find((item) => item.id === settingsId) ?? null

  async function act(
    experiment: SiteExperimentDTO,
    action: SiteExperimentAction,
  ) {
    try {
      await mutations.transition.mutateAsync({ id: experiment.id, action })
      notify.success(ACTION_COPY[action])
    } catch (error) {
      notify.error(error, 'Não foi possível atualizar o teste')
    }
  }

  async function create(input: { name: string; pageId: string }) {
    try {
      await mutations.create.mutateAsync({
        name: input.name,
        kind: 'PAGE',
        pageId: input.pageId,
        variantCount: 1,
        goal: { type: 'FORM' },
      })
      setCreating(false)
      notify.success(
        'Teste criado. Edite a variante B no editor e publique para iniciar.',
      )
    } catch (error) {
      notify.error(error, 'Não foi possível criar o teste')
    }
  }

  async function apply() {
    if (!applying) return
    try {
      await mutations.applyWinner.mutateAsync({
        id: applying.experiment.id,
        variantKey: applying.key,
      })
      notify.success('Variante aplicada ao rascunho. Publique para valer.')
    } catch (error) {
      notify.error(error, 'Não foi possível aplicar a vencedora')
    } finally {
      setApplying(null)
    }
  }

  async function remove() {
    if (!removing) return
    try {
      await mutations.remove.mutateAsync(removing.id)
      notify.success('Teste excluído.')
    } catch (error) {
      notify.error(error, 'Não foi possível excluir o teste')
    } finally {
      setRemoving(null)
    }
  }

  const applyingName = applying
    ? (applying.experiment.variants.find((item) => item.key === applying.key)
        ?.name ?? applying.key)
    : ''

  return (
    <div className='mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <Link
            href={`/${slug}/crm/sites`}
            aria-label='Voltar para os sites'
            className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
          >
            <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
          </Link>
          <div className='min-w-0'>
            <h1 className='truncate font-semibold text-lg'>
              {site.data?.name ?? 'Testes A/B'}
            </h1>
            <p className='truncate text-muted-foreground text-xs'>
              Testes A/B do site
            </p>
          </div>
          {site.data ? <SiteStatusBadge status={site.data.status} /> : null}
        </div>
        {canEdit ? (
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              nativeButton={false}
              render={<Link href={editorBase} />}
            >
              <SteelIcon icon={PencilEdit02Icon} data-icon='inline-start' />
              Abrir editor
            </Button>
            <Button
              size='sm'
              onClick={() => setCreating(true)}
              data-testid='experiment-new'
            >
              <SteelIcon icon={Add01Icon} data-icon='inline-start' />
              Novo teste
            </Button>
          </div>
        ) : null}
      </div>

      {experiments.error ? (
        <EmptyState>
          Não foi possível carregar os testes. Tente novamente em instantes.
        </EmptyState>
      ) : !experiments.data ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center'>
          <span className='flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'>
            <SteelIcon icon={FlaskConicalIcon} className='size-5' />
          </span>
          <h2 className='font-medium'>Nenhum teste A/B ainda</h2>
          <p className='max-w-md text-muted-foreground text-sm'>
            Compare duas ou três versões de uma seção ou de uma página inteira e
            descubra qual converte mais. No editor, selecione uma seção e use a
            aba Testes A/B; para a página inteira, crie o teste aqui.
          </p>
        </div>
      ) : (
        <div className='grid min-w-0 gap-4'>
          {list.map((experiment) => (
            <ExperimentCard
              key={experiment.id}
              experiment={experiment}
              pages={pages.data ?? []}
              formNames={formNames}
              timezone={timezone}
              canEdit={canEdit}
              editorHref={`${editorBase}?page=${experiment.variants.find((item) => item.key !== 'A')?.pageId ?? experiment.pageId}`}
              onAction={(action) => void act(experiment, action)}
              onSettings={() => setSettingsId(experiment.id)}
              onApply={(key) => setApplying({ experiment, key })}
              onRemove={() => setRemoving(experiment)}
            />
          ))}
          <p className='text-muted-foreground text-xs'>
            Cada visitante vê sempre a mesma variante, escolhida no servidor
            (sem piscar a página). Sem consentimento de cookies, a escolha vale
            só no dia; quem aceita os cookies guarda a variante por 90 dias.
            Nenhum dado pessoal é usado.
          </p>
        </div>
      )}

      <NewPageTestDialog
        open={creating}
        onOpenChange={setCreating}
        pages={pages.data ?? []}
        busy={mutations.create.isPending}
        onCreate={(input) => void create(input)}
        editorHref={editorBase}
      />

      {settingsFor ? (
        <ExperimentSettingsDialog
          open={settingsFor !== null}
          onOpenChange={(open) => !open && setSettingsId(null)}
          workspaceId={workspaceId}
          siteId={siteId}
          timezone={timezone}
          experiment={settingsFor}
          pages={pages.data ?? []}
          onSave={(dto) =>
            mutations.update.mutateAsync({ id: settingsFor.id, dto })
          }
        />
      ) : null}

      <AlertDialog
        open={applying !== null}
        onOpenChange={(open) => !open && setApplying(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar “{applyingName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {applying?.experiment.kind === 'PAGE'
                ? 'O conteúdo desta versão vai para a página testada, as cópias são removidas e o teste termina.'
                : 'Esta versão fica no lugar da seção original, as outras versões são removidas e o teste termina.'}{' '}
              A mudança vai para o rascunho: publique o site para que todos
              vejam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void apply()}
              data-testid='experiment-apply-confirm'
            >
              Aplicar e encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{removing?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.winnerKey
                ? 'O teste e seus resultados são apagados. O rascunho não muda.'
                : 'O teste e seus resultados são apagados, e as variantes saem do rascunho (o original fica).'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void remove()}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
