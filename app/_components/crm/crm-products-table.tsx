'use client'

import { useMemo } from 'react'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type { CrmBillingTypeDTO, CrmProductDTO } from '@/types/crm-product'

const LOOKUP_KINDS: LookupKind[] = ['users']

const BILLING_TYPES: CrmBillingTypeDTO[] = ['ONE_TIME', 'MONTHLY', 'YEARLY']

const BILLING_LABELS: Record<CrmBillingTypeDTO, string> = {
  ONE_TIME: 'Único',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
}

const BILLING_STYLES: Record<CrmBillingTypeDTO, string> = {
  ONE_TIME: 'bg-slate-500/15 text-slate-600',
  MONTHLY: 'bg-blue-500/15 text-blue-600',
  YEARLY: 'bg-violet-500/15 text-violet-600',
}

const COLUMNS: GridColumn[] = [
  {
    key: 'name',
    header: 'Nome',
    kind: 'text',
    required: true,
    primary: true,
    placeholder: 'Plano Pro',
  },
  { key: 'sku', header: 'SKU', kind: 'text', placeholder: 'PRO-001' },
  { key: 'unitPrice', header: 'Preço', kind: 'money', placeholder: '199' },
  {
    key: 'billingType',
    header: 'Cobrança',
    kind: 'select',
    defaultValue: 'ONE_TIME',
    options: BILLING_TYPES.map((b) => ({ value: b, label: BILLING_LABELS[b] })),
    optionStyles: BILLING_STYLES,
  },
  {
    key: 'description',
    header: 'Descrição',
    kind: 'text',
    placeholder: 'Resumo do produto',
  },
  { key: 'active', header: 'Ativo', kind: 'boolean' },
  {
    key: 'createdById',
    header: 'Criado por',
    kind: 'relation',
    relationKind: 'users',
    readonly: true,
  },
  {
    key: 'updatedById',
    header: 'Atualizado por',
    kind: 'relation',
    relationKind: 'users',
    readonly: true,
  },
  { key: 'createdAt', header: 'Criado em', kind: 'readonly-date' },
  { key: 'updatedAt', header: 'Última atualização', kind: 'readonly-date' },
]

export function CrmProductsTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const list = useCrmResourceList<CrmProductDTO>(workspaceId, 'products')
  const { items, isLoading, error, refetch } = list
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)

  const columns = useMemo(() => COLUMNS, [])

  return (
    <DataTable
      columns={columns}
      data={items}
      workspaceId={workspaceId}
      slug={slug}
      resource='products'
      createTitle='produto'
      lookups={lookups}
      isLoading={isLoading}
      error={error}
      searchPlaceholder='Buscar produtos…'
      refetch={refetch}
    />
  )
}
