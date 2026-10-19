'use client'

import {
  ArrowDown01Icon,
  ArrowDownWideNarrowIcon,
  ArrowUpNarrowWideIcon,
  CheckIcon,
  EraserIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { CellData, Column, RowData } from '@tanstack/react-table'
import { SteelIcon } from '@/components/icon/icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { DataTableFeatures } from './data-table'

interface DataTableColumnHeaderProps<TData extends RowData, TValue extends CellData> {
  column: Column<DataTableFeatures, TData, TValue>
  title: string
  className?: string
  ascLabel?: string
  descLabel?: string
}

/** Column title that opens a sort menu (server-side sorting). */
export function DataTableColumnHeader<TData extends RowData, TValue extends CellData>({
  column,
  title,
  className,
  ascLabel = 'Crescente',
  descLabel = 'Decrescente',
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        {title}
      </div>
    )
  }

  const sorted = column.getIsSorted()
  const icon =
    sorted === 'desc'
      ? ArrowUpNarrowWideIcon
      : sorted === 'asc'
        ? ArrowDownWideNarrowIcon
        : ArrowDown01Icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex w-full items-center justify-between gap-2 text-muted-foreground hover:text-primary',
          className,
        )}
      >
        <span>{title}</span>
        <SteelIcon icon={icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-full min-w-48'>
        <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
          <SteelIcon icon={ArrowDownWideNarrowIcon} strokeWidth={2} />
          {ascLabel}
          {sorted === 'asc' && (
            <SteelIcon icon={CheckIcon} strokeWidth={2} className='ml-auto' />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
          <SteelIcon icon={ArrowUpNarrowWideIcon} strokeWidth={2} />
          {descLabel}
          {sorted === 'desc' && (
            <SteelIcon icon={CheckIcon} strokeWidth={2} className='ml-auto' />
          )}
        </DropdownMenuItem>
        {sorted && (
          <DropdownMenuItem onClick={() => column.clearSorting()}>
            <SteelIcon icon={EraserIcon} strokeWidth={2} />
            Remover ordenação
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
