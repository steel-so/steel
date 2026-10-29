'use client'

import { useMemo, useState } from 'react'
import { CrmNlSearchBar } from '@/app/_components/crm/crm-nl-search-bar'
import { CrmOpportunityLineItems } from '@/app/_components/crm/crm-opportunity-line-items'
import { CrmRecordTimeline } from '@/app/_components/crm/crm-record-timeline'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import {
  customFieldColumns,
  useCrmCustomFields,
} from '@/src/hooks/use-crm-custom-field'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type { CrmNlSearchResultDTO } from '@/types/crm-nl-search'
import type { CrmOpportunityDTO } from '@/types/crm-opportunity'

const LOOKUP_KINDS: LookupKind[] = [
  'companies',
  'people',
  'users',
  'pipelines',
  'stages',
  'products',
]

const COLUMNS: GridColumn[] = [
  {
    key: 'name',
    header: 'Nome',
    kind: 'text',
    required: true,
    primary: true,
    placeholder: 'Renovação anual — Acme',
  },
  { key: 'amount', header: 'Valor', kind: 'money', placeholder: '50000' },
  {
    key: 'pipelineId',
    header: 'Funil',
    kind: 'relation',
    relationKind: 'pipelines',
  },
  {
    key: 'stageId',
    header: 'Etapa',
    kind: 'relation',
    relationKind: 'stages',
  },
  {
    key: 'probability',
    header: '% de fechamento',
    kind: 'number',
    placeholder: '20',
  },
  { key: 'closeDate', header: 'Data de fechamento', kind: 'date' },
  {
    key: 'companyId',
    header: 'Empresa',
    kind: 'relation',
    relationKind: 'companies',
    clearable: true,
  },
  {
    key: 'pointOfContactId',
    header: 'Ponto de contato',
    kind: 'relation',
    relationKind: 'people',
    clearable: true,
  },
  {
    key: 'ownerId',
    header: 'Responsável',
    kind: 'relation',
    relationKind: 'users',
    clearable: true,
  },
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

export function CrmOpportunitiesTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const { items, isLoading, refetch } = useCrmResourceList<CrmOpportunityDTO>(
    workspaceId,
    'opportunities',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const { data: customFields } = useCrmCustomFields(workspaceId, 'OPPORTUNITY')

  const columns = useMemo(
    () => [...COLUMNS, ...customFieldColumns(customFields ?? [])],
    [customFields],
  )
  const [nlResult, setNlResult] = useState<CrmNlSearchResultDTO | null>(null)
  const rows = useMemo(() => {
    const matched = nlResult
      ? new Set(nlResult.opportunities.map((opportunity) => opportunity.id))
      : null
    return items
      .filter((item) => !matched || matched.has(item.id))
      .map((item) => ({ ...item, ...(item.customFields ?? {}) }))
  }, [items, nlResult])

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <CrmNlSearchBar workspaceId={workspaceId} onResult={setNlResult} />
      <div className='min-h-0 flex-1'>
        <DataTable
          columns={columns}
          data={rows}
          workspaceId={workspaceId}
          slug={slug}
          resource='opportunities'
          createTitle='oportunidade'
          lookups={lookups}
          isLoading={isLoading}
          searchPlaceholder='Buscar oportunidades…'
          refetch={refetch}
          renderRecordExtra={(record) => (
            <div className='flex flex-col gap-5'>
              <CrmOpportunityLineItems
                workspaceId={workspaceId}
                opportunityId={record.id}
                productOptions={lookups.options.products}
                onChanged={refetch}
              />
              <CrmRecordTimeline
                workspaceId={workspaceId}
                opportunityId={record.id}
                userMap={lookups.maps.users}
              />
            </div>
          )}
        />
      </div>
    </div>
  )
}
