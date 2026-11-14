'use client'

import { useMemo } from 'react'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type { CrmDashboardDTO } from '@/types/crm-dashboard'

const LOOKUP_KINDS: LookupKind[] = ['users']

const COLUMNS: GridColumn[] = [
  {
    key: 'title',
    header: 'Título',
    kind: 'text',
    required: true,
    primary: true,
    linkView: true,
    placeholder: 'Painel sem título',
  },
  {
    key: 'createdById',
    header: 'Criado por',
    kind: 'relation',
    relationKind: 'users',
    readonly: true,
  },
  { key: 'createdAt', header: 'Data de criação', kind: 'readonly-date' },
  { key: 'updatedAt', header: 'Última atualização', kind: 'readonly-date' },
]

export function CrmDashboardsTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const list = useCrmResourceList<CrmDashboardDTO>(workspaceId, 'dashboards')
  const { items, isLoading, error, refetch } = list
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const columns = useMemo(() => COLUMNS, [])

  return (
    <DataTable
      columns={columns}
      data={items}
      workspaceId={workspaceId}
      slug={slug}
      resource='dashboards'
      createTitle='painel'
      lookups={lookups}
      isLoading={isLoading}
      error={error}
      searchPlaceholder='Buscar painéis…'
      refetch={refetch}
    />
  )
}
