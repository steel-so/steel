'use client'

import {
  BookOpen01Icon,
  Globe02Icon,
  Link01Icon,
  PanelLeftIcon,
  SidebarRightIcon,
  SquareLock02Icon,
  SquareUnlock02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { Star } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useState } from 'react'
import type { WikiSyncStatus } from '@/components/editor/wiki-editor'
import { SteelIcon } from '@/components/icon/icon'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useArchiveWikiPage,
  useDuplicateWikiPage,
  useFavoriteWikiPage,
  useLockWikiPage,
  usePublishWikiPage,
  useUnlockWikiPage,
  useUnpublishWikiPage,
  wikiPublicPath,
} from '@/src/hooks/use-wiki-page'
import type { WikiPageDTO } from '@/types/wiki-page'
import { type WikiExportKind, WikiPageMoreMenu } from './wiki-page-more-menu'
import { WikiPresence, type WikiPresenceUser } from './wiki-presence'
import { WIKI_TONE } from './wiki-tone'

const STATUS_COPY: Record<WikiSyncStatus, { label: string; hint: string }> = {
  connecting: {
    label: 'Conectando…',
    hint: 'Abrindo a edição em tempo real',
  },
  synced: {
    label: 'Sincronizado',
    hint: 'Quem estiver nesta página vê suas alterações na hora',
  },
  offline: {
    label: 'Sem conexão',
    hint: 'As alterações voltam a sincronizar quando a conexão voltar',
  },
}

