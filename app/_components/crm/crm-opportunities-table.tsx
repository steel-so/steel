'use client'

import { useMemo, useState } from 'react'
import { CrmNlSearchBar } from '@/app/_components/crm/crm-nl-search-bar'
import {
  applyNlResult,
  type CrmNlAnyResult,
} from '@/app/_components/crm/crm-nl-search-result'
import { CrmOpportunityLineItems } from '@/app/_components/crm/crm-opportunity-line-items'
import { CrmRecordTimeline } from '@/app/_components/crm/crm-record-timeline'
import { DealRoomPanel } from '@/app/_components/crm/deals/deal-room-panel'
import { OpportunityHealthPanel } from '@/app/_components/crm/health/health-panel'
import {
  HealthBadge,
  HealthNextAction,
} from '@/app/_components/crm/health/health-parts'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  customFieldColumns,
  useCrmCustomFields,
} from '@/src/hooks/use-crm-custom-field'
import { useCrmOpportunityHealthMap } from '@/src/hooks/use-crm-health'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import { useCrmPipelineStages } from '@/src/hooks/use-crm-stage-columns'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
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

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

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
  const [nlResult, setNlResult] = useState<CrmNlAnyResult | null>(null)
  const canEdit = useCan('opportunities', 'EDIT')
  const health = useCrmOpportunityHealthMap(workspaceId)
  const pipelines = useCrmPipelineStages(workspaceId)
  const [pipelineChoice, setPipelineChoice] = useState<string | null>(null)
  // Kanban shows one funnel at a time: dragging only changes the stage, and a
  // stage belongs to a single funnel.
  const kanbanPipeline =
    pipelines.data?.find((pipeline) => pipeline.id === pipelineChoice) ??
    pipelines.data?.[0] ??
    null
  const kanbanColumns = useMemo(
    () =>
      (kanbanPipeline?.stages ?? []).map((stage) => ({
        value: stage.id,
        label: stage.name,
      })),
    [kanbanPipeline],
  )
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
          headerExtra={
            (pipelines.data?.length ?? 0) > 1 && kanbanPipeline ? (
              <Select
                items={pipelines.data?.map((pipeline) => ({
                  value: pipeline.id,
                  label: pipeline.name,
                }))}
                value={kanbanPipeline.id}
                onValueChange={(value) => setPipelineChoice(value as string)}
              >
                <SelectTrigger
                  aria-label='Funil do kanban'
                  className='h-8 w-44'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.data?.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null
          }
          kanban={
            kanbanColumns.length > 0
              ? {
                  groupByKey: 'stageId',
                  columns: kanbanColumns,
                  renderCard: (record) => {
                    const deal = health.data?.get(record.id)
                    return (
                      <div className='flex flex-col gap-1.5'>
                        <span className='truncate font-medium'>
                          {record.name || 'Oportunidade sem nome'}
                        </span>
                        {record.companyId ? (
                          <span className='truncate text-muted-foreground text-xs'>
                            {lookups.maps.companies[record.companyId] ?? ''}
                          </span>
                        ) : null}
                        {record.amount ? (
                          <span className='text-xs tabular-nums'>
                            {BRL.format(record.amount)}
                          </span>
                        ) : null}
                        {deal ? (
                          <>
                            <HealthBadge
                              level={deal.level}
                              levelLabel={deal.levelLabel}
                              riskScore={deal.riskScore}
                              factors={deal.factors}
                              className='self-start'
                            />
                            {deal.level !== 'LOW' ? (
                              <HealthNextAction action={deal.nextAction} />
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    )
                  },
                }
              : undefined
          }
          renderRecordExtra={(record) => (
            <div className='flex flex-col gap-5'>
              <OpportunityHealthPanel
                workspaceId={workspaceId}
                opportunityId={record.id}
                canEdit={canEdit}
              />
              <DealRoomPanel
                workspaceId={workspaceId}
                opportunityId={record.id}
                canEdit={canEdit}
              />
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
