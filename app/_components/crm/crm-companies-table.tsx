'use client'

import { useMemo, useState } from 'react'
import { CnpjBulkDialog } from '@/app/_components/crm/cnpj/cnpj-bulk-dialog'
import { CompanyEnrichmentPanel } from '@/app/_components/crm/cnpj/company-enrichment-panel'
import { CrmNlSearchBar } from '@/app/_components/crm/crm-nl-search-bar'
import {
  applyNlResult,
  type CrmNlAnyResult,
} from '@/app/_components/crm/crm-nl-search-result'
import { CrmRecordTimeline } from '@/app/_components/crm/crm-record-timeline'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import {
  useCan,
  useIsPrivileged,
} from '@/app/_components/workspace/workspace-permissions'
import {
  customFieldColumns,
  useCrmCustomFields,
} from '@/src/hooks/use-crm-custom-field'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type { CrmCompanyDTO } from '@/types/crm-company'

const LOOKUP_KINDS: LookupKind[] = ['users']

const COLUMNS: GridColumn[] = [
  {
    key: 'cnpj',
    header: 'CNPJ',
    kind: 'cnpj',
    primary: true,
    placeholder: '00.000.000/0000-00',
  },
  {
    key: 'name',
    header: 'Nome',
    kind: 'text',
    required: true,
    placeholder: 'Acme Inc',
  },
  { key: 'domain', header: 'Domínio', kind: 'link', placeholder: 'acme.com' },
  {
    key: 'employees',
    header: 'Funcionários',
    kind: 'number',
    placeholder: '120',
  },
  {
    key: 'linkedin',
    header: 'LinkedIn',
    kind: 'link',
    placeholder: 'linkedin.com/company/acme',
  },
  { key: 'address', header: 'Endereço (CEP)', kind: 'address' },
  { key: 'arr', header: 'ARR', kind: 'money', placeholder: '250000' },
  { key: 'icp', header: 'ICP', kind: 'boolean' },
  {
    key: 'accountOwnerId',
    header: 'Responsável pela conta',
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

export function CrmCompaniesTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const { items, isLoading, refetch } = useCrmResourceList<CrmCompanyDTO>(
    workspaceId,
    'companies',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const { data: customFields } = useCrmCustomFields(workspaceId, 'COMPANY')
  const canEdit = useCan('companies', 'EDIT')
  const isPrivileged = useIsPrivileged()

  const columns = useMemo(
    () => [...COLUMNS, ...customFieldColumns(customFields ?? [])],
    [customFields],
  )
  // Achata `customFields.cf_<id>` para o topo do registro — as colunas
  // dinâmicas leem `row.original[col.key]` (`cf_<id>`) diretamente.
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
        entity='companies'
        onResult={setNlResult}
      />
      <div className='min-h-0 flex-1'>
        <DataTable
          columns={columns}
          data={rows}
          workspaceId={workspaceId}
          slug={slug}
          resource='companies'
          createTitle='empresa'
          lookups={lookups}
          isLoading={isLoading}
          searchPlaceholder='Buscar empresas…'
          refetch={refetch}
          headerExtra={
            isPrivileged ? (
              <CnpjBulkDialog workspaceId={workspaceId} onFinished={refetch} />
            ) : null
          }
          renderRecordExtra={(record) => (
            <div className='flex flex-col gap-4'>
              <CompanyEnrichmentPanel
                workspaceId={workspaceId}
                companyId={record.id}
                cnpj={record.cnpj}
                canEdit={canEdit}
                onApplied={refetch}
              />
              <CrmRecordTimeline
                workspaceId={workspaceId}
                companyId={record.id}
                userMap={lookups.maps.users}
              />
            </div>
          )}
        />
      </div>
    </div>
  )
}
