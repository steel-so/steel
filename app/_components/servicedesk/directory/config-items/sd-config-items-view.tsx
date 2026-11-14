'use client'

import {
  PlusSignIcon,
  Settings02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import {
  SD_CI_STATUS_LABEL,
  SD_CI_STATUS_TONE,
  SD_RISK_LABEL,
  SD_RISK_TONE,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-labels'
import {
  SdPill,
  SdWarrantyBadge,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-widgets'
import { SdCustomerPicker } from '@/app/_components/servicedesk/pickers'
import {
  type SdColumn,
  SdDataTable,
  SdFilterField,
  SdFilterSelect,
} from '@/app/_components/servicedesk/table/sd-data-table'
import { useSdTableState } from '@/app/_components/servicedesk/table/use-sd-table-state'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  type SdConfigItemsQuery,
  useSdConfigItems,
  useSdConfigItemTypes,
} from '@/src/hooks/use-sd-config-items'
import type {
  SdConfigItemDTO,
  SdConfigItemStatusDTO,
  SdRiskLevelDTO,
} from '@/types/sd-config-item'
import { SdConfigItemDetailSheet } from './sd-config-item-detail-sheet'
import { SdConfigItemFormSheet } from './sd-config-item-form-sheet'
import { SdConfigItemTypesDialog } from './sd-config-item-types-dialog'

const COLUMNS: SdColumn<SdConfigItemDTO>[] = [
  {
    id: 'name',
    header: 'Nome',
    sortKey: 'name',
    hideable: false,
    cell: (i) => (
      <div className='flex min-w-44 flex-col'>
        <span className='font-medium'>{i.name}</span>
        {i.parent ? (
          <span className='text-muted-foreground text-xs'>
            em {i.parent.name}
          </span>
        ) : null}
      </div>
    ),
  },
  {
    id: 'code',
    header: 'Código',
    sortKey: 'code',
    cell: (i) =>
      i.code ? (
        <span className='font-mono text-xs'>{i.code}</span>
      ) : (
        <span className='text-muted-foreground'>—</span>
      ),
  },
  {
    id: 'type',
    header: 'Tipo',
    cell: (i) =>
      i.type ? (
        <span className='inline-flex items-center gap-1.5'>
          <span
            className='size-2 rounded-full'
            style={{ backgroundColor: i.type.color ?? 'currentColor' }}
          />
          {i.type.name}
        </span>
      ) : (
        <span className='text-muted-foreground'>—</span>
      ),
  },
  {
    id: 'status',
    header: 'Status',
    sortKey: 'status',
    cell: (i) => (
      <SdPill className={SD_CI_STATUS_TONE[i.status]}>
        {SD_CI_STATUS_LABEL[i.status]}
      </SdPill>
    ),
  },
  {
    id: 'criticality',
    header: 'Criticidade',
    sortKey: 'criticality',
    cell: (i) => (
      <SdPill className={SD_RISK_TONE[i.criticality]}>
        {SD_RISK_LABEL[i.criticality]}
      </SdPill>
    ),
  },
  {
    id: 'customer',
    header: 'Cliente',
    cell: (i) =>
      i.customer?.name ?? <span className='text-muted-foreground'>—</span>,
  },
  {
    id: 'department',
    header: 'Departamento',
    defaultHidden: true,
    cell: (i) =>
      i.department?.name ?? <span className='text-muted-foreground'>—</span>,
  },
  {
    id: 'owner',
    header: 'Responsável',
    defaultHidden: true,
    cell: (i) =>
      i.owner?.name ?? <span className='text-muted-foreground'>—</span>,
  },
  {
    id: 'model',
    header: 'Fabricante/modelo',
    defaultHidden: true,
    cell: (i) =>
      [i.manufacturer, i.model].filter(Boolean).join(' ') || (
        <span className='text-muted-foreground'>—</span>
      ),
  },
  {
    id: 'serial',
    header: 'Nº de série',
    defaultHidden: true,
    cell: (i) =>
      i.serialNumber ? (
        <span className='font-mono text-xs'>{i.serialNumber}</span>
      ) : (
        <span className='text-muted-foreground'>—</span>
      ),
  },
  {
    id: 'ip',
    header: 'IP',
    defaultHidden: true,
    cell: (i) =>
      i.ipAddress ? (
        <span className='font-mono text-xs'>{i.ipAddress}</span>
      ) : (
        <span className='text-muted-foreground'>—</span>
      ),
  },
  {
    id: 'location',
    header: 'Localização',
    cell: (i) => i.location ?? <span className='text-muted-foreground'>—</span>,
  },
  {
    id: 'warranty',
    header: 'Garantia',
    sortKey: 'warrantyUntil',
    cell: (i) => <SdWarrantyBadge until={i.warrantyUntil} />,
  },
]

const STATUS_OPTIONS = Object.entries(SD_CI_STATUS_LABEL).map(
  ([value, label]) => ({ value: value as SdConfigItemStatusDTO, label }),
)
const RISK_OPTIONS = Object.entries(SD_RISK_LABEL).map(([value, label]) => ({
  value: value as SdRiskLevelDTO,
  label,
}))
const WARRANTY_OPTIONS = [
  { value: '0', label: 'Vence hoje' },
  { value: '30', label: 'Nos próximos 30 dias' },
  { value: '60', label: 'Nos próximos 60 dias' },
  { value: '90', label: 'Nos próximos 90 dias' },
]

export function SdConfigItemsView({
  workspaceId,
  slug,
  canManageTypes,
}: {
  workspaceId: string
  slug: string
  /** Admin do ServiceDesk: mostra "Tipos de item". */
  canManageTypes: boolean
}) {
  const { data: types = [] } = useSdConfigItemTypes(workspaceId)
  const table = useSdTableState({
    sort: 'name',
    filters: {
      typeId: '',
      status: '' as SdConfigItemStatusDTO | '',
      criticality: '' as SdRiskLevelDTO | '',
      warranty: '',
      customerId: '',
      customerLabel: '',
    },
  })
  const query: SdConfigItemsQuery = {
    q: table.q,
    page: table.page,
    pageSize: table.pageSize,
    sort: table.sort as SdConfigItemsQuery['sort'],
    order: table.order,
    typeId: table.filters.typeId || undefined,
    status: table.filters.status || undefined,
    criticality: table.filters.criticality || undefined,
    customerId: table.filters.customerId || undefined,
    warrantyExpiringInDays: table.filters.warranty
      ? Number(table.filters.warranty)
      : undefined,
  }
  const { data, isLoading, error } = useSdConfigItems(workspaceId, query)
  const [detailId, setDetailId] = useState<string | null>(null)
  // Deep link (`?record=<id>`, e.g. from the global search): opens it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('record')
    if (id) setDetailId(id)
  }, [])
  const [typesOpen, setTypesOpen] = useState(false)
  const [form, setForm] = useState<{
    open: boolean
    item: SdConfigItemDTO | null
    parent: { id: string; label: string } | null
  }>({ open: false, item: null, parent: null })

  const createButton = (
    <Button
      size='sm'
      data-tour='sd-ci-new'
      onClick={() => setForm({ open: true, item: null, parent: null })}
    >
      <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
      Novo item
    </Button>
  )

  return (
    <>
      <SdDataTable
        storageKey='config-items'
        columns={COLUMNS}
        rows={data?.items ?? []}
        total={data?.total ?? 0}
        page={table.page}
        pageSize={table.pageSize}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        sort={table.sort}
        order={table.order}
        onSortChange={table.setSort}
        search={table.search}
        onSearchChange={table.setSearch}
        searchPlaceholder='Nome, código, série, modelo, IP…'
        isLoading={isLoading}
        error={error ? error.message : null}
        onRowClick={(row) => setDetailId(row.id)}
        activeFilterCount={
          table.activeFilterCount - (table.filters.customerLabel ? 1 : 0)
        }
        onClearFilters={table.clearFilters}
        filters={
          <>
            <SdFilterField label='Tipo'>
              <SdFilterSelect
                value={table.filters.typeId}
                onChange={(v) => table.setFilter('typeId', v)}
                options={types.map((t) => ({ value: t.id, label: t.name }))}
              />
            </SdFilterField>
            <SdFilterField label='Status'>
              <SdFilterSelect
                value={table.filters.status}
                onChange={(v) => table.setFilter('status', v)}
                options={STATUS_OPTIONS}
              />
            </SdFilterField>
            <SdFilterField label='Criticidade'>
              <SdFilterSelect
                value={table.filters.criticality}
                onChange={(v) => table.setFilter('criticality', v)}
                options={RISK_OPTIONS}
                allLabel='Todas'
              />
            </SdFilterField>
            <SdFilterField label='Garantia vencendo'>
              <SdFilterSelect
                value={table.filters.warranty}
                onChange={(v) => table.setFilter('warranty', v)}
                options={WARRANTY_OPTIONS}
                allLabel='Qualquer'
              />
            </SdFilterField>
            <SdFilterField label='Cliente ou empresa'>
              <SdCustomerPicker
                workspaceId={workspaceId}
                value={table.filters.customerId || null}
                selectedLabel={table.filters.customerLabel || null}
                allowCreate={false}
                placeholder='Todos'
                onChange={(option) => {
                  table.setFilter('customerId', option?.id ?? '')
                  table.setFilter('customerLabel', option?.label ?? '')
                }}
              />
            </SdFilterField>
          </>
        }
        actions={
          <>
            {canManageTypes ? (
              <Button
                size='sm'
                variant='outline'
                data-tour='sd-ci-types'
                onClick={() => setTypesOpen(true)}
              >
                <SteelIcon icon={Settings02Icon} strokeWidth={2} />
                Tipos de item
              </Button>
            ) : null}
            {createButton}
          </>
        }
        emptyTitle='Nenhum item de configuração'
        emptyDescription='Cadastre servidores, notebooks, links, licenças… ou ajuste a busca e os filtros.'
        emptyAction={createButton}
      />

      <SdConfigItemDetailSheet
        workspaceId={workspaceId}
        slug={slug}
        itemId={detailId}
        onNavigate={setDetailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
        onEdit={(item) => setForm({ open: true, item, parent: null })}
        onAddChild={(parent) => setForm({ open: true, item: null, parent })}
      />

      <SdConfigItemFormSheet
        workspaceId={workspaceId}
        open={form.open}
        item={form.item}
        defaultParent={form.parent}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        onSaved={(saved) => {
          if (!form.item) setDetailId(saved.id)
        }}
      />

      {canManageTypes ? (
        <SdConfigItemTypesDialog
          workspaceId={workspaceId}
          open={typesOpen}
          onOpenChange={setTypesOpen}
        />
      ) : null}
    </>
  )
}
