'use client'

import {
  ArrowLeft02Icon,
  RepeatIcon,
  TestTube01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SteelAiNotice } from '@/app/_components/steel-ai/steel-ai-notice'
import {
  SteelAiSimulatedActionCard,
  simulatedActionsLabel,
} from '@/app/_components/steel-ai/steel-ai-simulated-action-card'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { AiFeedbackControl } from '@/app/_components/steel-ai-quality/ai-feedback-buttons'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useRerunSteelAgentRunAsTest,
  useSteelAgent,
  useSteelAgentRun,
} from '@/src/hooks/use-steel-agents'
import type { SteelAgentRunStepDTO } from '@/types/steel-agent'
import type { AiSimulatedActionDTO } from '@/types/steel-ai'
import { SteelAgentApprovalCard } from './steel-agent-approval-card'
import {
  formatAgentDate,
  RUN_STATUS_LABEL,
  RUN_STATUS_VARIANT,
  TEST_RUN_LABEL,
  TRIGGER_LABEL,
} from './steel-agent-labels'
import { SteelAgentTrace } from './steel-agent-trace'

/** The write a test-run step simulated (`output.simulation`), if any. */
export function stepSimulation(
  step: SteelAgentRunStepDTO,
): AiSimulatedActionDTO | null {
  if (step.status !== 'SIMULATED') return null
  const output = (step.output ?? {}) as { simulation?: unknown }
  const simulation = output.simulation as AiSimulatedActionDTO | undefined
  if (!simulation?.preview || typeof simulation.preview.title !== 'string') {
    return null
  }
  return simulation
}

/**
 * `/ai/agents/[agentId]/runs/[runId]` — run summary, step timeline and the
 * approval screen (the inbox notification links here). A test run also
 * lists what the agent would have done.
 */
