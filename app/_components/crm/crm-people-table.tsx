'use client'

import { useMemo, useState } from 'react'
import { CrmNlSearchBar } from '@/app/_components/crm/crm-nl-search-bar'
import {
  applyNlResult,
  type CrmNlAnyResult,
} from '@/app/_components/crm/crm-nl-search-result'
import { CrmRecordTimeline } from '@/app/_components/crm/crm-record-timeline'
import { CrmPersonNewslettersCard } from '@/app/_components/crm/newsletters/bridge/crm-person-newsletters-card'
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
import type { CrmPersonDTO } from '@/types/crm-person'

const LOOKUP_KINDS: LookupKind[] = ['companies', 'users']

const COLUMNS: GridColumn[] = [
  {
    key: 'name',
    header: 'Nome',
    kind: 'text',
    required: true,
    primary: true,
    placeholder: 'Ada Lovelace',
  },
  {
    key: 'emails',
    header: 'E-mails',
    kind: 'tags',
    placeholder: 'ada@acme.com, ada@gmail.com',
  },
  {
    key: 'phones',
    header: 'Telefones',
    kind: 'tags',
    placeholder: '+55 11 99999-0000',
  },
  { key: 'city', header: 'Cidade', kind: 'text', placeholder: 'Recife, PE' },
  {
    key: 'jobTitle',
    header: 'Cargo',
    kind: 'text',
    placeholder: 'Head of Sales',
  },
  {
    key: 'linkedin',
    header: 'LinkedIn',
    kind: 'link',
    placeholder: 'linkedin.com/in/adalovelace',
  },
  {
    key: 'companyId',
    header: 'Empresa',
    kind: 'relation',
    relationKind: 'companies',
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

export function CrmPeopleTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const { items, isLoading, refetch } = useCrmResourceList<CrmPersonDTO>(
    workspaceId,
    'people',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const { data: customFields } = useCrmCustomFields(workspaceId, 'PERSON')

  const columns = useMemo(
    () => [...COLUMNS, ...customFieldColumns(customFields ?? [])],
    [customFields],
  )
  const [nlResult, setNlResult] = useState<CrmNlAnyResult | null>(null)
  const rows = useMemo(
    () =>
      applyNlResult(items, nlResult).map((item) => ({
        ...item,
        ...(item.customFields ?? {}),
      })),
    [items, nlResult],
  )

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <CrmNlSearchBar
        workspaceId={workspaceId}
        entity='people'
        onResult={setNlResult}
      />
      <div className='min-h-0 flex-1'>
        <DataTable
          columns={columns}
          data={rows}
          workspaceId={workspaceId}
          slug={slug}
          resource='people'
          createTitle='pessoa'
          lookups={lookups}
          isLoading={isLoading}
          searchPlaceholder='Buscar pessoas…'
          refetch={refetch}
          renderRecordExtra={(record) => (
            <div className='flex flex-col gap-6'>
              <CrmPersonNewslettersCard
                workspaceId={workspaceId}
                personId={record.id}
              />
              <CrmRecordTimeline
                workspaceId={workspaceId}
                personId={record.id}
                userMap={lookups.maps.users}
              />
            </div>
          )}
        />
      </div>
    </div>
  )
}
