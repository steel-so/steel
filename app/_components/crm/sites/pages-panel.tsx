'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  FileAddIcon,
  Home01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Settings02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { crmSitesKeys } from '@/src/hooks/use-crm-sites'
import type { SitePageSummaryDTO } from '@/types/site'
import { PageSettingsDialog } from './page-settings-dialog'
import {
  orderPages,
  pagePublicPath,
  useSiteEditor,
} from './site-editor-context'
import { useOpenTarget } from './use-open-target'

type Row = SitePageSummaryDTO & { depth: number }

/** New sibling order after moving `id` by `delta` (or `null` at an edge). */
export function moveAmongSiblings(
  pages: SitePageSummaryDTO[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const page = pages.find((item) => item.id === id)
  if (!page) return null
  const siblings = pages
    .filter((item) => item.parentId === page.parentId)
    .sort((a, b) => a.position - b.position)
  const from = siblings.findIndex((item) => item.id === id)
  const to = from + delta
  if (to < 0 || to >= siblings.length) return null
  return arrayMove(siblings, from, to).map((item) => item.id)
}

function NewPageForm({
  parent,
  onDone,
}: {
  parent: SitePageSummaryDTO | null
  onDone: () => void
}) {
  const { site, api, workspaceId } = useSiteEditor()
  const openTarget = useOpenTarget()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      const page = await api.createPage(site.id, {
        title: title.trim(),
        parentId: parent?.id ?? null,
      })
      await queryClient.invalidateQueries({
        queryKey: crmSitesKeys.pages(workspaceId, site.id),
      })
      queryClient.setQueryData(
        crmSitesKeys.page(workspaceId, site.id, page.id),
        page,
      )
      onDone()
      await openTarget({ kind: 'page', id: page.id })
    } catch (error) {
      notify.error(error, 'Não foi possível criar a página')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className='grid gap-2 rounded-lg border bg-muted/30 p-2'
    >
      <Input
        autoFocus
        aria-label='Título da nova página'
        placeholder={parent ? `Subpágina de ${parent.title}` : 'Ex.: Contato'}
        value={title}
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onDone()}
        className='h-8'
      />
      <div className='flex justify-end gap-1'>
        <Button type='button' size='xs' variant='ghost' onClick={onDone}>
          Cancelar
        </Button>
        <Button type='submit' size='xs' disabled={busy || !title.trim()}>
          Criar página
        </Button>
      </div>
    </form>
  )
}

function PageRow({
  page,
  active,
  onAction,
}: {
  page: Row
  active: boolean
  onAction: (action: PageAction, page: Row) => void
}) {
  const { canEdit, canDelete } = useSiteEditor()
  const openTarget = useOpenTarget()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(page.title)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id, disabled: !canEdit })

  const commitRename = () => {
    setRenaming(false)
    const next = title.trim()
    if (next && next !== page.title)
      onAction({ kind: 'rename', title: next }, page)
    else setTitle(page.title)
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        paddingLeft: page.depth * 14,
      }}
      data-testid={`site-page-${page.id}`}
      className={cn('relative', isDragging && 'z-10 opacity-70')}
    >
      <div
        className={cn(
          'group flex h-9 items-center gap-1 rounded-md pr-1 text-sm transition-colors hover:bg-muted',
          active && 'bg-primary/10 text-primary hover:bg-primary/10',
        )}
      >
        <button
          type='button'
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Arrastar ${page.title}`}
          className='flex h-full w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing'
        >
          <SteelIcon icon={DragDropVerticalIcon} className='size-3.5' />
        </button>
        {renaming ? (
          <Input
            autoFocus
            aria-label='Novo título'
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') {
                setTitle(page.title)
                setRenaming(false)
              }
            }}
            className='h-7 min-w-0 flex-1 text-sm'
          />
        ) : (
          <button
            type='button'
            onClick={() => void openTarget({ kind: 'page', id: page.id })}
            onDoubleClick={() => canEdit && setRenaming(true)}
            aria-current={active ? 'page' : undefined}
            title={pagePublicPath(page)}
            className='flex h-full min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm'
          >
            {page.isHome ? (
              <SteelIcon
                icon={Home01Icon}
                className='size-3.5 shrink-0'
                aria-label='Página inicial'
              />
            ) : null}
            <span className='truncate'>{page.title}</span>
            {page.seo.noindex ? (
              <span className='shrink-0 text-[10px] text-muted-foreground'>
                oculta
              </span>
            ) : null}
          </button>
        )}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Ações de ${page.title}`}
              className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 data-[popup-open]:opacity-100'
            >
              <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-52'>
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <SteelIcon icon={PencilEdit02Icon} />
                Renomear
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAction({ kind: 'settings' }, page)}
              >
                <SteelIcon icon={Settings02Icon} />
                Configurações e SEO
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAction({ kind: 'subpage' }, page)}
              >
                <SteelIcon icon={FileAddIcon} />
                Adicionar subpágina
              </DropdownMenuItem>
              {page.isHome ? null : (
                <DropdownMenuItem
                  onClick={() => onAction({ kind: 'home' }, page)}
                >
                  <SteelIcon icon={Home01Icon} />
                  Definir como inicial
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onAction({ kind: 'duplicate' }, page)}
                disabled={page.isHome}
              >
                <SteelIcon icon={Copy01Icon} />
                Duplicar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onAction({ kind: 'move', delta: -1 }, page)}
              >
                <SteelIcon icon={ArrowUp01Icon} />
                Mover para cima
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAction({ kind: 'move', delta: 1 }, page)}
              >
                <SteelIcon icon={ArrowDown01Icon} />
                Mover para baixo
              </DropdownMenuItem>
              {page.isHome || !canDelete ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant='destructive'
                    onClick={() => onAction({ kind: 'delete' }, page)}
                  >
                    <SteelIcon icon={Delete02Icon} />
                    Excluir
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  )
}

