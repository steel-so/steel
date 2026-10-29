'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  Delete02Icon,
  Drag01Icon,
  FilterIcon,
  InboxIcon,
  KanbanIcon,
  PlusSignIcon,
  Search01Icon,
  Table01Icon,
  ViewOffIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  flexRender,
  type Row,
  type SortingState,
  useTable,
} from '@tanstack/react-table'
import * as React from 'react'
import {
  buildGridColumns,
  draftInitialValues,
  draftPayload,
  type GridColumn,
  type WithId,
} from '@/app/_components/crm/table/grid'
import {
  type CrmKanbanColumnDef,
  CrmKanbanView,
} from '@/app/_components/crm/table/kanban-view'
import { RecordPanel } from '@/app/_components/crm/table/record-panel'
import {
  type CrmTableFeatures,
  crmTableFeatures,
} from '@/app/_components/crm/table/table-features'
import { useShortcut } from '@/app/_components/shortcuts/shortcuts-provider'
import {
  focusedRow,
  useListShortcuts,
} from '@/app/_components/shortcuts/use-list-shortcuts'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  createCrmResource,
  deleteCrmResource,
  reorderCrmResource,
  updateCrmResource,
} from '@/src/hooks/use-crm-resource-list'
import type { Lookups } from '@/src/hooks/use-crm-workspace-lookups'
import { useRecordParam } from '@/src/hooks/use-record-param'
import { CRM_ROUTE_RESOURCE } from '@/src/lib/permissions'

type CalcType =
  | 'none'
  | 'count-all'
  | 'count-empty'
  | 'count-not-empty'
  | 'count-unique'
  | 'percent-empty'
  | 'percent-not-empty'
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'earliest'
  | 'latest'

const CALC_LABEL: Record<CalcType, string> = {
  none: 'Calcular',
  'count-all': 'Contagem',
  'count-empty': 'Vazio',
  'count-not-empty': 'Não vazio',
  'count-unique': 'Único',
  'percent-empty': 'Vazio',
  'percent-not-empty': 'Não vazio',
  sum: 'Soma',
  average: 'Média',
  min: 'Mín',
  max: 'Máx',
  earliest: 'Mais antigo',
  latest: 'Mais recente',
}

/** Tipos de coluna numéricos: habilitam soma/média/mín/máx no rodapé. */
type ColumnKind = GridColumn['kind'] | undefined

function isNumericKind(kind: ColumnKind): boolean {
  return kind === 'number' || kind === 'money'
}

function isDateKind(kind: ColumnKind): boolean {
  return kind === 'date' || kind === 'readonly-date'
}

const calcMoneyFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})
const calcNumberFmt = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
})
const calcDateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatCalcNumber(n: number, kind: ColumnKind): string {
  return kind === 'money' ? calcMoneyFmt.format(n) : calcNumberFmt.format(n)
}

