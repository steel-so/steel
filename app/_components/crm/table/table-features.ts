import {
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import type { Lookups } from '@/src/hooks/use-crm-workspace-lookups'

/** Per-column meta of the CRM grid. */
export interface CrmGridColumnMeta {
  /** Declarative column kind: decides the footer calculation options. */
  kind?: GridColumn['kind']
}

/** Table meta: context of the editable CRM grid (inline auto-save). */
export interface CrmGridTableMeta {
  grid?: {
    slug: string
    workspaceId: string
    /** Route resource (e.g. "companies"), used for the record view links. */
    resource: string
    lookups: Lookups
    /** Partial PATCH of one field of an existing row. */
    patch: (id: string, patch: Record<string, unknown>) => void
    /** Opens the record details/edit side panel. */
    openRecord: (id: string) => void
    /** Id of the row just created: its primary field starts in edit mode. */
    newRowId: string | null
  }
}

/**
 * TanStack Table v9 features of the CRM grid: client-side filtering (per
 * column and global search), sorting, pagination, row selection, column
 * visibility and sizes. Only the sort/filter functions the grid resolves by
 * name are registered: `includesString` for filters, and the ones the
 * `auto` sort picks for strings and dates (numbers fall back to `basic`).
 */
export const crmTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    datetime: sortFn_datetime,
  },
  tableMeta: metaHelper<CrmGridTableMeta>(),
  columnMeta: metaHelper<CrmGridColumnMeta>(),
})

export type CrmTableFeatures = typeof crmTableFeatures
