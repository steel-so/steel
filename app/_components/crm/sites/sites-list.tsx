'use client'

import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  Globe02Icon,
  Link01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  ViewIcon,
  WebDesign01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SiteSnapshot,
  useNearViewport,
} from '@/app/_components/canvas-site/site-snapshot'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  crmSitesApi,
  crmSitesKeys,
  useCrmSites,
  useLegacyLandingPageCount,
} from '@/src/hooks/use-crm-sites'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { parseSiteTheme } from '@/src/lib/canvas-site/theme'
import type { SiteSummaryDTO } from '@/types/site'
import { formatSiteRelative } from './format'
import { NewSiteDialog } from './new-site-dialog'
import { toPageLinks } from './site-editor-context'
import { SiteStatusBadge } from './site-status-badge'

const MIGRATED_KEY = (workspaceId: string) =>
  `steel.sites.landing-migrated.${workspaceId}`

/** Home page (with header/footer) of a site, drawn small. Loads only once
 * the card nears the viewport; shares the editor's query cache. */
function SiteThumbnail({
  workspaceId,
  site,
}: {
  workspaceId: string
  site: SiteSummaryDTO
}) {
  const box = useRef<HTMLDivElement>(null)
  const near = useNearViewport(box)
  const api = crmSitesApi(workspaceId)
  const data = useQuery({
    queryKey: [
      ...crmSitesKeys.site(workspaceId, site.id),
      'thumbnail',
      site.updatedAt,
    ],
    enabled: near,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const [full, pages, globals] = await Promise.all([
        api.get(site.id),
        api.pages(site.id),
        api.globals(site.id),
      ])
      const home =
        pages.find((page) => page.id === full.homePageId) ??
        pages.find((page) => page.isHome) ??
        pages[0]
      const page = home ? await api.page(site.id, home.id) : null
      const header = globals.find((global) => global.kind === 'HEADER')
      const footer = globals.find((global) => global.kind === 'FOOTER')
      return {
        theme: parseSiteTheme(full.theme),
        links: toPageLinks(pages),
        docs: [header?.document, page?.document, footer?.document].filter(
          (doc): doc is CanvasDocument => doc !== undefined,
        ),
      }
    },
  })
  const context = useMemo(
    () => ({ pages: data.data?.links ?? [] }),
    [data.data],
  )
  return (
    <div
      ref={box}
      className='aspect-[16/10] overflow-hidden border-b bg-muted/40'
    >
      {data.data ? (
        <SiteSnapshot
          docs={data.data.docs}
          theme={data.data.theme}
          context={context}
          className='size-full bg-background'
        />
      ) : data.error ? (
        <div className='flex size-full items-center justify-center text-muted-foreground/60'>
          <SteelIcon icon={WebDesign01Icon} className='size-8' />
        </div>
      ) : (
        <Skeleton className='size-full rounded-none' />
      )}
    </div>
  )
}