/** Converte valores em números finitos, descartando vazios/inválidos. */
function toFiniteNumbers(values: unknown[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (isEmptyValue(v)) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/** Converte valores (ISO/Date) em timestamps válidos, descartando vazios. */
function toTimestamps(values: unknown[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (isEmptyValue(v)) continue
    const t = new Date(v as string).getTime()
    if (Number.isFinite(t)) out.push(t)
  }
  return out
}

const DRAG_COL_SIZE = 44
const SELECT_COL_SIZE = 44
const ACTIONS_COL_SIZE = 44

/** Fundo opaco das colunas fixas (cobre o conteúdo que rola atrás). */
const STICKY_BODY_BG =
  'bg-card group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted'

/** Deslocamento `left` das colunas fixas (drag, select, nome/título). */
function stickyLeftFor(id: string, primaryKey: string | null): number | null {
  if (id === 'drag') return 0
  if (id === 'select') return DRAG_COL_SIZE
  if (primaryKey && id === primaryKey) return DRAG_COL_SIZE + SELECT_COL_SIZE
  return null
}

function cellStyle(width: number, left: number | null): React.CSSProperties {
  if (left == null) return { width }
  return { width, position: 'sticky', left, zIndex: 2 }
}

function isEmptyValue(value: unknown): boolean {
  return (
    value == null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function computeCalc(
  calc: CalcType,
  values: unknown[],
  kind: ColumnKind,
): string | null {
  const total = values.length
  const empty = values.filter(isEmptyValue).length
  const notEmpty = total - empty
  const pct = (n: number) =>
    total ? `${Math.round((n / total) * 100)}%` : '0%'
  switch (calc) {
    case 'none':
      return null
    case 'count-all':
      return String(total)
    case 'count-empty':
      return String(empty)
    case 'count-not-empty':
      return String(notEmpty)
    case 'count-unique':
      return String(
        new Set(
          values.filter((v) => !isEmptyValue(v)).map((v) => JSON.stringify(v)),
        ).size,
      )
    case 'percent-empty':
      return pct(empty)
    case 'percent-not-empty':
      return pct(notEmpty)
    case 'sum': {
      const nums = toFiniteNumbers(values)
      return formatCalcNumber(
        nums.reduce((a, b) => a + b, 0),
        kind,
      )
    }
    case 'average': {
      const nums = toFiniteNumbers(values)
      if (!nums.length) return '—'
      return formatCalcNumber(
        nums.reduce((a, b) => a + b, 0) / nums.length,
        kind,
      )
    }
    case 'min': {
      const nums = toFiniteNumbers(values)
      if (!nums.length) return '—'
      return formatCalcNumber(Math.min(...nums), kind)
    }
    case 'max': {
      const nums = toFiniteNumbers(values)
      if (!nums.length) return '—'
      return formatCalcNumber(Math.max(...nums), kind)
    }
    case 'earliest': {
      const times = toTimestamps(values)
      if (!times.length) return '—'
      return calcDateFmt.format(new Date(Math.min(...times)))
    }
    case 'latest': {
      const times = toTimestamps(values)
      if (!times.length) return '—'
      return calcDateFmt.format(new Date(Math.max(...times)))
    }
  }
}

function columnLabel<TData extends WithId>(
  column: Column<CrmTableFeatures, TData>,
): string {
  const header = column.columnDef.header
  return typeof header === 'string' ? header : column.id
}

type SortableHandle = Pick<
  ReturnType<typeof useSortable>,
  'attributes' | 'listeners' | 'setActivatorNodeRef'
>

function DragHandle({ handle }: { handle: SortableHandle }) {
  return (
    <Button
      ref={handle.setActivatorNodeRef}
      {...handle.attributes}
      {...handle.listeners}
      variant='ghost'
      size='icon-sm'
      className='size-7 cursor-grab text-muted-foreground hover:bg-transparent active:cursor-grabbing'
    >
      <SteelIcon icon={Drag01Icon} strokeWidth={2} className='size-4' />
      <span className='sr-only'>Arrastar para reordenar</span>
    </Button>
  )
}

function DraggableRow<TData extends WithId>({
  row,
  onDelete,
  canDelete,
  primaryKey,
}: {
  row: Row<CrmTableFeatures, TData>
  onDelete: (id: string) => void
  canDelete: boolean
  primaryKey: string | null
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.original.id })

  return (
    <TableRow
      ref={setNodeRef}
      data-state={row.getIsSelected() && 'selected'}
      data-dragging={isDragging}
      data-shortcut-row={row.original.id}
      tabIndex={-1}
      className='group/row relative z-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset data-[dragging=true]:z-10 data-[dragging=true]:opacity-80'
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {row.getVisibleCells().map((cell) => {
        const left = stickyLeftFor(cell.column.id, primaryKey)
        return (
          <TableCell
            key={cell.id}
            style={cellStyle(cell.column.getSize(), left)}
            className={cn('align-middle', left != null && STICKY_BODY_BG)}
          >
            {cell.column.id === 'drag' ? (
              <DragHandle
                handle={{ attributes, listeners, setActivatorNodeRef }}
              />
            ) : cell.column.id === 'actions' ? (
              canDelete ? (
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='size-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100'
                  onClick={() => onDelete(row.original.id)}
                  aria-label='Excluir'
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              ) : null
            ) : (
              flexRender(cell.column.columnDef.cell, cell.getContext())
            )}
          </TableCell>
        )
      })}
    </TableRow>
  )
}

function CalcFooterCell<TData extends WithId>({
  column,
  rows,
  value,
  onChange,
}: {
  column: Column<CrmTableFeatures, TData>
  rows: Row<CrmTableFeatures, TData>[]
  value: CalcType
  onChange: (calc: CalcType) => void
}) {
  const kind = column.columnDef.meta?.kind
  const values = rows.map((row) => row.getValue(column.id))
  const result = computeCalc(value, values, kind)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            className='group/calc flex h-8 w-full items-center justify-start gap-1 px-2 text-left text-xs outline-none'
          />
        }
      >
        {result === null ? (
          <span className='text-muted-foreground opacity-0 transition-opacity group-hover/calc:opacity-100'>
            Calcular
          </span>
        ) : (
          <>
            <span className='text-muted-foreground'>{CALC_LABEL[value]}</span>
            <span className='font-medium tabular-nums'>{result}</span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuGroup>
          <DropdownMenuLabel className='text-muted-foreground text-xs'>
            Contagem
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onChange('count-all')}>
            Contar tudo
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange('count-empty')}>
            Contar vazios
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange('count-not-empty')}>
            Contar não vazios
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange('count-unique')}>
            Contar valores únicos
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className='text-muted-foreground text-xs'>
            Porcentagem
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onChange('percent-empty')}>
            Porcentagem vazia
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange('percent-not-empty')}>
            Porcentagem não vazia
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {isNumericKind(kind) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className='text-muted-foreground text-xs'>
                Mais opções
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onChange('min')}>
                Mínimo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onChange('max')}>
                Máximo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onChange('average')}>
                Média
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onChange('sum')}>
                Soma
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
        {isDateKind(kind) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className='text-muted-foreground text-xs'>
                Data
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onChange('earliest')}>
                Data mais antiga
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onChange('latest')}>
                Data mais recente
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onChange('none')}>
          Nenhum
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Dropdown do cabeçalho: filtro, ordenação e ocultar — acionam as funções. */
function HeaderMenu<TData extends WithId>({
  column,
}: {
  column: Column<CrmTableFeatures, TData>
}) {
  const label = columnLabel(column)
  const sorted = column.getIsSorted()
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type='button'
            className='-mx-1 flex w-full items-center gap-1 rounded px-1 text-left outline-none hover:text-foreground aria-expanded:text-foreground'
          />
        }
      >
        <span className='truncate'>{label}</span>
        {sorted ? (
          <SteelIcon
            icon={sorted === 'asc' ? ArrowUp01Icon : ArrowDown01Icon}
            strokeWidth={2}
            className='size-3.5 shrink-0'
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-56 gap-2 p-2 normal-case tracking-normal'
      >
        {column.getCanFilter() ? (
          <div className='grid gap-1'>
            <span className='font-medium text-muted-foreground text-xs'>
              Filtrar
            </span>
            <Input
              value={(column.getFilterValue() as string) ?? ''}
              onChange={(e) => column.setFilterValue(e.target.value)}
              placeholder={`Filtrar ${label}…`}
              className='h-8'
            />
          </div>
        ) : null}
        {column.getCanSort() ? (
          <div className='grid gap-1'>
            <span className='font-medium text-muted-foreground text-xs'>
              Ordenar
            </span>
            <div className='flex gap-1'>
              <Button
                variant={sorted === 'asc' ? 'default' : 'outline'}
                size='xs'
                className='flex-1'
                onClick={() => column.toggleSorting(false)}
              >
                <SteelIcon icon={ArrowUp01Icon} strokeWidth={2} />
                Asc
              </Button>
              <Button
                variant={sorted === 'desc' ? 'default' : 'outline'}
                size='xs'
                className='flex-1'
                onClick={() => column.toggleSorting(true)}
              >
                <SteelIcon icon={ArrowDown01Icon} strokeWidth={2} />
                Desc
              </Button>
            </div>
          </div>
        ) : null}
        {column.getCanHide() ? (
          <Button
            variant='ghost'
            size='sm'
            className='justify-start'
            onClick={() => column.toggleVisibility(false)}
          >
            <SteelIcon icon={ViewOffIcon} strokeWidth={2} />
            Ocultar coluna
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** Tag removível usada na barra de filtros/ordenação ativos. */
function Chip({
  children,
  onRemove,
}: {
  children: React.ReactNode
  onRemove: () => void
}) {
  return (
    <span className='inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-2 text-xs'>
      {children}
      <button
        type='button'
        onClick={onRemove}
        className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
        aria-label='Remover'
      >
        <SteelIcon icon={Cancel01Icon} strokeWidth={2} className='size-3' />
      </button>
    </span>
  )
}

/** Substantivos femininos usados como `createTitle` nas grades do CRM. */
const FEMININE_TITLES = new Set([
  'campanha',
  'empresa',
  'lista',
  'nota',
  'oportunidade',
  'página',
  'pessoa',
  'proposta',
  'tarefa',
])

/** Rótulo do botão de criação com concordância de gênero ("Nova pessoa"). */
/** `C → O|P|E|A` creates here when the table is already on screen. */
const CREATE_SHORTCUT: Record<string, string> = {
  opportunities: 'create.opportunity',
  people: 'create.person',
  companies: 'create.company',
  tasks: 'create.crm-task',
}

export function newRecordLabel(title: string): string {
  return `${FEMININE_TITLES.has(title.toLowerCase()) ? 'Nova' : 'Novo'} ${title}`
}

export function DataTable<TData extends WithId>({
  columns,
  data,
  workspaceId,
  slug,
  resource,
  createTitle,
  lookups,
  searchPlaceholder = 'Pesquisar…',
  isLoading = false,
  refetch,
  disableInlineCreate = false,
  headerAction,
  headerExtra,
  onOpenRecord,
  renderRecordExtra,
  kanban,
}: {
  columns: GridColumn[]
  data: TData[]
  /** Usado nas chamadas de API (PATCH/POST/DELETE). */
  workspaceId: string
  /** Usado nos links de navegação das colunas de relação. */
  slug: string
  resource: string
  /** Nome singular para o botão "Novo X". */
  createTitle: string
  lookups: Lookups
  searchPlaceholder?: string
  isLoading?: boolean
  /** Recarrega a lista do servidor (usado para resync em caso de erro). */
  refetch: () => void
  /**
   * Desativa criação inline (esconde botão "Novo X" e linha "+ Adicionar novo").
   * Use junto com `headerAction` para entidades que precisam de fluxo
   * personalizado (ex.: campanhas com composer dedicado).
   */
  disableInlineCreate?: boolean
  /** Botão customizado no canto direito da toolbar (substitui "Novo X"). */
  headerAction?: React.ReactNode
  /** Ação extra na toolbar, antes do botão "Novo X" (que continua). */
  headerExtra?: React.ReactNode
  /**
   * Sobrescreve o painel default ao abrir um registro. Recebe o registro
   * completo. Útil para entidades que precisam de UI dedicada. Returning
   * `false` falls back to the default panel for that record.
   */
  onOpenRecord?: (record: TData) => unknown
  /**
   * Conteúdo extra renderizado no rodapé do painel de detalhes (ex.: line
   * items de uma oportunidade). Recebe o registro aberto.
   */
  renderRecordExtra?: (record: TData) => React.ReactNode
  /**
   * Habilita a opção de visualização em Kanban (além da tabela) — colunas
   * fixas de um campo categórico (ex.: status). Arrastar um card entre
   * colunas grava o novo valor via PATCH. Escolha de visão persiste em
   * localStorage por workspace+recurso.
   */
  kanban?: {
    groupByKey: string
    columns: CrmKanbanColumnDef[]
    renderCard: (record: TData) => React.ReactNode
  }
}) {
  // Esconde a exclusão para quem não tem DELETE no recurso (a API negaria).
  const canDelete = useCan(CRM_ROUTE_RESOURCE[resource] ?? resource, 'DELETE')

  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const searchRef = React.useRef<HTMLInputElement | null>(null)
  /** `#` with a confirmation: ids waiting for "Excluir". */
  const [deleteIds, setDeleteIds] = React.useState<string[] | null>(null)
  const [rows, setRows] = React.useState(() => data)
  React.useEffect(() => setRows(data), [data])

  /** id da linha recém-criada — entra em edição inline no campo primário. */
  const [newRowId, setNewRowId] = React.useState<string | null>(null)

  /** Registro aberto no painel lateral de detalhes; `null` = fechado. */
  const [openRecordId, setOpenRecordId] = React.useState<string | null>(null)

  // Deep link (`?record=<id>`, e.g. from Steel AI): opens that record's panel
  // once the rows are loaded. Read from `window` to stay out of Suspense.
  React.useEffect(() => {
    if (onOpenRecord) return
    const id = new URLSearchParams(window.location.search).get('record')
    if (id) setOpenRecordId(id)
  }, [onOpenRecord])

  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  )
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })
  /** Opção de cálculo por coluna — persistida por workspace + recurso. */
  const calcStorageKey = `steel:crm-table-calc:${workspaceId}:${resource}`
  const [calc, setCalc] = React.useState<Record<string, CalcType>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = window.localStorage.getItem(calcStorageKey)
      return raw ? (JSON.parse(raw) as Record<string, CalcType>) : {}
    } catch {
      return {}
    }
  })
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(calcStorageKey, JSON.stringify(calc))
    } catch {
      // Ignora cota cheia / modo privado.
    }
  }, [calc, calcStorageKey])

  /** Tabela ou Kanban — persistida por workspace + recurso. */
  const viewStorageKey = `steel:crm-table-view:${workspaceId}:${resource}`
  const [viewMode, setViewMode] = React.useState<'table' | 'kanban'>(() => {
    if (!kanban || typeof window === 'undefined') return 'table'
    try {
      const raw = window.localStorage.getItem(viewStorageKey)
      return raw === 'kanban' ? 'kanban' : 'table'
    } catch {
      return 'table'
    }
  })
  React.useEffect(() => {
    if (!kanban || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(viewStorageKey, viewMode)
    } catch {
      // Ignora cota cheia / modo privado.
    }
  }, [viewMode, viewStorageKey, kanban])

  /** Roda do mouse vertical → rolagem horizontal da tabela (sem segurar Shift). */
  const tableScrollRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Trackpad/Shift já produzem deltaX — não interferir nesses casos.
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 0) return // sem overflow horizontal
      const atStart = el.scrollLeft <= 0
      const atEnd = el.scrollLeft >= maxScroll - 1
      // Nas bordas, devolve o gesto para a rolagem vertical (linhas).
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const sortableId = React.useId()
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  )

  const patch = React.useCallback(
    (id: string, fields: Record<string, unknown>) => {
      const wasNewRow = newRowId === id
      setNewRowId((cur) => (cur === id ? null : cur))
      setRows((cur) =>
        cur.map((row) => (row.id === id ? { ...row, ...fields } : row)),
      )
      void updateCrmResource(workspaceId, resource, id, fields).then((res) => {
        if (!res.ok) {
          notify.error(res.message ?? 'Não foi possível salvar.')
          if (wasNewRow) {
            // Linha criada em branco por addRow(); se o campo primário (ex.:
            // CNPJ duplicado) falha logo na primeira edição, não faz sentido
            // manter o registro fantasma — remove em vez de só reverter o campo.
            setRows((cur) => cur.filter((row) => row.id !== id))
            void deleteCrmResource(workspaceId, resource, id)
          } else {
            refetch()
          }
        }
      })
    },
    [workspaceId, resource, refetch, newRowId],
  )

  const removeRow = React.useCallback(
    (id: string) => {
      const previous = rows
      setRows((cur) => cur.filter((row) => row.id !== id))
      void deleteCrmResource(workspaceId, resource, id).then((res) => {
        if (!res.ok) {
          notify.error(res.message ?? 'Não foi possível excluir.')
          setRows(previous)
        }
      })
    },
    [rows, workspaceId, resource],
  )

  /** Abre o painel lateral de detalhes/edição — usado tanto pela grade
   * (célula primária) quanto pelo card do Kanban. */
  const openRecordById = React.useCallback(
    (id: string) => {
      if (onOpenRecord) {
        const found = rows.find((r) => r.id === id)
        if (!found || onOpenRecord(found) !== false) return
      }
      setOpenRecordId(id)
    },
    [onOpenRecord, rows],
  )

  // Deep link from the notification inbox: `?record=<id>` opens the panel.
  const isRowLoaded = React.useCallback(
    (id: string) => rows.some((row) => row.id === id),
    [rows],
  )
  useRecordParam(openRecordById, isRowLoaded)

  /**
   * Cria a linha já no banco (sem etapa de confirmação) e a abre em edição.
   * O campo primário obrigatório recebe um valor padrão para passar na
   * validação; o usuário renomeia inline em seguida (auto-save).
   */
  const addRow = React.useCallback(() => {
    const payload = draftPayload(columns, draftInitialValues(columns))
    // Toda coluna obrigatória exige um valor para passar na validação; o
    // usuário edita inline em seguida (auto-save). Outros tipos de coluna
    // (ex.: CNPJ, não-obrigatórias) nascem vazios.
    for (const column of columns) {
      if (!column.required || payload[column.key]) continue
      if (
        column.kind === 'text' ||
        column.kind === 'emailhtml' ||
        column.kind === 'richtext'
      ) {
        payload[column.key] = column.primary
          ? 'Sem título'
          : (column.placeholder ?? 'Sem título')
      }
    }
    void createCrmResource<TData>(workspaceId, resource, payload).then(
      (res) => {
        if (!res.ok || !res.data) {
          notify.error(res.message ?? 'Não foi possível criar.')
          return
        }
        const created = res.data
        // Item recém-criado entra como o mais recente: no topo da lista e
        // na primeira página, independente de ordenação/paginação atuais.
        setRows((cur) => [created, ...cur])
        setSorting([])
        setPagination((cur) => ({ ...cur, pageIndex: 0 }))
        if (viewMode === 'kanban') {
          // Kanban não tem célula pra editar inline — abre o painel lateral
          // direto, igual ao clique num card.
          openRecordById(created.id)
        } else {
          setNewRowId(created.id)
        }
      },
    )
  }, [columns, workspaceId, resource, viewMode, openRecordById])

  // Quick action from the global search / C → O|P|E|A (`?new=1`).
  const createdFromParam = React.useRef(false)
  React.useEffect(() => {
    if (createdFromParam.current || disableInlineCreate) return
    if (new URLSearchParams(window.location.search).get('new') !== '1') return
    createdFromParam.current = true
    addRow()
  }, [addRow, disableInlineCreate])

  const tableColumns = React.useMemo<
    ColumnDef<CrmTableFeatures, TData>[]
  >(() => {
    const drag: ColumnDef<CrmTableFeatures, TData> = {
      id: 'drag',
      header: () => null,
      cell: () => null,
      size: DRAG_COL_SIZE,
      enableSorting: false,
      enableHiding: false,
    }
    const select: ColumnDef<CrmTableFeatures, TData> = {
      id: 'select',
      size: SELECT_COL_SIZE,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={
            table.getIsSomePageRowsSelected() &&
            !table.getIsAllPageRowsSelected()
          }
          onCheckedChange={(value) =>
            table.toggleAllPageRowsSelected(Boolean(value))
          }
          aria-label='Selecionar tudo'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
          aria-label='Selecionar linha'
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }
    const actions: ColumnDef<CrmTableFeatures, TData> = {
      id: 'actions',
      header: () => null,
      cell: () => null,
      size: ACTIONS_COL_SIZE,
      enableSorting: false,
      enableHiding: false,
    }
    return [drag, select, ...buildGridColumns<TData>(columns, lookups), actions]
  }, [columns, lookups])

  const dataIds = React.useMemo<UniqueIdentifier[]>(
    () => rows.map((row) => row.id),
    [rows],
  )

  const table = useTable({
    features: crmTableFeatures,
    data: rows,
    columns: tableColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
      pagination,
    },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    globalFilterFn: 'includesString',
    meta: {
      grid: {
        slug,
        workspaceId,
        resource,
        lookups,
        patch,
        openRecord: openRecordById,
        newRowId,
      },
    },
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
  })

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active && over && active.id !== over.id) {
      setRows((current) => {
        const oldIndex = current.findIndex((r) => r.id === active.id)
        const newIndex = current.findIndex((r) => r.id === over.id)
        const next = arrayMove(current, oldIndex, newIndex)
        void reorderCrmResource(
          workspaceId,
          resource,
          next.map((row) => row.id),
        )
        return next
      })
    }
  }

  const dataColumns = table
    .getAllColumns()
    .filter((column) => typeof column.accessorFn !== 'undefined')
  const filteredRows = table.getFilteredRowModel().rows
  const visibleLeafColumns = table.getVisibleLeafColumns()
  const primaryKey = columns.find((c) => c.primary)?.key ?? null
  const hasActiveChips = columnFilters.length > 0 || sorting.length > 0
  const isEmpty = !isLoading && table.getRowModel().rows.length === 0
  const openRecord = openRecordId
    ? rows.find((row) => row.id === openRecordId)
    : undefined

  // Keyboard (registry `list.*`, `kanban.*`, `create.*`).
  const rowById = (id: string) =>
    table.getRowModel().rows.find((row) => row.original.id === id)
  useListShortcuts({
    containerRef: rootRef,
    onOpen: (id) => openRecordById(id),
    onEdit: (id) => openRecordById(id),
    onNew: disableInlineCreate ? undefined : addRow,
    onSearch: () => searchRef.current?.focus(),
    onFilters: () => {
      const trigger = rootRef.current?.querySelector<HTMLElement>(
        '[data-shortcut-filters]',
      )
      if (!trigger) return false
      trigger.click()
    },
    isSelected: (id) => Boolean(rowById(id)?.getIsSelected()),
    onToggleSelect: (id) => {
      const row = rowById(id)
      if (!row) return false
      row.toggleSelected()
    },
    onSelectAll: () => table.toggleAllPageRowsSelected(true),
    onClearSelection: () => {
      if (Object.keys(rowSelection).length === 0) return false
      table.resetRowSelection()
    },
    onDelete: canDelete
      ? (id) => {
          const selected = Object.keys(rowSelection)
          const ids = selected.length > 0 ? selected : id ? [id] : []
          if (ids.length === 0) return false
          setDeleteIds(ids)
        }
      : undefined,
    onToggleView: kanban
      ? () => setViewMode((mode) => (mode === 'kanban' ? 'table' : 'kanban'))
      : undefined,
    onMove: kanban
      ? (id, column) => patch(id, { [kanban.groupByKey]: column })
      : undefined,
  })
  // Shift+C on the tasks table: done ↔ to do for the row in focus.
  useShortcut(
    'crm.task.toggle-done',
    () => {
      const row = focusedRow(rootRef.current)
      const id = row?.dataset.shortcutRow
      const task = id ? rowById(id)?.original : undefined
      if (!id || !task) return false
      const done = (task as Record<string, unknown>).status === 'DONE'
      patch(id, { status: done ? 'TODO' : 'DONE' })
      notify.success(done ? 'Tarefa reaberta' : 'Tarefa concluída')
    },
    { enabled: resource === 'tasks' },
  )
  const createId = CREATE_SHORTCUT[resource]
  useShortcut(createId ?? 'create.opportunity', addRow, {
    enabled: Boolean(createId) && !disableInlineCreate,
  })

  return (
    <div ref={rootRef} className='flex h-full min-h-0 flex-col gap-3 p-4'>
      {/* Toolbar */}
      <div className='flex shrink-0 flex-wrap items-center gap-2'>
        <div className='relative mr-auto'>
          <SteelIcon
            icon={Search01Icon}
            strokeWidth={2}
            className='-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground'
          />
          <Input
            ref={searchRef}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className='h-8 w-56 pl-8'
          />
        </div>

        {/* Filter */}
        <Popover>
          <PopoverTrigger
            render={
              <Button variant='outline' size='sm' data-shortcut-filters>
                <SteelIcon icon={FilterIcon} strokeWidth={2} />
                Filtrar
                {columnFilters.length > 0 ? (
                  <span className='ml-1 rounded bg-primary px-1 text-primary-foreground text-xs'>
                    {columnFilters.length}
                  </span>
                ) : null}
              </Button>
            }
          />
          <PopoverContent align='end' className='w-72'>
            <div className='grid gap-3'>
              <p className='font-medium text-sm'>Filtrar por coluna</p>
              {dataColumns
                .filter((column) => column.getCanFilter())
                .map((column) => (
                  <div key={column.id} className='grid gap-1'>
                    <span className='text-muted-foreground text-xs'>
                      {columnLabel(column)}
                    </span>
                    <Input
                      value={(column.getFilterValue() as string) ?? ''}
                      onChange={(e) => column.setFilterValue(e.target.value)}
                      placeholder={`Filtrar ${columnLabel(column)}…`}
                      className='h-8'
                    />
                  </div>
                ))}
              <Button
                variant='ghost'
                size='sm'
                onClick={() => table.resetColumnFilters()}
                disabled={columnFilters.length === 0}
              >
                <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                Limpar filtros
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Sort */}
        <Popover>
          <PopoverTrigger
            render={
              <Button variant='outline' size='sm'>
                <SteelIcon icon={ArrowUpDownIcon} strokeWidth={2} />
                Ordenar
                {sorting.length > 0 ? (
                  <span className='ml-1 rounded bg-primary px-1 text-primary-foreground text-xs'>
                    {sorting.length}
                  </span>
                ) : null}
              </Button>
            }
          />
          <PopoverContent align='end' className='w-72'>
            <div className='grid gap-2'>
              <p className='font-medium text-sm'>Ordenar por</p>
              {dataColumns
                .filter((column) => column.getCanSort())
                .map((column) => {
                  const sorted = column.getIsSorted()
                  return (
                    <div
                      key={column.id}
                      className='flex items-center justify-between gap-2'
                    >
                      <span className='truncate text-sm'>
                        {columnLabel(column)}
                      </span>
                      <div className='flex gap-1'>
                        <Button
                          variant={sorted === 'asc' ? 'default' : 'outline'}
                          size='xs'
                          onClick={() => column.toggleSorting(false)}
                        >
                          Asc
                        </Button>
                        <Button
                          variant={sorted === 'desc' ? 'default' : 'outline'}
                          size='xs'
                          onClick={() => column.toggleSorting(true)}
                        >
                          Desc
                        </Button>
                      </div>
                    </div>
                  )
                })}
              <Button
                variant='ghost'
                size='sm'
                onClick={() => table.resetSorting()}
                disabled={sorting.length === 0}
              >
                <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                Limpar ordenação
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Columns visibility */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant='outline' size='sm'>
                Colunas
                <SteelIcon icon={ArrowDown01Icon} strokeWidth={2} />
              </Button>
            }
          />
          <DropdownMenuContent align='end' className='w-48'>
            {dataColumns
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) =>
                    column.toggleVisibility(Boolean(value))
                  }
                >
                  {columnLabel(column)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {kanban ? (
          <div className='flex items-center gap-0.5 rounded-md border p-0.5'>
            <Button
              type='button'
              variant={viewMode === 'table' ? 'secondary' : 'ghost'}
              size='icon-sm'
              onClick={() => setViewMode('table')}
              aria-label='Visualizar em tabela'
            >
              <SteelIcon icon={Table01Icon} strokeWidth={2} />
            </Button>
            <Button
              type='button'
              variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
              size='icon-sm'
              onClick={() => setViewMode('kanban')}
              aria-label='Visualizar em kanban'
            >
              <SteelIcon icon={KanbanIcon} strokeWidth={2} />
            </Button>
          </div>
        ) : null}

        {headerExtra}
        {headerAction ??
          (disableInlineCreate ? null : (
            <Button size='sm' onClick={addRow}>
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              {newRecordLabel(createTitle)}
            </Button>
          ))}
      </div>

      {/* Filtros e ordenação ativos */}
      {hasActiveChips ? (
        <div className='flex shrink-0 flex-wrap items-center gap-1.5'>
          {columnFilters.map((f) => {
            const col = table.getColumn(f.id)
            const name = col ? columnLabel(col) : f.id
            return (
              <Chip
                key={`filter-${f.id}`}
                onRemove={() => col?.setFilterValue(undefined)}
              >
                <SteelIcon
                  icon={FilterIcon}
                  strokeWidth={2}
                  className='size-3 text-muted-foreground'
                />
                <span className='font-medium'>{name}</span>
                <span className='max-w-32 truncate text-muted-foreground'>
                  {String(f.value)}
                </span>
              </Chip>
            )
          })}
          {sorting.map((s) => {
            const col = table.getColumn(s.id)
            const name = col ? columnLabel(col) : s.id
            return (
              <Chip key={`sort-${s.id}`} onRemove={() => col?.clearSorting()}>
                <SteelIcon
                  icon={s.desc ? ArrowDown01Icon : ArrowUp01Icon}
                  strokeWidth={2}
                  className='size-3 text-muted-foreground'
                />
                <span className='font-medium'>{name}</span>
              </Chip>
            )
          })}
          <Button
            variant='ghost'
            size='xs'
            className='text-muted-foreground'
            onClick={() => {
              table.resetColumnFilters()
              table.resetSorting()
            }}
          >
            Limpar tudo
          </Button>
        </div>
      ) : null}

      {/* Table
          Um único container rola nos dois eixos (ref abaixo) — o wrapper
          interno do <Table> teria seu próprio overflow-x-auto, e dois
          containers de scroll aninhados quebram o cálculo de position:sticky
          do TableHeader (ele gruda no ancestral errado e "solta" a cabeçalho
          durante o scroll horizontal). */}
      {viewMode === 'kanban' && kanban ? (
        <div className='min-h-0 flex-1 overflow-hidden'>
          <CrmKanbanView
            items={table.getFilteredRowModel().rows.map((r) => r.original)}
            groupByKey={kanban.groupByKey}
            columns={kanban.columns}
            renderCard={kanban.renderCard}
            onMove={(itemId, toColumn) =>
              patch(itemId, { [kanban.groupByKey]: toColumn })
            }
            onCardClick={openRecordById}
          />
        </div>
      ) : (
        <div
          ref={tableScrollRef}
          className='@container no-scrollbar min-h-0 flex-1 overflow-auto rounded-xl border bg-card/40 shadow-xs'
        >
          <DndContext
            id={sortableId}
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <Table
              containerClassName={cn('overflow-x-visible', isEmpty && 'h-full')}
              className={cn('min-w-full', isEmpty && 'h-full')}
              style={{ width: table.getTotalSize() }}
            >
              <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md [&_th]:h-11 [&_th]:font-medium [&_th]:text-muted-foreground [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider'>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const id = header.column.id
                      const left = stickyLeftFor(id, primaryKey)
                      const isData = !['drag', 'select', 'actions'].includes(id)
                      return (
                        <TableHead
                          key={header.id}
                          colSpan={header.colSpan}
                          style={cellStyle(header.getSize(), left)}
                          className={cn(left != null && 'bg-card')}
                        >
                          {header.isPlaceholder ? null : isData ? (
                            <HeaderMenu column={header.column} />
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, rowIndex) => (
                    <TableRow
                      key={`skeleton-${rowIndex}`}
                      className='hover:bg-transparent'
                    >
                      {visibleLeafColumns.map((column) => {
                        const left = stickyLeftFor(column.id, primaryKey)
                        return (
                          <TableCell
                            key={column.id}
                            style={cellStyle(column.getSize(), left)}
                            className={cn(left != null && 'bg-card')}
                          >
                            <Skeleton
                              className='h-4 rounded'
                              style={{
                                width: `${45 + ((rowIndex * 13) % 45)}%`,
                              }}
                            />
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))
                ) : table.getRowModel().rows.length ? (
                  <>
                    <SortableContext
                      items={dataIds}
                      strategy={verticalListSortingStrategy}
                    >
                      {table.getRowModel().rows.map((row) => (
                        <DraggableRow
                          key={row.id}
                          row={row}
                          onDelete={removeRow}
                          canDelete={canDelete}
                          primaryKey={primaryKey}
                        />
                      ))}
                    </SortableContext>
                    {disableInlineCreate ? null : (
                      <TableRow className='hover:bg-transparent'>
                        <TableCell
                          colSpan={visibleLeafColumns.length}
                          className='p-0'
                        >
                          <div className='sticky left-0 w-fit'>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='m-1 text-muted-foreground'
                              onClick={addRow}
                            >
                              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                              Adicionar novo
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ) : (
                  <TableRow className='hover:bg-transparent'>
                    <TableCell
                      colSpan={visibleLeafColumns.length}
                      className='h-full p-0'
                    >
                      <div className='sticky left-0 flex h-full min-h-48 w-[100cqw] flex-col items-center justify-center gap-3 py-16 text-center'>
                        <div className='flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/40 text-muted-foreground'>
                          <SteelIcon
                            icon={InboxIcon}
                            strokeWidth={1.8}
                            className='size-5'
                          />
                        </div>
                        <div className='space-y-0.5'>
                          <p className='font-medium text-sm'>
                            Nada por aqui ainda
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            Crie o primeiro registro ou ajuste os filtros.
                          </p>
                        </div>
                        {disableInlineCreate ? null : (
                          <Button size='sm' className='mt-1' onClick={addRow}>
                            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                            {newRecordLabel(createTitle)}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {!isLoading && table.getRowModel().rows.length ? (
                <TableFooter className='sticky bottom-0 z-10 border-t bg-card/85 backdrop-blur-md'>
                  <TableRow className='hover:bg-transparent'>
                    {visibleLeafColumns.map((column) => {
                      const left = stickyLeftFor(column.id, primaryKey)
                      const style = cellStyle(column.getSize(), left)
                      return typeof column.accessorFn !== 'undefined' ? (
                        <TableCell
                          key={column.id}
                          className={cn('p-0', left != null && 'bg-card')}
                          style={style}
                        >
                          <CalcFooterCell
                            column={column}
                            rows={filteredRows}
                            value={calc[column.id] ?? 'none'}
                            onChange={(next) =>
                              setCalc((prev) => ({
                                ...prev,
                                [column.id]: next,
                              }))
                            }
                          />
                        </TableCell>
                      ) : (
                        <TableCell
                          key={column.id}
                          style={style}
                          className={cn(left != null && 'bg-card')}
                        />
                      )
                    })}
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </DndContext>
        </div>
      )}

      {/* Pagination */}
      {viewMode === 'kanban' && kanban ? null : (
        <div className='flex shrink-0 items-center justify-between gap-4'>
          <div className='hidden text-muted-foreground text-sm lg:block'>
            <span className='font-medium text-foreground tabular-nums'>
              {table.getFilteredSelectedRowModel().rows.length}
            </span>{' '}
            de{' '}
            <span className='tabular-nums'>
              {table.getFilteredRowModel().rows.length}
            </span>{' '}
            linha(s) selecionada(s).
          </div>
          <div className='flex items-center gap-6'>
            <div className='flex items-center gap-2'>
              <span className='text-sm'>Linhas por página</span>
              <Select
                value={`${pagination.pageSize}`}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger size='sm' className='w-18'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 50].map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className='text-sm'>
              Página {pagination.pageIndex + 1} de {table.getPageCount() || 1}
            </span>
            <div className='flex items-center gap-1'>
              <Button
                variant='outline'
                size='icon-sm'
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className='sr-only'>Primeira página</span>
                <SteelIcon icon={ArrowLeftDoubleIcon} strokeWidth={2} />
              </Button>
              <Button
                variant='outline'
                size='icon-sm'
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className='sr-only'>Página anterior</span>
                <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
              </Button>
              <Button
                variant='outline'
                size='icon-sm'
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className='sr-only'>Próxima página</span>
                <SteelIcon icon={ArrowRight01Icon} strokeWidth={2} />
              </Button>
              <Button
                variant='outline'
                size='icon-sm'
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className='sr-only'>Última página</span>
                <SteelIcon icon={ArrowRightDoubleIcon} strokeWidth={2} />
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={deleteIds !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteIds(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteIds && deleteIds.length > 1
                ? `Excluir ${deleteIds.length} registros?`
                : 'Excluir o registro?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => {
                for (const id of deleteIds ?? []) removeRow(id)
                table.resetRowSelection()
                setDeleteIds(null)
              }}
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Painel lateral de detalhes/edição do registro */}
      {openRecord ? (
        <RecordPanel
          key={openRecord.id}
          open
          onOpenChange={(next) => {
            if (!next) setOpenRecordId(null)
          }}
          record={openRecord}
          columns={columns}
          workspaceId={workspaceId}
          slug={slug}
          resource={resource}
          title={createTitle}
          lookups={lookups}
          renderExtra={renderRecordExtra}
          canDelete={canDelete}
          onSaved={(updated) =>
            setRows((cur) =>
              cur.map((row) => (row.id === updated.id ? updated : row)),
            )
          }
          onDeleted={(id) =>
            setRows((cur) => cur.filter((row) => row.id !== id))
          }
        />
      ) : null}
    </div>
  )
}