type PageAction =
  | { kind: 'rename'; title: string }
  | { kind: 'settings' }
  | { kind: 'subpage' }
  | { kind: 'home' }
  | { kind: 'duplicate' }
  | { kind: 'move'; delta: -1 | 1 }
  | { kind: 'delete' }

/**
 * "Páginas": the site's page tree. Click opens a page, double click
 * renames, drag (or the menu) reorders among siblings; the menu also sets
 * the home page, duplicates, adds subpages, deletes and opens the page's
 * settings and SEO.
 */
export function PagesPanel() {
  const { site, pages, target, api, workspaceId, canEdit, setSite } =
    useSiteEditor()
  const openTarget = useOpenTarget()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState<{
    parent: SitePageSummaryDTO | null
  } | null>(null)
  const [settings, setSettings] = useState<SitePageSummaryDTO | null>(null)
  const [removing, setRemoving] = useState<SitePageSummaryDTO | null>(null)
  const rows = orderPages(pages)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: crmSitesKeys.pages(workspaceId, site.id),
    })

  async function reorder(orderedIds: string[]) {
    // Optimistic: positions follow the new sibling order.
    const position = new Map(orderedIds.map((id, index) => [id, index]))
    queryClient.setQueryData(
      crmSitesKeys.pages(workspaceId, site.id),
      pages.map((page) =>
        position.has(page.id)
          ? { ...page, position: position.get(page.id) as number }
          : page,
      ),
    )
    try {
      await api.reorderPages(site.id, orderedIds)
    } catch (error) {
      notify.error(error, 'Não foi possível reordenar as páginas')
    }
    await refresh()
  }

  async function onAction(action: PageAction, page: SitePageSummaryDTO) {
    try {
      switch (action.kind) {
        case 'rename':
          await api.updatePage(site.id, page.id, { title: action.title })
          await refresh()
          return
        case 'settings':
          setSettings(page)
          return
        case 'subpage':
          setAdding({ parent: page })
          return
        case 'home': {
          const saved = await api.update(site.id, { homePageId: page.id })
          setSite(saved)
          await refresh()
          notify.success(`“${page.title}” agora é a página inicial.`)
          return
        }
        case 'duplicate': {
          const copy = await api.duplicatePage(site.id, page.id)
          await refresh()
          queryClient.setQueryData(
            crmSitesKeys.page(workspaceId, site.id, copy.id),
            copy,
          )
          await openTarget({ kind: 'page', id: copy.id })
          return
        }
        case 'move': {
          const order = moveAmongSiblings(pages, page.id, action.delta)
          if (order) await reorder(order)
          return
        }
        case 'delete':
          setRemoving(page)
          return
      }
    } catch (error) {
      notify.error(error, 'Não foi possível concluir a ação')
    }
  }

  async function confirmRemove() {
    if (!removing) return
    const page = removing
    setRemoving(null)
    try {
      await api.removePage(site.id, page.id)
      notify.success(`Página “${page.title}” excluída.`)
      await refresh()
    } catch (error) {
      notify.error(error, 'Não foi possível excluir a página')
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = pages.find((page) => page.id === active.id)
    const to = pages.find((page) => page.id === over.id)
    if (!from || !to) return
    if (from.parentId !== to.parentId) {
      notify.info(
        'Arraste dentro do mesmo nível. Para mudar a página mãe, use Configurações e SEO.',
      )
      return
    }
    const siblings = pages
      .filter((page) => page.parentId === from.parentId)
      .sort((a, b) => a.position - b.position)
    const order = arrayMove(
      siblings,
      siblings.findIndex((page) => page.id === from.id),
      siblings.findIndex((page) => page.id === to.id),
    ).map((page) => page.id)
    void reorder(order)
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center justify-between gap-2 p-3 pb-2'>
        <p className='text-muted-foreground text-xs'>
          {pages.length === 1 ? '1 página' : `${pages.length} páginas`}
        </p>
        {canEdit ? (
          <Button
            size='xs'
            variant='outline'
            onClick={() => setAdding({ parent: null })}
          >
            <SteelIcon icon={Add01Icon} data-icon='inline-start' />
            Nova página
          </Button>
        ) : null}
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-4'>
        {adding ? (
          <div className='px-1 pb-2'>
            <NewPageForm
              parent={adding.parent}
              onDone={() => setAdding(null)}
            />
          </div>
        ) : null}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={rows.map((row) => row.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul aria-label='Páginas do site' className='grid gap-0.5'>
              {rows.map((row) => (
                <PageRow
                  key={row.id}
                  page={row}
                  active={target.kind === 'page' && target.id === row.id}
                  onAction={onAction}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <p className='px-2 pt-3 text-[11px] text-muted-foreground leading-relaxed'>
          Arraste para reordenar. A ordem vale para o menu do site; páginas
          ocultas ficam fora dele.
        </p>
      </div>
      <PageSettingsDialog
        page={settings}
        onOpenChange={(open) => !open && setSettings(null)}
        onSaved={() => void refresh()}
      />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{removing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              A página sai do rascunho agora e do site no ar na próxima
              publicação. Links do menu para ela deixam de aparecer.
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
