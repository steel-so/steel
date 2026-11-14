'use client'

import {
  Add01Icon,
  Copy01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  PresentationBarChart01Icon,
  TvSmartIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCreateSdDashboard,
  useDeleteSdDashboard,
  useDuplicateSdDashboard,
  useRenameSdDashboard,
  useSdDashboards,
} from '@/src/hooks/use-sd-dashboards'
import type { CrmDashboardDTO } from '@/types/crm-dashboard'
import { sdFormatDateTime } from '../ticket/sd-ticket-meta'

const NEW_TITLE = 'Novo painel'

type DialogState =
  | { kind: 'create' }
  | { kind: 'rename'; dashboard: CrmDashboardDTO }
  | { kind: 'delete'; dashboard: CrmDashboardDTO }
  | null

/** `/<slug>/servicedesk/dashboards/<id>` (+ `/tv`). */
export function sdDashboardHref(
  slug: string,
  dashboardId: string,
  mode?: 'tv',
): string {
  const base = `/${slug}/servicedesk/dashboards/${dashboardId}`
  return mode === 'tv' ? `${base}/tv` : base
}

function DashboardCard({
  slug,
  dashboard,
  canEdit,
  canCreate,
  canDelete,
  onRename,
  onDuplicate,
  onDelete,
}: {
  slug: string
  dashboard: CrmDashboardDTO
  canEdit: boolean
  canCreate: boolean
  canDelete: boolean
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const hasActions = canEdit || canCreate || canDelete
  return (
    <div className='group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40'>
      <div className='flex items-start gap-3'>
        <span className='grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary'>
          <SteelIcon
            icon={PresentationBarChart01Icon}
            strokeWidth={1.8}
            className='size-5'
          />
        </span>
        <div className='min-w-0 flex-1'>
          <Link
            href={sdDashboardHref(slug, dashboard.id)}
            className='line-clamp-2 font-medium text-sm after:absolute after:inset-0 after:content-[""] hover:underline'
          >
            {dashboard.title || 'Painel sem título'}
          </Link>
          <p className='mt-0.5 text-muted-foreground text-xs'>
            Atualizado em {sdFormatDateTime(dashboard.updatedAt)}
          </p>
        </div>
        {hasActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Ações de ${dashboard.title || 'Painel sem título'}`}
                  className='relative z-10 shrink-0'
                >
                  <SteelIcon icon={MoreVerticalIcon} strokeWidth={2} />
                </Button>
              }
            />
            <DropdownMenuContent align='end'>
              {canEdit ? (
                <DropdownMenuItem onClick={onRename}>
                  <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  Renomear
                </DropdownMenuItem>
              ) : null}
              {canCreate ? (
                <DropdownMenuItem onClick={onDuplicate}>
                  <SteelIcon icon={Copy01Icon} strokeWidth={2} />
                  Duplicar
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onDelete}
                    className='text-destructive'
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                    Excluir
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <Link
        href={sdDashboardHref(slug, dashboard.id, 'tv')}
        className={buttonVariants({
          variant: 'outline',
          size: 'xs',
          className: 'relative z-10 self-start',
        })}
      >
        <SteelIcon icon={TvSmartIcon} strokeWidth={2} />
        Modo TV
      </Link>
    </div>
  )
}

/**
 * Lista de painéis do ServiceDesk: criar, abrir, duplicar, renomear e
 * excluir. Os dois painéis padrão ("Dashboard analítico" e "KPIs (TV)") são
 * semeados na liberação do módulo e aparecem aqui como quaisquer outros.
 */
export function SdDashboardsList({
  workspaceId,
  slug,
  canCreate,
  canEdit,
  canDelete,
}: {
  workspaceId: string
  slug: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const query = useSdDashboards(workspaceId)
  const create = useCreateSdDashboard(workspaceId)
  const rename = useRenameSdDashboard(workspaceId)
  const duplicate = useDuplicateSdDashboard(workspaceId)
  const remove = useDeleteSdDashboard(workspaceId)

  const [dialog, setDialog] = useState<DialogState>(null)
  const [title, setTitle] = useState('')

  const dashboards = query.data ?? []
  const busy =
    create.isPending ||
    rename.isPending ||
    duplicate.isPending ||
    remove.isPending

  function openCreate() {
    setTitle(NEW_TITLE)
    setDialog({ kind: 'create' })
  }

  function openRename(dashboard: CrmDashboardDTO) {
    setTitle(dashboard.title)
    setDialog({ kind: 'rename', dashboard })
  }

  async function submitDialog() {
    const next = title.trim()
    if (!dialog || dialog.kind === 'delete' || !next) return
    try {
      if (dialog.kind === 'create') {
        const dashboard = await create.mutateAsync(next)
        setDialog(null)
        notify.success('Painel criado.')
        router.push(sdDashboardHref(slug, dashboard.id))
        return
      }
      await rename.mutateAsync({ id: dialog.dashboard.id, title: next })
      setDialog(null)
      notify.success('Painel renomeado.')
    } catch (error) {
      notify.error(error)
    }
  }

  async function confirmDelete() {
    if (dialog?.kind !== 'delete') return
    try {
      await remove.mutateAsync(dialog.dashboard.id)
      setDialog(null)
      notify.success('Painel excluído.')
    } catch (error) {
      notify.error(error)
    }
  }

  async function runDuplicate(dashboard: CrmDashboardDTO) {
    try {
      const copy = await duplicate.mutateAsync(dashboard.id)
      notify.success('Painel duplicado.')
      router.push(sdDashboardHref(slug, copy.id))
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div data-tour='sd-dashboards-title'>
          <h1 className='font-semibold text-lg'>Painéis</h1>
          <p className='text-muted-foreground text-sm'>
            Indicadores do ServiceDesk: SLA, backlog, MTTR, CSAT e custos. Abra
            um painel no modo TV para exibir no telão da operação.
          </p>
        </div>
        {canCreate ? (
          <Button size='sm' data-tour='sd-dashboards-new' onClick={openCreate}>
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Novo painel
          </Button>
        ) : null}
      </div>

      {query.error ? (
        <p className='rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm'>
          {query.error.message}
        </p>
      ) : null}

      {query.isLoading ? (
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          <Skeleton className='h-28 rounded-xl' />
          <Skeleton className='h-28 rounded-xl' />
          <Skeleton className='h-28 rounded-xl' />
        </div>
      ) : dashboards.length === 0 ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border border-dashed bg-card p-10 text-center'>
          <span className='flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground'>
            <SteelIcon
              icon={DashboardSquare01Icon}
              strokeWidth={1.8}
              className='size-6'
            />
          </span>
          <p className='font-medium text-sm'>Nenhum painel por aqui ainda</p>
          <p className='max-w-md text-muted-foreground text-xs'>
            Crie um painel e monte os widgets com as fontes do ServiceDesk
            (chamados, custos, eventos e artigos da base de conhecimento).
          </p>
          {canCreate ? (
            <Button size='sm' variant='outline' onClick={openCreate}>
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Criar o primeiro painel
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          data-tour='sd-dashboards-grid'
          className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
        >
          {dashboards.map((dashboard) => (
            <DashboardCard
              key={dashboard.id}
              slug={slug}
              dashboard={dashboard}
              canEdit={canEdit}
              canCreate={canCreate}
              canDelete={canDelete}
              onRename={() => openRename(dashboard)}
              onDuplicate={() => void runDuplicate(dashboard)}
              onDelete={() => setDialog({ kind: 'delete', dashboard })}
            />
          ))}
        </div>
      )}

      <Dialog
        open={dialog !== null && dialog.kind !== 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === 'rename' ? 'Renomear painel' : 'Novo painel'}
            </DialogTitle>
            <DialogDescription>
              Dê um nome que a equipe reconheça no telão (ex.: "SLA do turno da
              manhã").
            </DialogDescription>
          </DialogHeader>
          <form
            className='flex flex-col gap-2'
            onSubmit={(event) => {
              event.preventDefault()
              void submitDialog()
            }}
          >
            <Label htmlFor='sd-dashboard-title' className='text-xs'>
              Nome do painel
            </Label>
            <Input
              id='sd-dashboard-title'
              autoFocus
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={NEW_TITLE}
            />
            <DialogFooter className='mt-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setDialog(null)}
              >
                Cancelar
              </Button>
              <Button type='submit' disabled={busy || !title.trim()}>
                {dialog?.kind === 'rename' ? 'Salvar' : 'Criar painel'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Excluir painel</DialogTitle>
            <DialogDescription>
              {dialog?.kind === 'delete'
                ? `"${dialog.dashboard.title || 'Painel sem título'}" e todos os seus widgets serão removidos. Esta ação não pode ser desfeita.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button
              variant='destructive'
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              Excluir painel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
