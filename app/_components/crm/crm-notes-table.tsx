'use client'

import { useMemo } from 'react'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type { CrmNoteDTO } from '@/types/crm-note'

const LOOKUP_KINDS: LookupKind[] = [
  'companies',
  'people',
  'opportunities',
  'users',
]

const COLUMNS: GridColumn[] = [
  {
    key: 'title',
    header: 'Título',
    kind: 'text',
    primary: true,
    placeholder: 'Reunião de kickoff',
  },
  {
    key: 'body',
    header: 'Conteúdo',
    kind: 'richtext',
    placeholder: 'Resumo…',
  },
  {
    key: 'companyId',
    header: 'Empresa',
    kind: 'relation',
    relationKind: 'companies',
    clearable: true,
  },
  {
    key: 'personId',
    header: 'Pessoa',
    kind: 'relation',
    relationKind: 'people',
    clearable: true,
  },
  {
    key: 'opportunityId',
    header: 'Oportunidade',
    kind: 'relation',
    relationKind: 'opportunities',
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

export function CrmNotesTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const list = useCrmResourceList<CrmNoteDTO>(workspaceId, 'notes')
  const { items, isLoading, error, refetch } = list
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const columns = useMemo(() => COLUMNS, [])

  return (
    <DataTable
      columns={columns}
      data={items}
      workspaceId={workspaceId}
      slug={slug}
      resource='notes'
      createTitle='nota'
      lookups={lookups}
      isLoading={isLoading}
      error={error}
      searchPlaceholder='Buscar notas…'
      refetch={refetch}
    />
  )
}
