'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  KanbanIcon,
  LayoutTable01Icon,
  LeftToRightListBulletIcon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueries } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { ShortcutKbd } from '@/app/_components/shortcuts/shortcut-kbd'
import { useShortcut } from '@/app/_components/shortcuts/shortcuts-provider'
import {
  focusedRow,
  useListShortcuts,
} from '@/app/_components/shortcuts/use-list-shortcuts'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/src/hooks/_fetch'
import { useSdAgents, useSdConfig, useSdMe } from '@/src/hooks/use-sd-config'
import {
  type SdTicketFilters,
  sdTicketKeys,
  sdTicketQueryString,
  useBulkUpdateSdTickets,
  useInfiniteSdTickets,
  useSdTicketKanban,
  useSdTicketRealtime,
  useSdTickets,
} from '@/src/hooks/use-sd-tickets'
import type { SdAgentDTO, SdConfigBootstrapDTO } from '@/types/sd-config'
import type {
  SdSavedViewDTO,
  SdTicketDTO,
  SdTicketKanbanDTO,
  SdTicketTypeDTO,
} from '@/types/sd-ticket'
import {
  type SdCreateTicketPreset,
  SdCreateTicketSheet,
} from '../ticket/sd-create-ticket-sheet'
import { useSdPhaseMover } from '../ticket/sd-phase-mover'
import { useSdNow } from '../ticket/sd-ticket-badges'
import {
  SD_TICKET_TYPE_PLURAL,
  SD_TICKET_TYPES,
} from '../ticket/sd-ticket-meta'
import { sdTypePhases } from '../ticket/sd-ticket-options'
import {
  sdMergeKanbanByCategory,
  sdPhaseForCategory,
  sdTypeKanbanColumns,
} from './sd-board-kanban'
import {
  SD_BOARD_DEFAULTS,
  type SdBoardFilters,
  type SdBoardMode,
  type SdBoardState,
  sdBoardApiFilters,
  sdParseBoardState,
  sdSerializeBoardState,
  sdStateFromView,
} from './sd-board-state'
import { SdFilterBar } from './sd-filter-bar'
import { SdKanbanView } from './sd-kanban-view'
import { SdListView } from './sd-list-view'
import { SdNoPhasesNotice } from './sd-no-phases-notice'
import {
  SdSavedViewsMenu,
  sdDefaultViewKey,
  sdReadDefaultView,
} from './sd-saved-views-menu'
import {
  type SdTableSelectionApi,
  SdTableView,
  sdTicketColumns,
} from './sd-table-view'
import { sdRememberTicketList } from './sd-ticket-nav'

const MODES: { id: SdBoardMode; label: string; icon: IconSvgElement }[] = [
  { id: 'kanban', label: 'Kanban', icon: KanbanIcon },
  { id: 'list', label: 'Lista', icon: LeftToRightListBulletIcon },
  { id: 'table', label: 'Tabela', icon: LayoutTable01Icon },
]

/** Estado do quadro na URL (`?mode=&q=&priorityIds=…`). */
export function useSdBoardUrlState() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const key = params.toString()
  const state = useMemo(
    () => sdParseBoardState(new URLSearchParams(key)),
    [key],
  )
  function replace(next: SdBoardState) {
    const qs = sdSerializeBoardState(next)
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  return { state, replace, hasParams: key.length > 0 }
}

function columnsStorageKey(boardKey: string) {
  return `sd-ticket-columns:${boardKey}`
}

