'use client'

import { RefreshIcon, Task01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCreateTaskFromHealthAction,
  useCrmCustomerHealth,
  useCrmOpportunityHealth,
  useRecomputeCrmCustomerHealth,
  useRecomputeCrmOpportunityHealth,
} from '@/src/hooks/use-crm-health'
import type {
  CrmCustomerHealthDTO,
  CrmOpportunityHealthDTO,
} from '@/types/crm-health'
import { HealthBar, HealthFactorList } from './health-parts'
import { HEALTH_TONE } from './health-tone'

/** "+12 pontos desde o último cálculo" / "estável". */
function trendText(delta: number | null): string | null {
  if (delta === null) return null
  if (delta === 0) return 'Estável desde o último cálculo'
  const points = Math.abs(delta) === 1 ? '1 ponto' : `${Math.abs(delta)} pontos`
  return delta > 0
    ? `Risco subiu ${points} desde o último cálculo`
    : `Risco caiu ${points} desde o último cálculo`
}

function HealthPanelBody({
  data,
  headline,
  missing,
  canEdit,
  recomputing,
  onRecompute,
  onCreateTask,
  creatingTask,
}: {
  data: CrmCustomerHealthDTO | CrmOpportunityHealthDTO
  headline: string
  missing: string[]
  canEdit: boolean
  recomputing: boolean
  onRecompute: () => void
  onCreateTask: () => void
  creatingTask: boolean
}) {
  const trend = trendText(data.riskDelta)
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='font-semibold text-2xl tabular-nums leading-none'>
            {headline}
          </p>
          <p className='mt-1 text-muted-foreground text-xs'>
            Nota de risco {data.riskScore}/100
            {trend ? ` · ${trend}` : ''}
          </p>
        </div>
        <span
          data-health-level={data.level}
          className={cn(
            'shrink-0 rounded-md border px-1.5 py-0.5 font-medium text-[11px]',
            HEALTH_TONE[data.level],
          )}
        >
          {data.levelLabel}
        </span>
      </div>
      <HealthBar level={data.level} riskScore={data.riskScore} />

      {data.factors.length > 0 ? (
        <div className='flex flex-col gap-1.5'>
          <p className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
            Por que esta nota
          </p>
          <HealthFactorList factors={data.factors} />
        </div>
      ) : (
        <p className='text-muted-foreground text-xs'>
          Nenhum sinal de risco agora.
        </p>
      )}

      <div className='flex flex-col gap-1 rounded-lg border bg-muted/40 p-2.5'>
        <p className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
          Próxima melhor ação
        </p>
        <p className='font-medium text-sm'>{data.nextAction.label}</p>
        <p className='text-muted-foreground text-xs'>
          {data.nextAction.detail}
        </p>
      </div>

      {missing.length > 0 ? (
        <p className='text-[11px] text-muted-foreground'>
          Sem dados para: {missing.join(', ')}. Esses sinais não entram na nota.
        </p>
      ) : null}

      {canEdit ? (
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={onCreateTask}
            disabled={creatingTask}
          >
            <SteelIcon icon={Task01Icon} strokeWidth={2} />
            Criar tarefa
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={onRecompute}
            disabled={recomputing}
          >
            <SteelIcon icon={RefreshIcon} strokeWidth={2} />
            Recalcular
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function PanelShell({
  title,
  isLoading,
  error,
  children,
}: {
  title: string
  isLoading: boolean
  error: boolean
  children: React.ReactNode
}) {
  return (
    <section className='flex flex-col gap-2' aria-label={title}>
      <h3 className='font-medium text-sm'>{title}</h3>
      {isLoading ? (
        <div className='flex flex-col gap-2'>
          <Skeleton className='h-8 w-24' />
          <Skeleton className='h-1.5 w-full' />
          <Skeleton className='h-12 w-full' />
        </div>
      ) : error ? (
        <p className='text-muted-foreground text-xs'>
          Não foi possível calcular a nota agora.
        </p>
      ) : (
        children
      )}
    </section>
  )
}

/** Saúde do cliente (T4) no painel da empresa. */
export function CustomerHealthPanel({
  workspaceId,
  companyId,
  canEdit,
}: {
  workspaceId: string
  companyId: string
  canEdit: boolean
}) {
  const query = useCrmCustomerHealth(workspaceId, companyId)
  const recompute = useRecomputeCrmCustomerHealth(workspaceId, companyId)
  const createTask = useCreateTaskFromHealthAction(workspaceId)
  const data = query.data

  return (
    <PanelShell
      title='Saúde do cliente'
      isLoading={query.isLoading}
      error={query.isError || !data}
    >
      {data ? (
        <HealthPanelBody
          data={data}
          headline={`${data.healthScore}% saudável`}
          missing={data.missing}
          canEdit={canEdit}
          recomputing={recompute.isPending}
          creatingTask={createTask.isPending}
          onRecompute={() =>
            recompute.mutate(undefined, {
              onSuccess: () => notify.success('Saúde recalculada'),
              onError: (error) => notify.error(error),
            })
          }
          onCreateTask={() =>
            createTask.mutate(
              {
                title: `${data.nextAction.label} - ${data.companyName}`,
                body: data.nextAction.detail,
                companyId,
              },
              {
                onSuccess: () => notify.success('Tarefa criada para amanhã'),
                onError: (error) => notify.error(error),
              },
            )
          }
        />
      ) : null}
    </PanelShell>
  )
}

/** Saúde da oportunidade (C4) no painel do negócio. */
export function OpportunityHealthPanel({
  workspaceId,
  opportunityId,
  canEdit,
}: {
  workspaceId: string
  opportunityId: string
  canEdit: boolean
}) {
  const query = useCrmOpportunityHealth(workspaceId, opportunityId)
  const recompute = useRecomputeCrmOpportunityHealth(workspaceId, opportunityId)
  const createTask = useCreateTaskFromHealthAction(workspaceId)
  const data = query.data

  // Won and lost deals have no score: show nothing instead of an error.
  if (query.isError && !data) return null

  return (
    <PanelShell
      title='Saúde do negócio'
      isLoading={query.isLoading}
      error={!data}
    >
      {data ? (
        <HealthPanelBody
          data={data}
          headline={`Risco ${data.riskScore}/100`}
          missing={[]}
          canEdit={canEdit}
          recomputing={recompute.isPending}
          creatingTask={createTask.isPending}
          onRecompute={() =>
            recompute.mutate(undefined, {
              onSuccess: () => notify.success('Saúde recalculada'),
              onError: (error) => notify.error(error),
            })
          }
          onCreateTask={() =>
            createTask.mutate(
              {
                title: `${data.nextAction.label} - ${data.opportunityName}`,
                body: data.nextAction.detail,
                opportunityId,
              },
              {
                onSuccess: () => notify.success('Tarefa criada para amanhã'),
                onError: (error) => notify.error(error),
              },
            )
          }
        />
      ) : null}
    </PanelShell>
  )
}
