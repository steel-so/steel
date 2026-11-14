'use client'

import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  FilterIcon,
  InboxIcon,
  LayoutTable01Icon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * Tabela do ServiceDesk paginada no servidor: busca, filtros (slot),
 * visibilidade de colunas (lembrada por navegador), ordenação por coluna e
 * paginação. Reusável pelas telas de cadastros e pelas listas de chamados.
 */

export interface SdColumn<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** Campo de ordenação no servidor; sem ele a coluna não ordena. */
  sortKey?: string
  /** Colunas fixas não aparecem no menu de visibilidade. */
  hideable?: boolean
  defaultHidden?: boolean
  className?: string
  /** Conteúdo do cabeçalho no lugar do texto (ex.: "selecionar todos"). */
  headerContent?: ReactNode
}

export interface SdDataTableProps<T extends { id: string }> {
  /** Chave para lembrar as colunas visíveis (localStorage). */
  storageKey: string
  columns: SdColumn<T>[]
  rows: T[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  sort?: string
  order?: 'asc' | 'desc'
  onSortChange?: (sort: string, order: 'asc' | 'desc') => void
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  /** Campos de filtro (renderizados no popover "Filtrar"). */
  filters?: ReactNode
  activeFilterCount?: number
  onClearFilters?: () => void
  /** Botões à direita da barra (ex.: "Novo cliente"). */
  actions?: ReactNode
  isLoading?: boolean
  error?: string | null
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  /** Esconde a barra (busca/filtros/colunas) — quem usa tem a própria. */
  hideToolbar?: boolean
  /** Colunas ocultas controladas por quem usa (sem localStorage). */
  hiddenColumns?: string[]
  rowClassName?: (row: T) => string | undefined
  /** Page of the row, for J/K + Enter/O and the ticket's J/K (shortcuts). */
  rowHref?: (row: T) => string
}

const PAGE_SIZES = [10, 25, 50, 100]

function readHidden(storageKey: string, fallback: string[]): string[] {
  try {
    const raw = window.localStorage.getItem(`sd-table:${storageKey}`)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function SdDataTable<T extends { id: string }>({
  storageKey,
  columns,
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sort,
  order = 'asc',
  onSortChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Buscar…',
  filters,
  activeFilterCount = 0,
  onClearFilters,
  actions,
  isLoading,
  error,
  onRowClick,
  emptyTitle = 'Nada por aqui ainda',
  emptyDescription = 'Crie o primeiro registro ou ajuste a busca e os filtros.',
  emptyAction,
  hideToolbar,
  hiddenColumns,
  rowClassName,
  rowHref,
}: SdDataTableProps<T>) {
  const defaultHidden = useMemo(
    () => columns.filter((c) => c.defaultHidden).map((c) => c.id),
    [columns],
  )
  const [hidden, setHidden] = useState<string[]>(defaultHidden)

  // Preferência salva só existe no navegador: lê depois de montar.
  useEffect(() => {
    setHidden(readHidden(storageKey, defaultHidden))
  }, [storageKey, defaultHidden])

  function toggleColumn(id: string, visible: boolean) {
    setHidden((current) => {
      const next = visible ? current.filter((c) => c !== id) : [...current, id]
      try {
        window.localStorage.setItem(
          `sd-table:${storageKey}`,
          JSON.stringify(next),
        )
      } catch {
        // Sem storage (aba anônima): a escolha vale só nesta sessão.
      }
      return next
    })
  }

  const effectiveHidden = hiddenColumns ?? hidden
  const visible = columns.filter((c) => !effectiveHidden.includes(c.id))
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  function handleSort(column: SdColumn<T>) {
    if (!column.sortKey || !onSortChange) return
    if (sort === column.sortKey) {
      onSortChange(column.sortKey, order === 'asc' ? 'desc' : 'asc')
    } else {
      onSortChange(column.sortKey, 'asc')
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 p-4'>
      <div
        className={cn(
          'flex shrink-0 flex-wrap items-center gap-2',
          hideToolbar && 'hidden',
        )}
      >
        <div className='relative mr-auto'>
          <SteelIcon
            icon={Search01Icon}
            strokeWidth={2}
            className='-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground'
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label='Buscar'
            data-tour='sd-table-search'
            className='h-8 w-64 pl-8'
          />
        </div>

        {filters ? (
          <Popover>
            <PopoverTrigger
              render={
                <Button variant='outline' size='sm' data-tour='sd-table-filter'>
                  <SteelIcon icon={FilterIcon} strokeWidth={2} />
                  Filtrar
                  {activeFilterCount > 0 ? (
                    <span className='ml-1 rounded bg-primary px-1 text-primary-foreground text-xs tabular-nums'>
                      {activeFilterCount}
                    </span>
                  ) : null}
                </Button>
              }
            />
            <PopoverContent align='end' className='w-72 gap-3 p-3'>
              <div className='flex flex-col gap-3'>{filters}</div>
              {onClearFilters && activeFilterCount > 0 ? (
                <Button
                  variant='ghost'
                  size='sm'
                  className='self-start'
                  onClick={onClearFilters}
                >
                  <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                  Limpar filtros
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant='outline' size='sm' data-tour='sd-table-columns'>
                <SteelIcon icon={LayoutTable01Icon} strokeWidth={2} />
                Colunas
              </Button>
            }
          />
          <DropdownMenuContent align='end' className='w-52'>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns
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

        {actions}
      </div>

      <div className='no-scrollbar min-h-0 flex-1 overflow-auto rounded-xl border bg-card/40 shadow-xs'>
        <Table className='min-w-full'>
          <TableHeader className='sticky top-0 z-10 bg-card [&_th]:h-11 [&_th]:font-medium [&_th]:text-muted-foreground [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider'>
            <TableRow>
              {visible.map((column) => {
                const active = column.sortKey && sort === column.sortKey
                return (
                  <TableHead key={column.id} className={column.className}>
                    {column.headerContent ? (
                      column.headerContent
                    ) : column.sortKey && onSortChange ? (
                      <button
                        type='button'
                        onClick={() => handleSort(column)}
                        className='-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase hover:text-foreground'
                        aria-label={`Ordenar por ${column.header}`}
                      >
                        {column.header}
                        <SteelIcon
                          icon={
                            active
                              ? order === 'asc'
                                ? ArrowUp01Icon
                                : ArrowDown01Icon
                              : ArrowUpDownIcon
                          }
                          strokeWidth={2}
                          className={cn(
                            'size-3.5',
                            !active && 'text-muted-foreground/60',
                          )}
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow
                  key={`skeleton-${i}`}
                  className='hover:bg-transparent'
                >
                  {visible.map((column) => (
                    <TableCell key={column.id}>
                      <Skeleton className='h-4 w-full max-w-40' />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow className='hover:bg-transparent'>
                <TableCell colSpan={visible.length} className='py-16'>
                  <p className='text-center text-destructive text-sm'>
                    {error}
                  </p>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow className='hover:bg-transparent'>
                <TableCell colSpan={visible.length} className='p-0'>
                  <div className='flex min-h-48 flex-col items-center justify-center gap-3 py-16 text-center'>
                    <div className='flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/40 text-muted-foreground'>
                      <SteelIcon
                        icon={InboxIcon}
                        strokeWidth={1.8}
                        className='size-5'
                      />
                    </div>
                    <div className='space-y-0.5'>
                      <p className='font-medium text-sm'>{emptyTitle}</p>
                      <p className='text-muted-foreground text-xs'>
                        {emptyDescription}
                      </p>
                    </div>
                    {emptyAction}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-shortcut-row={row.id}
                  data-shortcut-href={rowHref?.(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (
                            event.key === 'Enter' &&
                            event.target === event.currentTarget
                          ) {
                            event.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    onRowClick &&
                      'cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                    rowClassName?.(row),
                  )}
                >
                  {visible.map((column) => (
                    <TableCell key={column.id} className={column.className}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className='flex shrink-0 flex-wrap items-center justify-between gap-4'>
        <p className='text-muted-foreground text-sm tabular-nums'>
          {total === 0
            ? 'Nenhum registro'
            : `${from}–${to} de ${total} registro${total === 1 ? '' : 's'}`}
        </p>
        <div className='flex items-center gap-6'>
          <div className='flex items-center gap-2'>
            <span className='text-sm'>Linhas por página</span>
            <Select
              value={`${pageSize}`}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger size='sm' className='w-18'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className='text-sm tabular-nums'>
            Página {page} de {pageCount}
          </span>
          <div className='flex items-center gap-1'>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
            >
              <span className='sr-only'>Primeira página</span>
              <SteelIcon icon={ArrowLeftDoubleIcon} strokeWidth={2} />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              <span className='sr-only'>Página anterior</span>
              <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pageCount}
            >
              <span className='sr-only'>Próxima página</span>
              <SteelIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              onClick={() => onPageChange(pageCount)}
              disabled={page >= pageCount}
            >
              <span className='sr-only'>Última página</span>
              <SteelIcon icon={ArrowRightDoubleIcon} strokeWidth={2} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Campo de filtro com rótulo (para o slot `filters`). */
export function SdFilterField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <span className='font-medium text-muted-foreground text-xs'>{label}</span>
      {children}
    </div>
  )
}

/** Select de filtro com opção "Todos" (valor `''`). */
export function SdFilterSelect<V extends string>({
  value,
  onChange,
  options,
  allLabel = 'Todos',
}: {
  value: V | ''
  onChange: (value: V | '') => void
  options: { value: V; label: string }[]
  allLabel?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <Select
      value={value || '__all'}
      onValueChange={(v) => onChange(v === '__all' ? '' : (v as V))}
    >
      <SelectTrigger size='sm' className='w-full'>
        <span>{current?.label ?? allLabel}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='__all'>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