function SiteCard({
  workspaceId,
  slug,
  site,
  onDuplicate,
  onDelete,
}: {
  workspaceId: string
  slug: string
  site: SiteSummaryDTO
  onDuplicate: (site: SiteSummaryDTO) => void
  onDelete: (site: SiteSummaryDTO) => void
}) {
  const canEdit = useCan('landing-pages', 'EDIT')
  const canCreate = useCan('landing-pages', 'CREATE')
  const canDelete = useCan('landing-pages', 'DELETE')
  const editorHref = `/${slug}/crm/sites/${site.id}`
  const previewHref = `${editorHref}/preview`
  const [now] = useState(() => Date.now())

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(site.url)
      notify.success('Endereço copiado.')
    } catch {
      notify.error('Não foi possível copiar o endereço.')
    }
  }

  return (
    <li
      data-testid={`site-card-${site.id}`}
      className='group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md'
    >
      <Link
        href={canEdit ? editorHref : previewHref}
        className='block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        aria-label={`${canEdit ? 'Abrir o editor de' : 'Ver'} ${site.name}`}
      >
        <SiteThumbnail workspaceId={workspaceId} site={site} />
      </Link>
      <div className='grid gap-2 p-3'>
        <div className='flex min-w-0 items-start justify-between gap-2'>
          <div className='min-w-0'>
            <h3 className='truncate font-medium text-sm'>{site.name}</h3>
            <p className='truncate text-muted-foreground text-xs'>
              {site.pageCount === 1 ? '1 página' : `${site.pageCount} páginas`}
              {' · '}Editado {formatSiteRelative(site.updatedAt, now)}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Ações de ${site.name}`}
              className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
            >
              <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-52'>
              {canEdit ? (
                <DropdownMenuItem render={<Link href={editorHref} />}>
                  <SteelIcon icon={PencilEdit02Icon} />
                  Abrir editor
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem render={<Link href={previewHref} />}>
                <SteelIcon icon={ViewIcon} />
                Visualizar rascunho
              </DropdownMenuItem>
              {site.status === 'PUBLISHED' ? (
                <DropdownMenuItem
                  render={
                    <a
                      href={site.url}
                      target='_blank'
                      rel='noopener noreferrer'
                    />
                  }
                >
                  <SteelIcon icon={Globe02Icon} />
                  Abrir site no ar
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => void copyUrl()}>
                <SteelIcon icon={Link01Icon} />
                Copiar endereço
              </DropdownMenuItem>
              {canCreate ? (
                <DropdownMenuItem onClick={() => onDuplicate(site)}>
                  <SteelIcon icon={Copy01Icon} />
                  Duplicar
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant='destructive'
                    onClick={() => onDelete(site)}
                  >
                    <SteelIcon icon={Delete02Icon} />
                    Excluir
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className='flex min-w-0 items-center gap-2'>
          <SiteStatusBadge status={site.status} />
          <a
            href={site.status === 'PUBLISHED' ? site.url : previewHref}
            target={site.status === 'PUBLISHED' ? '_blank' : undefined}
            rel='noopener noreferrer'
            className='min-w-0 truncate text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline'
            title={site.url}
          >
            {site.url.replace(/^https?:\/\//, '')}
          </a>
        </div>
      </div>
    </li>
  )
}

function MigrationBanner({ workspaceId }: { workspaceId: string }) {
  const count = useLegacyLandingPageCount(workspaceId)
  const queryClient = useQueryClient()
  const [hidden, setHidden] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(MIGRATED_KEY(workspaceId)) === '1')
    } catch {
      setHidden(false)
    }
  }, [workspaceId])

  if (hidden || !count.data) return null

  const done = () => {
    try {
      window.localStorage.setItem(MIGRATED_KEY(workspaceId), '1')
    } catch {
      // Storage blocked: the banner just shows again next time.
    }
    setHidden(true)
  }

  async function migrate() {
    setBusy(true)
    try {
      const report = await crmSitesApi(workspaceId).migrateLandingPages()
      await queryClient.invalidateQueries({
        queryKey: crmSitesKeys.list(workspaceId),
      })
      if (report.failed > 0) {
        notify.warning(
          `${report.created} landing pages viraram sites; ${report.failed} não puderam ser convertidas.`,
        )
      } else {
        notify.success(
          report.created > 0
            ? `${report.created} landing pages agora são sites.`
            : 'Suas landing pages já estavam em Sites.',
        )
        done()
      }
    } catch (error) {
      notify.error(error, 'Não foi possível trazer as landing pages')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role='status'
      className='flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center'
    >
      <div className='min-w-0 flex-1'>
        <p className='font-medium text-sm'>Landing pages agora são Sites</p>
        <p className='text-muted-foreground text-xs'>
          {count.data === 1
            ? 'Você tem 1 landing page do editor antigo.'
            : `Você tem ${count.data} landing pages do editor antigo.`}{' '}
          Traga-as para cá para editar no novo editor; os links antigos
          continuam funcionando.
        </p>
      </div>
      <div className='flex shrink-0 gap-2'>
        <Button size='sm' variant='ghost' onClick={done}>
          Agora não
        </Button>
        <Button size='sm' onClick={() => void migrate()} disabled={busy}>
          {busy ? 'Trazendo…' : 'Trazer para Sites'}
        </Button>
      </div>
    </div>
  )
}

/**
 * CRM › Sites: the workspace's sites as cards (live thumbnail, status,
 * address, last edit) with the "Novo site" gallery, duplicate and delete.
 */
export function SitesList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const sites = useCrmSites(workspaceId)
  const queryClient = useQueryClient()
  const router = useRouter()
  const canCreate = useCan('landing-pages', 'CREATE')
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<SiteSummaryDTO | null>(null)
  const api = crmSitesApi(workspaceId)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: crmSitesKeys.list(workspaceId) })

  async function duplicate(site: SiteSummaryDTO) {
    try {
      const copy = await api.duplicate(site.id)
      await refresh()
      notify.success(`“${copy.name}” criado.`)
      router.push(`/${slug}/crm/sites/${copy.id}`)
    } catch (error) {
      notify.error(error, 'Não foi possível duplicar o site')
    }
  }

  async function confirmRemove() {
    if (!removing) return
    const site = removing
    setRemoving(null)
    try {
      await api.remove(site.id)
      await refresh()
      notify.success(`“${site.name}” excluído.`)
    } catch (error) {
      notify.error(error, 'Não foi possível excluir o site')
    }
  }

  const list = sites.data ?? []
  return (
    <div className='mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 sm:px-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='min-w-0'>
          <h1 className='font-semibold text-xl'>Sites</h1>
          <p className='text-muted-foreground text-sm'>
            Crie páginas e sites completos com editor visual, publique em um
            clique e receba leads no CRM.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)} data-testid='new-site'>
            <SteelIcon icon={Add01Icon} data-icon='inline-start' />
            Novo site
          </Button>
        ) : null}
      </div>

      <MigrationBanner workspaceId={workspaceId} />

      {sites.isLoading ? (
        <ul
          className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
          aria-busy='true'
        >
          {[0, 1, 2].map((key) => (
            <li key={key} className='overflow-hidden rounded-xl border'>
              <Skeleton className='aspect-[16/10] rounded-none' />
              <div className='grid gap-2 p-3'>
                <Skeleton className='h-4 w-2/3' />
                <Skeleton className='h-3 w-1/2' />
              </div>
            </li>
          ))}
        </ul>
      ) : sites.error ? (
        <div className='rounded-xl border p-8 text-center'>
          <p className='text-muted-foreground text-sm'>
            Não foi possível carregar os sites.
          </p>
          <Button
            className='mt-3'
            size='sm'
            variant='outline'
            onClick={() => void sites.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : list.length === 0 ? (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center'>
          <span className='flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'>
            <SteelIcon icon={WebDesign01Icon} className='size-6' />
          </span>
          <h2 className='font-medium text-base'>Crie seu primeiro site</h2>
          <p className='max-w-md text-muted-foreground text-sm'>
            Comece por um modelo pronto — agência, empresa ou produto digital —
            e ajuste cores, textos e seções arrastando.
          </p>
          {canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <SteelIcon icon={Add01Icon} data-icon='inline-start' />
              Novo site
            </Button>
          ) : null}
        </div>
      ) : (
        <ul
          aria-label='Sites'
          className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
        >
          {list.map((site) => (
            <SiteCard
              key={site.id}
              workspaceId={workspaceId}
              slug={slug}
              site={site}
              onDuplicate={(item) => void duplicate(item)}
              onDelete={setRemoving}
            />
          ))}
        </ul>
      )}

      <NewSiteDialog
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
                ? 'O site sai do ar na hora e o endereço fica livre. '
                : ''}
              Páginas, cabeçalho, rodapé e versões são excluídos junto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void confirmRemove()}
            >
              Excluir site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