function readHiddenColumns(boardKey: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(columnsStorageKey(boardKey))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeHiddenColumns(boardKey: string, hidden: string[]) {
  try {
    window.localStorage.setItem(
      columnsStorageKey(boardKey),
      JSON.stringify(hidden),
    )
  } catch {
    // Sem storage: vale só nesta sessão.
  }
}

/* ------------------------------------------------------------------ */
/* Modos                                                                */
/* ------------------------------------------------------------------ */

interface ModeProps {
  workspaceId: string
  slug: string
  isAdmin: boolean
  state: SdBoardState
  filters: SdTicketFilters
  config: SdConfigBootstrapDTO | undefined
  agents: SdAgentDTO[]
  onMove: (ticket: SdTicketDTO, phaseId: string) => void
  onCreate: (preset: SdCreateTicketPreset) => void
  onShowMore: () => void
  /** Keyboard move of the focused kanban card (Shift+←/→). */
  moveRef: RefObject<((id: string, columnId: string) => boolean) | null>
  /** Table selection driven by X, Shift+J/K, Ctrl+A and Esc. */
  selectionRef: RefObject<SdTableSelectionApi | null>
}

function TypeKanban({
  type,
  slug,
  filters,
  config,
  onMove,
  onCreate,
  onShowMore,
  workspaceId,
  isAdmin,
  moveRef,
}: ModeProps & { type: SdTicketTypeDTO }) {
  const board = useSdTicketKanban(workspaceId, {
    ...filters,
    type,
    columnLimit: 50,
  })
  const columns = sdTypeKanbanColumns(sdTypePhases(config, type), board.data)
  return (
    <SdKanbanView
      columns={columns}
      slug={slug}
      loading={board.isLoading || !config}
      empty={
        <SdNoPhasesNotice
          workspaceId={workspaceId}
          slug={slug}
          type={type}
          isAdmin={isAdmin}
        />
      }
      onMove={(ticket, phaseId) => onMove(ticket, phaseId)}
      onCreate={(phaseId) => onCreate({ type, phaseId })}
      onShowMore={onShowMore}
      moveRef={moveRef}
    />
  )
}

function AllKanban({
  workspaceId,
  slug,
  state,
  filters,
  config,
  onMove,
  onShowMore,
  isAdmin,
  moveRef,
}: ModeProps) {
  const types = filters.types?.length ? filters.types : SD_TICKET_TYPES
  const boards = useQueries({
    queries: types.map((type) => {
      const f = { ...filters, types: undefined, type, columnLimit: 25 }
      return {
        queryKey: sdTicketKeys.kanban(workspaceId, f),
        queryFn: () =>
          apiFetch<SdTicketKanbanDTO>(
            `/api/workspaces/${workspaceId}/servicedesk/tickets${sdTicketQueryString({ ...f, view: 'kanban' })}`,
            undefined,
            'Erro ao carregar o quadro',
          ),
        staleTime: 15 * 1000,
      }
    }),
  })
  const loading = boards.some((b) => b.isLoading) || !config
  const data = boards.flatMap((b) => (b.data ? [b.data] : []))
  const columns = sdMergeKanbanByCategory(data, state.sort, state.order)
  return (
    <SdKanbanView
      columns={columns}
      slug={slug}
      loading={loading}
      showType
      empty={
        <SdNoPhasesNotice
          workspaceId={workspaceId}
          slug={slug}
          type={types.length === 1 ? types[0] : null}
          isAdmin={isAdmin}
        />
      }
      onMove={(ticket, category) => {
        const phase = sdPhaseForCategory(config, ticket.type, category)
        if (!phase) {
          notify.error('O fluxo deste tipo não tem fase nessa etapa.')
          return
        }
        onMove(ticket, phase.id)
      }}
      onShowMore={onShowMore}
      moveRef={moveRef}
    />
  )
}

function ListMode({ workspaceId, slug, state, filters }: ModeProps) {
  const list = useInfiniteSdTickets(workspaceId, { ...filters, pageSize: 100 })
  const tickets = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <SdListView
      tickets={tickets}
      slug={slug}
      group={state.group}
      loading={list.isLoading}
      showType={!filters.type}
      total={list.data?.pages[0]?.total}
      hasMore={list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
    />
  )
}

function TableMode({
  workspaceId,
  slug,
  state,
  filters,
  config,
  agents,
  hiddenColumns,
  onState,
  selectionRef,
}: ModeProps & {
  hiddenColumns: string[]
  onState: (next: Partial<SdBoardState>) => void
}) {
  const page = useSdTickets(workspaceId, {
    ...filters,
    page: state.page,
    pageSize: state.pageSize,
  })
  return (
    <SdTableView
      workspaceId={workspaceId}
      slug={slug}
      tickets={page.data?.items ?? []}
      total={page.data?.total ?? 0}
      page={state.page}
      pageSize={state.pageSize}
      sort={state.sort}
      order={state.order}
      loading={page.isLoading}
      error={page.error?.message ?? null}
      hiddenColumns={hiddenColumns}
      config={config}
      agents={agents}
      onPageChange={(p) => onState({ page: p })}
      onPageSizeChange={(size) => onState({ pageSize: size, page: 1 })}
      onSortChange={(sort, order) => onState({ sort, order, page: 1 })}
      selectionRef={selectionRef}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Quadro                                                               */
/* ------------------------------------------------------------------ */

/**
 * Quadro de chamados reutilizável: `/tickets` (todos, com seletor de tipo)
 * e `/incidents|requests|changes|problems` (tipo fixo). Três modos —
 * Kanban, Lista e Tabela — sobre o mesmo estado de filtros na URL, visões
 * salvas, tempo real e atalhos do registro (`list.*`, `kanban.*`: J/K,
 * Enter/O, N, /, F, V, X, Shift+A, ←/→ e Shift+←/→ no kanban).
 */
export function SdTicketBoard({
  workspaceId,
  slug,
  fixedType = null,
  isAdmin = false,
}: {
  workspaceId: string
  slug: string
  fixedType?: SdTicketTypeDTO | null
  isAdmin?: boolean
}) {
  const boardKey = fixedType ?? 'ALL'
  const { state, replace, hasParams } = useSdBoardUrlState()
  const config = useSdConfig(workspaceId)
  const agentsQuery = useSdAgents(workspaceId, { includeRequesters: true })
  const agents = agentsQuery.data ?? []
  const now = useSdNow(60_000)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [creating, setCreating] = useState<SdCreateTicketPreset | null>(null)
  // Quick action from the global search (`?new=1`): opens the create sheet.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      setCreating({ type: fixedType ?? 'INCIDENT' })
    }
  }, [fixedType])
  const [hiddenColumns, setHiddenColumns] = useState<string[] | null>(null)
  useSdTicketRealtime(workspaceId)

  const mover = useSdPhaseMover({
    workspaceId,
    slug,
    config: config.data,
    agents,
  })
  const effectiveType = fixedType ?? state.type
  const filters = sdBoardApiFilters(state, fixedType)
  const allColumns = sdTicketColumns({ now, config: config.data, agents })
  const hidden =
    hiddenColumns ?? allColumns.filter((c) => c.defaultHidden).map((c) => c.id)
  const visibleColumns = allColumns
    .filter((c) => !hidden.includes(c.id))
    .map((c) => c.id)

  // Preferências do navegador: colunas e visão padrão (estrela).
  const appliedDefault = useRef(false)
  useEffect(() => {
    setHiddenColumns(readHiddenColumns(boardKey))
    if (appliedDefault.current || hasParams) return
    appliedDefault.current = true
    const id = sdReadDefaultView(sdDefaultViewKey(workspaceId, boardKey))
    if (id) replace({ ...state, viewId: id })
  }, [])

  const update = (patch: Partial<SdBoardState>) =>
    replace({ ...state, ...patch })

  function setFilters(next: SdBoardFilters) {
    replace({ ...state, filters: next, page: 1 })
  }

  function applyView(view: SdSavedViewDTO | null) {
    if (!view) {
      replace({ ...sdParseBoardState(new URLSearchParams()) })
      return
    }
    replace(sdStateFromView(view, state))
    if (view.columns.length > 0) {
      const next = allColumns
        .filter((c) => c.hideable !== false && !view.columns.includes(c.id))
        .map((c) => c.id)
      setHiddenColumns(next)
      writeHiddenColumns(boardKey, next)
    }
  }

  function toggleColumn(id: string, visible: boolean) {
    const next = visible ? hidden.filter((c) => c !== id) : [...hidden, id]
    setHiddenColumns(next)
    writeHiddenColumns(boardKey, next)
  }

  // Atalhos (registro `list.*`, `kanban.*`, `sd.board.*`).
  const listRef = useRef<HTMLDivElement | null>(null)
  const moveRef = useRef<((id: string, columnId: string) => boolean) | null>(
    null,
  )
  const selectionRef = useRef<SdTableSelectionApi | null>(null)
  const me = useSdMe(workspaceId)
  const bulk = useBulkUpdateSdTickets(workspaceId)
  const openCreate = () => setCreating({ type: effectiveType ?? 'INCIDENT' })
  useListShortcuts({
    containerRef: listRef,
    onNew: openCreate,
    onSearch: () => searchRef.current?.focus(),
    onFilters: () => {
      const trigger = document.querySelector<HTMLElement>(
        '[data-shortcut-filters]',
      )
      if (!trigger) return false
      trigger.click()
    },
    onToggleView: () => {
      const index = MODES.findIndex((mode) => mode.id === state.mode)
      update({ mode: MODES[(index + 1) % MODES.length].id, page: 1 })
    },
    isSelected: (id) => selectionRef.current?.isSelected(id) ?? false,
    onToggleSelect: (id) =>
      selectionRef.current ? selectionRef.current.toggle(id) : false,
    onSelectAll: () =>
      selectionRef.current ? selectionRef.current.selectAll() : false,
    onClearSelection: () => selectionRef.current?.clear() ?? false,
    onMove: (id, columnId) => moveRef.current?.(id, columnId) ?? false,
  })
  // C → T on the board opens the sheet here instead of navigating.
  useShortcut('create.ticket', openCreate)
  useShortcut(
    'sd.board.assign-me',
    () => {
      const row = focusedRow(listRef.current)
      const userId = me.data?.userId
      if (!row || !userId) return false
      bulk.mutate(
        { ids: [row.dataset.shortcutRow ?? ''], assigneeId: userId },
        {
          onSuccess: () => notify.success('Chamado atribuído a você.'),
          onError: notify.error,
        },
      )
    },
    { enabled: Boolean(me.data?.isAgent) },
  )
  // J/K inside a ticket walk this list (see `sdRememberTicketList`).
  useEffect(() => {
    sdRememberTicketList(listRef.current)
  })

  const modeProps: ModeProps = {
    workspaceId,
    slug,
    isAdmin,
    state,
    filters,
    config: config.data,
    agents,
    onMove: mover.move,
    onCreate: setCreating,
    onShowMore: () => update({ mode: 'list' }),
    moveRef,
    selectionRef,
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <SdFilterBar
        workspaceId={workspaceId}
        filters={state.filters}
        onChange={setFilters}
        config={config.data}
        agents={agents}
        fixedType={effectiveType}
        searchRef={searchRef}
        sort={state.sort}
        order={state.order}
        onSortChange={(sort, order) => update({ sort, order, page: 1 })}
        onClearAll={() =>
          replace({
            ...state,
            filters: {},
            sort: SD_BOARD_DEFAULTS.sort,
            order: SD_BOARD_DEFAULTS.order,
            page: 1,
          })
        }
        group={state.mode === 'list' ? state.group : undefined}
        onGroupChange={(group) => update({ group })}
      >
        {state.mode === 'table' ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant='outline' size='sm'>
                  <SteelIcon icon={LayoutTable01Icon} strokeWidth={2} />
                  Colunas
                </Button>
              }
            />
            <DropdownMenuContent align='end' className='max-h-96 w-56'>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allColumns
                  .filter((c) => c.hideable !== false)
                  .map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={!hidden.includes(c.id)}
                      onCheckedChange={(checked) =>
                        toggleColumn(c.id, Boolean(checked))
                      }
                    >
                      {c.header}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <fieldset
          aria-label='Modo de exibição'
          data-tour='sd-board-modes'
          className='flex items-center gap-0.5 rounded-md border p-0.5'
        >
          {MODES.map((mode) => (
            <Button
              key={mode.id}
              type='button'
              variant={state.mode === mode.id ? 'secondary' : 'ghost'}
              size='icon-sm'
              aria-pressed={state.mode === mode.id}
              aria-label={mode.label}
              title={mode.label}
              onClick={() => update({ mode: mode.id, page: 1 })}
            >
              <SteelIcon icon={mode.icon} strokeWidth={2} />
            </Button>
          ))}
        </fieldset>

        <SdSavedViewsMenu
          workspaceId={workspaceId}
          boardKey={boardKey}
          ticketType={fixedType}
          state={state}
          columns={visibleColumns}
          isAdmin={isAdmin}
          onApply={applyView}
        />

        <Button
          size='sm'
          data-tour='sd-board-new'
          onClick={() => setCreating({ type: effectiveType ?? 'INCIDENT' })}
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Novo chamado
          <ShortcutKbd
            id='list.new'
            className='ml-1 hidden sm:inline-flex [&_kbd]:bg-primary-foreground/20 [&_kbd]:text-primary-foreground'
          />
        </Button>
      </SdFilterBar>

      {fixedType ? null : (
        <div
          role='tablist'
          aria-label='Tipo de chamado'
          data-tour='sd-board-types'
          className='flex shrink-0 items-center gap-1 border-b px-4'
        >
          {[null, ...SD_TICKET_TYPES].map((type) => (
            <button
              key={type ?? 'ALL'}
              type='button'
              role='tab'
              aria-selected={state.type === type}
              onClick={() => update({ type, page: 1 })}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors',
                state.type === type
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {type ? SD_TICKET_TYPE_PLURAL[type] : 'Todos'}
            </button>
          ))}
        </div>
      )}

      <div
        ref={listRef}
        data-tour='sd-board-content'
        className='min-h-0 flex-1 overflow-auto'
      >
        {state.mode === 'kanban' ? (
          effectiveType ? (
            <TypeKanban
              key={effectiveType}
              {...modeProps}
              type={effectiveType}
            />
          ) : (
            <AllKanban {...modeProps} />
          )
        ) : state.mode === 'list' ? (
          <ListMode {...modeProps} />
        ) : (
          <TableMode {...modeProps} hiddenColumns={hidden} onState={update} />
        )}
      </div>

      {mover.dialog}
      <SdCreateTicketSheet
        workspaceId={workspaceId}
        slug={slug}
        open={creating !== null}
        onOpenChange={(open) => !open && setCreating(null)}
        defaultType={creating?.type ?? effectiveType ?? 'INCIDENT'}
        preset={creating ?? undefined}
      />
    </div>
  )
}