export function SteelAgentRunView({
  workspaceId,
  slug,
  agentId,
  runId,
}: {
  workspaceId: string
  slug: string
  agentId: string
  runId: string
}) {
  const run = useSteelAgentRun(workspaceId, agentId, runId)
  const agent = useSteelAgent(workspaceId, agentId)
  const timezone = agent.data?.timezone ?? 'America/Sao_Paulo'
  const rerun = useRerunSteelAgentRunAsTest(workspaceId, agentId)
  const router = useRouter()

  async function rerunAsTest() {
    try {
      const created = await rerun.mutateAsync(runId)
      notify.success('Reexecução em teste enfileirada. Nada será alterado.')
      router.push(`/${slug}/ai/agents/${agentId}/runs/${created.id}`)
    } catch (error) {
      notify.error(error)
    }
  }

  if (run.isLoading) {
    return (
      <div className='flex h-full min-h-0 w-full flex-col'>
        <SteelAiTopBar />
        <div
          className='mx-auto w-full max-w-3xl space-y-3 px-4 pt-2 sm:px-6 sm:pt-4'
          aria-hidden
        >
          <Skeleton className='h-7 w-56 max-w-full' />
          <Skeleton className='h-40 rounded-xl' />
        </div>
      </div>
    )
  }
  if (!run.data) {
    return (
      <div className='flex h-full min-h-0 w-full flex-col'>
        <SteelAiTopBar />
        <div className='mx-auto w-full max-w-3xl px-4 pt-4 text-muted-foreground text-sm sm:px-6'>
          Execução não encontrada.{' '}
          <Link
            href={`/${slug}/ai/agents/${agentId}`}
            className='text-primary underline'
          >
            Voltar para o agente
          </Link>
        </div>
      </div>
    )
  }
  const data = run.data
  const pending = data.pendingActions.filter((a) => a.status === 'PENDING')
  const decided = data.pendingActions.filter((a) => a.status !== 'PENDING')
  const simulated = data.steps.flatMap((step) => {
    const simulation = stepSimulation(step)
    return simulation ? [{ step, simulation }] : []
  })

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar title={`${data.agent.name} · execução`} />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-6 px-4 pt-2 pb-8 sm:px-6 sm:pt-4'>
          <header className='space-y-2.5'>
            <Link
              href={`/${slug}/ai/agents/${agentId}`}
              className='inline-flex max-w-full items-center gap-1 text-muted-foreground text-xs hover:text-foreground'
            >
              <SteelIcon
                icon={ArrowLeft02Icon}
                strokeWidth={2}
                className='size-3.5 shrink-0'
              />
              <span className='truncate'>{data.agent.name}</span>
            </Link>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs'>
              <Badge variant={RUN_STATUS_VARIANT[data.status]}>
                {RUN_STATUS_LABEL[data.status]}
              </Badge>
              {data.isTest ? (
                <Badge variant='outline' className='gap-1'>
                  <SteelIcon
                    icon={TestTube01Icon}
                    strokeWidth={2}
                    className='size-3'
                  />
                  {TEST_RUN_LABEL}
                </Badge>
              ) : null}
              <span>{TRIGGER_LABEL[data.triggerType]}</span>
              <span className='whitespace-nowrap'>
                {formatAgentDate(data.createdAt, timezone)}
              </span>
              {data.modelKey ? (
                <span className='break-all'>{data.modelKey}</span>
              ) : null}
              <span className='whitespace-nowrap tabular-nums'>
                {(data.inputTokens + data.outputTokens).toLocaleString('pt-BR')}{' '}
                tokens
              </span>
              <span className='whitespace-nowrap tabular-nums'>
                US$ {data.costUsd.toFixed(4)}
              </span>
            </div>
            {data.parentRunId ? (
              <p className='text-muted-foreground text-xs'>
                Execução delegada por outro agente (nível {data.depth}). O custo
                também entra na execução principal.
              </p>
            ) : null}
            {data.delegatedCostUsd > 0 ? (
              <p className='text-muted-foreground text-xs'>
                O custo inclui US$ {data.delegatedCostUsd.toFixed(4)} de agentes
                delegados.
              </p>
            ) : null}
            {data.rerunOfId ? (
              <p className='text-muted-foreground text-xs'>
                Reexecução em teste da{' '}
                <Link
                  href={`/${slug}/ai/agents/${agentId}/runs/${data.rerunOfId}`}
                  className='text-primary underline'
                >
                  execução original
                </Link>
                , com o mesmo gatilho e os mesmos dados de entrada.
              </p>
            ) : null}
            {data.summary ? (
              <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
                {data.summary}
              </p>
            ) : null}
            {data.status === 'SUCCEEDED' || data.status === 'FAILED' ? (
              <AiFeedbackControl
                workspaceId={workspaceId}
                surface='STEEL_AGENT_RUN'
                targetId={runId}
                label='O agente fez um bom trabalho?'
              />
            ) : null}
            {data.error ? (
              <p className='break-words text-destructive text-sm'>
                {data.error}
              </p>
            ) : null}
          </header>

          {data.isTest ? (
            <SteelAiNotice tone='info' icon={TestTube01Icon}>
              Execução de teste: as consultas foram reais e as alterações só
              simuladas — nada foi gravado, enviado ou mandado para aprovação.
            </SteelAiNotice>
          ) : null}

          {data.isTest &&
          (simulated.length > 0 ||
            data.status === 'SUCCEEDED' ||
            data.status === 'FAILED') ? (
            <section className='space-y-2' aria-label='O que o agente faria'>
              <h2 className='font-semibold text-sm'>
                O que o agente faria
                <span className='ml-2 font-normal text-muted-foreground text-xs'>
                  {simulated.length > 0
                    ? simulatedActionsLabel(simulated.length)
                    : 'nenhuma alteração'}
                </span>
              </h2>
              {simulated.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  Nesta execução o agente só consultou dados.
                </p>
              ) : (
                simulated.map(({ step, simulation }) => (
                  <SteelAiSimulatedActionCard
                    key={step.id}
                    call={{
                      id: step.id,
                      name: step.toolName ?? '',
                      label: step.toolLabel ?? step.toolName ?? '',
                      module: null,
                      status: 'simulated',
                      simulation,
                    }}
                  />
                ))
              )}
            </section>
          ) : null}

          {pending.length > 0 ? (
            <section className='space-y-2' aria-label='Aguardando aprovação'>
              <h2 className='font-semibold text-sm'>Aguardando aprovação</h2>
              {pending.map((action) => (
                <SteelAgentApprovalCard
                  key={action.id}
                  workspaceId={workspaceId}
                  runId={runId}
                  action={action}
                  canApprove={data.canApprove}
                />
              ))}
            </section>
          ) : null}

          <section className='space-y-2' aria-label='Linha do tempo'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h2 className='font-semibold text-sm'>
                Linha do tempo: o porquê de cada passo
              </h2>
              {data.canApprove && data.status !== 'QUEUED' ? (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={rerun.isPending}
                  onClick={rerunAsTest}
                >
                  <SteelIcon icon={RepeatIcon} strokeWidth={2} />
                  Reexecutar como teste
                </Button>
              ) : null}
            </div>
            <SteelAgentTrace
              slug={slug}
              steps={data.steps}
              timezone={timezone}
              emptyText={
                data.status === 'QUEUED'
                  ? 'A execução está na fila.'
                  : 'Nenhuma etapa registrada.'
              }
            />
          </section>

          {decided.length > 0 ? (
            <section className='space-y-2' aria-label='Ações decididas'>
              <h2 className='font-semibold text-sm'>Ações decididas</h2>
              {decided.map((action) => (
                <SteelAgentApprovalCard
                  key={action.id}
                  workspaceId={workspaceId}
                  runId={runId}
                  action={action}
                  canApprove={false}
                />
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
