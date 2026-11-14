'use client'

import { useMemo } from 'react'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type { CrmTaskDTO, CrmTaskStatusDTO } from '@/types/crm-task'

const LOOKUP_KINDS: LookupKind[] = [
  'companies',
  'people',
  'opportunities',
  'users',
]

const TASK_STATUSES: CrmTaskStatusDTO[] = ['TODO', 'IN_PROGRESS', 'DONE']

const STATUS_STYLES: Record<CrmTaskStatusDTO, string> = {
  TODO: 'bg-slate-500/15 text-slate-600',
  IN_PROGRESS: 'bg-blue-500/15 text-blue-600',
  DONE: 'bg-emerald-500/15 text-emerald-600',
}

const STATUS_LABEL: Record<CrmTaskStatusDTO, string> = {
  TODO: 'A fazer',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluído',
}

const COLUMNS: GridColumn[] = [
  {
    key: 'title',
    header: 'Título',
    kind: 'text',
    required: true,
    primary: true,
    placeholder: 'Ligar para o cliente',
  },
  {
    key: 'status',
    header: 'Status',
    kind: 'select',
    defaultValue: 'TODO',
    options: TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
    optionStyles: STATUS_STYLES,
  },
  { key: 'dueDate', header: 'Prazo', kind: 'date' },
  {
    key: 'assigneeId',
    header: 'Responsável',
    kind: 'relation',
    relationKind: 'users',
    clearable: true,
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
    key: 'body',
    header: 'Conteúdo',
    kind: 'richtext',
    placeholder: 'Detalhes…',
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

export function CrmTasksTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const list = useCrmResourceList<CrmTaskDTO>(workspaceId, 'tasks')
  const { items, isLoading, error, refetch } = list
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const columns = useMemo(() => COLUMNS, [])

  return (
    <DataTable
      columns={columns}
      data={items}
      workspaceId={workspaceId}
      slug={slug}
      resource='tasks'
      createTitle='tarefa'
      lookups={lookups}
      isLoading={isLoading}
      error={error}
      searchPlaceholder='Buscar tarefas…'
      refetch={refetch}
      kanban={{
        groupByKey: 'status',
        columns: TASK_STATUSES.map((s) => ({
          value: s,
          label: STATUS_LABEL[s],
          className: STATUS_STYLES[s],
        })),
        renderCard: (record) => (
          <div className='flex flex-col gap-1'>
            <span className='truncate font-medium'>{record.title}</span>
            {record.dueDate ? (
              <span className='truncate text-muted-foreground text-xs'>
                {new Date(record.dueDate).toLocaleDateString('pt-BR')}
              </span>
            ) : null}
          </div>
        ),
      }}
    />
  )
}
