'use client'

import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  Globe02Icon,
  Link01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useState } from 'react'
import { SiteStatusBadge } from '@/app/_components/crm/sites/site-status-badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  bioLinkKeys,
  bioLinksApi,
  useBioLinks,
} from '@/src/hooks/use-bio-links'
import type { BioLinkSummaryDTO } from '@/types/bio-link'

const nf = new Intl.NumberFormat('pt-BR')

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className='min-w-0'>
      <p className='font-semibold text-base tabular-nums'>{nf.format(value)}</p>
      <p className='truncate text-muted-foreground text-xs'>{label}</p>
    </div>
  )
}

function BioCard({
  page,
  slug,
  onDelete,
}: {
  page: BioLinkSummaryDTO
  slug: string
  onDelete: (page: BioLinkSummaryDTO) => void
}) {
  const canEdit = useCan('landing-pages', 'EDIT')
  const canDelete = useCan('landing-pages', 'DELETE')
  const href = `/${slug}/crm/bio-links/${page.id}`

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(page.url)
      notify.success('Endereço copiado.')
    } catch {
      notify.error('Não foi possível copiar o endereço.')
    }
  }

  return (
    <li
      data-testid={`bio-card-${page.id}`}
      className='group relative flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md'
    >
      <div className='flex min-w-0 items-start gap-3'>
        {page.avatarUrl ? (
          <img
            src={page.avatarUrl}
            alt=''
            className='size-12 shrink-0 rounded-full object-cover'
          />
        ) : (
          <span className='flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'>
            <SteelIcon icon={Link01Icon} className='size-5' />
          </span>
        )}
        <div className='min-w-0 flex-1'>
          <Link
            href={href}
            className='block truncate font-medium text-sm after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/50'
          >
            {page.name}
          </Link>
          <div className='mt-0.5 flex min-w-0 items-center gap-2'>
            <SiteStatusBadge status={page.status} />
            <span className='truncate text-muted-foreground text-xs'>
              /b/{page.slug}
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Ações de ${page.name}`}
            className='relative z-10 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
          >
            <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-52'>
            <DropdownMenuItem render={<Link href={href} />}>
              <SteelIcon icon={PencilEdit02Icon} />
              {canEdit ? 'Abrir editor' : 'Ver página'}
            </DropdownMenuItem>
            {page.status === 'PUBLISHED' ? (
              <DropdownMenuItem
                render={
                  <a
                    href={page.url}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                }
              >
                <SteelIcon icon={Globe02Icon} />
                Abrir página no ar
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => void copyUrl()}>
              <SteelIcon icon={Copy01Icon} />
              Copiar endereço
            </DropdownMenuItem>
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => onDelete(page)}
                >
                  <SteelIcon icon={Delete02Icon} />
                  Excluir
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className='grid grid-cols-3 gap-3 border-t pt-3'
        data-testid={`bio-totals-${page.id}`}
      >
        <Stat label='Links' value={page.linkCount} />
        <Stat label='Visitas' value={page.views} />
        <Stat label='Cliques' value={page.clicks} />
      </div>
    </li>
  )
}

function NewBioDialog({
  open,
  onOpenChange,
  workspaceId,
  slug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const nameId = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const created = await bioLinksApi(workspaceId).create({
        name: name.trim(),
      })
      void queryClient.invalidateQueries({
        queryKey: bioLinkKeys.list(workspaceId),
      })
      notify.success('Página criada.')
      router.push(`/${slug}/crm/bio-links/${created.id}`)
    } catch (error) {
      notify.error(error, 'Não foi possível criar a página')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setName('')
          setBusy(false)
        }
      }}
    >
      <DialogContent className='sm:max-w-md' data-testid='new-bio-dialog'>
        <form onSubmit={create} className='grid gap-4'>
          <DialogHeader>
            <DialogTitle>Nova página de link da bio</DialogTitle>
            <DialogDescription>
              Dê um nome para identificar a página. O endereço é criado a partir
              dele e pode ser trocado depois.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-1.5'>
            <Label htmlFor={nameId}>Nome</Label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              maxLength={80}
              placeholder='Ex.: Instagram da loja'
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={busy || !name.trim()}>
              {busy ? 'Criando…' : 'Criar e abrir o editor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * CRM › Atrair › Link da bio: the workspace's bio pages as cards (status,
 * address, links, visits and clicks) with create, copy and delete.
 */
export function BioLinksList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const pages = useBioLinks(workspaceId)
  const queryClient = useQueryClient()
  const canCreate = useCan('landing-pages', 'CREATE')
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<BioLinkSummaryDTO | null>(null)

  async function confirmRemove() {
    if (!removing) return
    const page = removing
    setRemoving(null)
    try {
      await bioLinksApi(workspaceId).remove(page.id)
      await queryClient.invalidateQueries({
        queryKey: bioLinkKeys.list(workspaceId),
      })
      notify.success(`“${page.name}” excluída.`)
    } catch (error) {
      notify.error(error, 'Não foi possível excluir a página')
    }
  }

  const list = pages.data ?? []
  return (
    <div className='mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 sm:px-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='min-w-0'>
          <h1 className='font-semibold text-xl'>Link da bio</h1>
          <p className='text-muted-foreground text-sm'>
            Monte uma página com todos os seus links para o Instagram, o TikTok
            e outras redes, e acompanhe quem clica em cada um.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)} data-testid='new-bio-link'>
            <SteelIcon icon={Add01Icon} data-icon='inline-start' />
            Nova página
          </Button>
        ) : null}
      </div>

      {pages.isLoading ? (
        <ul
          className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
          aria-busy='true'
        >
          {[0, 1, 2].map((key) => (
            <li key={key} className='grid gap-4 rounded-xl border p-4'>
              <div className='flex items-center gap-3'>
                <Skeleton className='size-12 rounded-full' />
                <div className='grid flex-1 gap-2'>
                  <Skeleton className='h-4 w-2/3' />
                  <Skeleton className='h-3 w-1/2' />
                </div>
              </div>
              <Skeleton className='h-10 w-full' />
            </li>
          ))}
        </ul>
      ) : pages.error ? (
        <div className='rounded-xl border p-8 text-center'>
          <p className='text-muted-foreground text-sm'>
            Não foi possível carregar as páginas.
          </p>
          <Button
            className='mt-3'
            size='sm'
            variant='outline'
            onClick={() => void pages.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : list.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center'>
          <span className='flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'>
            <SteelIcon icon={Link01Icon} className='size-6' />
          </span>
          <h2 className='font-medium text-base'>
            Crie sua primeira página de link da bio
          </h2>
          <p className='max-w-md text-muted-foreground text-sm'>
            Reúna WhatsApp, site, redes sociais, formulários e vídeos em um
            único endereço para colocar na bio do Instagram ou do TikTok.
          </p>
          {canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <SteelIcon icon={Add01Icon} data-icon='inline-start' />
              Nova página
            </Button>
          ) : null}
        </div>
      ) : (
        <ul
          aria-label='Páginas de link da bio'
          className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
        >
          {list.map((page) => (
            <BioCard
              key={page.id}
              page={page}
              slug={slug}
              onDelete={setRemoving}
            />
          ))}
        </ul>
      )}

      <NewBioDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        slug={slug}
      />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{removing?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.status === 'PUBLISHED'
                ? 'A página sai do ar na hora e o endereço fica livre. '
                : ''}
              As estatísticas de visitas e cliques também são excluídas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void confirmRemove()}
            >
              Excluir página
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