function IconAction({
  label,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={className}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export interface WikiPageTopBarProps {
  workspaceId: string
  workspaceSlug: string
  page: WikiPageDTO
  title: string
  ancestors: WikiPageDTO[]
  status: WikiSyncStatus
  presence: WikiPresenceUser[]
  userId: string
  readOnly: boolean
  fullWidth: boolean
  onFullWidthChange: (value: boolean) => void
  fixedToolbar: boolean
  onFixedToolbarChange: (value: boolean) => void
  /** Shown here only while the toolbar (which has its own) is hidden. */
  panelToggle?: { open: boolean; onToggle: () => void }
  onToggleNavigation: () => void
  getMarkdown: () => string | null
  onExport: (kind: WikiExportKind) => void
}

/**
 * The wiki page's top bar: breadcrumb on the left; presence, publish, lock,
 * copy link, favorite, the "⋯" menu and the sync status on the right.
 */
export function WikiPageTopBar({
  workspaceId,
  workspaceSlug,
  page,
  title,
  ancestors,
  status,
  presence,
  userId,
  readOnly,
  fullWidth,
  onFullWidthChange,
  fixedToolbar,
  onFixedToolbarChange,
  panelToggle,
  onToggleNavigation,
  getMarkdown,
  onExport,
}: WikiPageTopBarProps) {
  const router = useRouter()
  const publish = usePublishWikiPage(workspaceId, page.id)
  const unpublish = useUnpublishWikiPage(workspaceId, page.id)
  const lock = useLockWikiPage(workspaceId, page.id)
  const unlock = useUnlockWikiPage(workspaceId, page.id)
  const favorite = useFavoriteWikiPage(workspaceId, page.id)
  const duplicate = useDuplicateWikiPage(workspaceId, page.id)
  const archive = useArchiveWikiPage(workspaceId, page.id)

  const published = Boolean(page.publishedAt && page.publicToken)
  const locked = Boolean(page.lockedAt)
  const canManageLock = page.canManageLock ?? false
  const [isFavorite, setIsFavorite] = useState(page.isFavorite ?? false)
  const statusCopy = STATUS_COPY[status]

  useEffect(() => {
    setIsFavorite(page.isFavorite ?? false)
  }, [page.isFavorite])

  function togglePublish() {
    const mutation = published ? unpublish : publish
    mutation.mutate(undefined, {
      onSuccess: () =>
        notify.success(
          published ? 'Publicação cancelada' : 'Página publicada na web',
        ),
      onError: notify.error,
    })
  }

  function toggleLock() {
    const mutation = locked ? unlock : lock
    mutation.mutate(undefined, {
      onSuccess: () =>
        notify.success(locked ? 'Edição desbloqueada' : 'Edição bloqueada'),
      onError: notify.error,
    })
  }

  function toggleFavorite() {
    const next = !isFavorite
    setIsFavorite(next)
    favorite.mutate(next, {
      onError: (error) => {
        setIsFavorite(!next)
        notify.error(error)
      },
    })
  }

  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text)
      notify.success(done)
    } catch {
      notify.error('Não foi possível copiar')
    }
  }

  function copyLink() {
    void copyText(
      `${window.location.origin}/${workspaceSlug}/wiki/${page.id}`,
      'Link copiado',
    )
  }

  function copyMarkdown() {
    const markdown = getMarkdown()
    if (markdown === null) {
      notify.error('O editor ainda está carregando')
      return
    }
    void copyText(markdown, 'Markdown copiado')
  }

  function duplicatePage() {
    duplicate.mutate(undefined, {
      onSuccess: (copy) => {
        notify.success('Cópia criada')
        router.push(`/${workspaceSlug}/wiki/${copy.id}`)
      },
      onError: notify.error,
    })
  }

  function archivePage() {
    archive.mutate(undefined, {
      onSuccess: () => {
        notify.success('Página arquivada')
        router.push(`/${workspaceSlug}/wiki`)
      },
      onError: notify.error,
    })
  }

  const publishPending = publish.isPending || unpublish.isPending
  const lockPending = lock.isPending || unlock.isPending
  const lockLabel = locked ? 'Desbloquear edição' : 'Bloquear edição'

  return (
    <div className='flex h-11 shrink-0 items-center justify-between gap-2 border-b border-secondary px-2 md:px-4'>
      <div className='flex min-w-0 items-center gap-1'>
        <Button
          variant='ghost'
          size='icon-sm'
          className='max-md:hidden'
          aria-label='Mostrar ou ocultar as páginas'
          title='Mostrar ou ocultar as páginas ( [ )'
          onClick={onToggleNavigation}
        >
          <SteelIcon icon={PanelLeftIcon} strokeWidth={2} />
        </Button>
        <Breadcrumb className='min-w-0'>
          <BreadcrumbList className='flex-nowrap text-xs'>
            <BreadcrumbItem className='shrink-0 max-sm:hidden'>
              <Link
                href={`/${workspaceSlug}/wiki`}
                className='inline-flex items-center gap-1.5 font-semibold hover:text-foreground'
              >
                <SteelIcon icon={BookOpen01Icon} strokeWidth={2} />
                Wiki
              </Link>
            </BreadcrumbItem>
            {ancestors.map((ancestor) => (
              <Fragment key={ancestor.id}>
                <BreadcrumbSeparator className='max-sm:hidden' />
                <BreadcrumbItem className='min-w-0 max-md:hidden'>
                  <Link
                    href={`/${workspaceSlug}/wiki/${ancestor.id}`}
                    className='truncate hover:text-foreground'
                  >
                    {ancestor.title || 'Sem título'}
                  </Link>
                </BreadcrumbItem>
              </Fragment>
            ))}
            <BreadcrumbSeparator className='max-sm:hidden' />
            <BreadcrumbItem className='min-w-0'>
              <BreadcrumbPage className='truncate font-medium'>
                {page.icon && <span className='mr-1'>{page.icon}</span>}
                {title || 'Sem título'}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Tooltip>
          <TooltipTrigger
            render={
              <output
                aria-live='polite'
                data-status={status}
                className='ml-1 flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs'
              />
            }
          >
            <span
              aria-hidden
              className={cn(
                'size-2 rounded-full',
                status === 'synced' && WIKI_TONE.liveDot,
                status === 'connecting' && 'animate-pulse bg-muted-foreground',
                status === 'offline' && 'bg-destructive',
              )}
            />
            <span className='sr-only'>{statusCopy.label}</span>
          </TooltipTrigger>
          <TooltipContent>
            {statusCopy.label} — {statusCopy.hint}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className='flex shrink-0 items-center gap-1'>
        <div className='mr-1 max-sm:hidden'>
          <WikiPresence users={presence} selfId={userId} />
        </div>

        {readOnly && (
          <span className='inline-flex h-6 items-center gap-1 rounded-md bg-muted px-2 font-medium text-muted-foreground text-xs'>
            <SteelIcon icon={SquareLock02Icon} strokeWidth={2} size={12} />
            <span className='max-sm:sr-only'>Somente leitura</span>
          </span>
        )}

        {published && page.publicToken && (
          <a
            href={wikiPublicPath(page.publicToken)}
            target='_blank'
            rel='noreferrer'
            className={cn(buttonVariants({ size: 'sm' }), WIKI_TONE.live)}
          >
            <span aria-hidden className='size-1.5 rounded-full bg-current' />
            Ao vivo
          </a>
        )}

        <Button
          variant={published ? 'ghost' : 'outline'}
          size='sm'
          disabled={publishPending || readOnly}
          onClick={togglePublish}
          aria-label={published ? 'Cancelar publicação' : 'Publicar'}
        >
          <SteelIcon icon={Globe02Icon} strokeWidth={2} />
          <span className='max-sm:hidden'>
            {published ? 'Cancelar publicação' : 'Publicar'}
          </span>
        </Button>

        <div className='flex items-center max-sm:hidden'>
          <IconAction
            label={lockLabel}
            disabled={!canManageLock || lockPending}
            pressed={locked}
            onClick={toggleLock}
          >
            <SteelIcon
              icon={locked ? SquareLock02Icon : SquareUnlock02Icon}
              strokeWidth={2}
            />
          </IconAction>
          <IconAction label='Copiar link' onClick={copyLink}>
            <SteelIcon icon={Link01Icon} strokeWidth={2} />
          </IconAction>
          <IconAction
            label={
              isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'
            }
            pressed={isFavorite}
            onClick={toggleFavorite}
          >
            <Star
              className='size-4'
              fill={isFavorite ? 'currentColor' : 'none'}
              strokeWidth={1.75}
            />
          </IconAction>
        </div>

        {panelToggle && (
          <IconAction
            label={
              panelToggle.open
                ? 'Fechar painel lateral'
                : 'Abrir painel lateral'
            }
            pressed={panelToggle.open}
            onClick={panelToggle.onToggle}
          >
            <SteelIcon icon={SidebarRightIcon} strokeWidth={2} />
          </IconAction>
        )}

        <WikiPageMoreMenu
          fullWidth={fullWidth}
          onFullWidthChange={onFullWidthChange}
          fixedToolbar={fixedToolbar}
          onFixedToolbarChange={onFixedToolbarChange}
          onCopyMarkdown={copyMarkdown}
          onDuplicate={duplicatePage}
          onExport={onExport}
          onArchive={archivePage}
          canEdit={!readOnly}
          duplicating={duplicate.isPending}
          compact={{
            favorite: isFavorite,
            onToggleFavorite: toggleFavorite,
            onCopyLink: copyLink,
            locked,
            canManageLock,
            onToggleLock: toggleLock,
          }}
        />
      </div>
    </div>
  )
}
