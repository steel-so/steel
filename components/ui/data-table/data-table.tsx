'use client'

import {
  type ColumnDef,
  flexRender,
  metaHelper,
  type OnChangeFn,
  columnVisibilityFeature,
  type RowData,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Muted } from '@/components/typography/text/muted'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  type DataTableItemLabel,
  DataTablePagination,
} from './data-table-pagination'

/** Optional `meta: { className }` on a column styles its header and cells. */
interface DataTableColumnMeta {
  className?: string
}

/**
 * Features of the shared server-driven table: sorting state only. The rows
 * come already sorted and paged from the API, and the pager below the table
 * is driven by the parent's `page`, not by table state. Column
 * definitions for `DataTable` are `ColumnDef<DataTableFeatures, TData>`.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  // `row.getVisibleCells()` lives in the visibility feature.
  columnVisibilityFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
})

export type DataTableFeatures = typeof dataTableFeatures

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<DataTableFeatures, TData>[]
  data: TData[]
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  isLoading?: boolean
  loadingMessage?: string
  emptyMessage?: string
  itemLabel?: DataTableItemLabel
}

function columnClassName<TData extends RowData>(
  column: ColumnDef<DataTableFeatures, TData>,
): string | undefined {
  return column.meta?.className
}

/**
 * Server-driven table (sorting and pagination happen in the API): the parent
 * owns `sorting` and `page` and refetches when they change.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  sorting,
  onSortingChange,
  page,
  pageSize,
  total,
  onPageChange,
  isLoading,
  loadingMessage = 'Carregando...',
  emptyMessage = 'Nenhum resultado encontrado.',
  itemLabel,
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
  })

  return (
    <div className='flex flex-col gap-3'>
      <div className='rounded-md border'>
        <Table>
          <TableHeader className='sticky top-0 z-10 bg-background'>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={columnClassName(header.column.columnDef)}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center'
                >
                  <Muted>{loadingMessage}</Muted>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={columnClassName(cell.column.columnDef)}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center'
                >
                  <Muted>{emptyMessage}</Muted>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        itemLabel={itemLabel}
      />
    </div>
  )
}
