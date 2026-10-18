'use client'

import {
  AiBrain01Icon,
  ArrowLeft02Icon,
  CheckmarkBadge01Icon,
  TestTube01Icon,
  Wrench01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelAiNotice } from '@/app/_components/steel-ai/steel-ai-notice'
import {
  SteelAiSimulatedActionCard,
  simulatedActionsLabel,
} from '@/app/_components/steel-ai/steel-ai-simulated-action-card'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { AiFeedbackControl } from '@/app/_components/steel-ai-quality/ai-feedback-buttons'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useSteelAgent, useSteelAgentRun } from '@/src/hooks/use-steel-agents'
import type { SteelAgentRunStepDTO } from '@/types/steel-agent'
import type { AiSimulatedActionDTO } from '@/types/steel-ai'
import { SteelAgentApprovalCard } from './steel-agent-approval-card'
import {
  formatAgentDate,
  RUN_STATUS_LABEL,
  RUN_STATUS_VARIANT,
  STEP_STATUS_LABEL,
  TEST_RUN_LABEL,
  TRIGGER_LABEL,
} from './steel-agent-labels'

const STEP_ICON = {
  MODEL: AiBrain01Icon,
  TOOL: Wrench01Icon,
  APPROVAL: CheckmarkBadge01Icon,
} as const

function stepTitle(step: SteelAgentRunStepDTO): string {
  if (step.kind === 'MODEL') return 'Modelo pensou'
  const name = step.toolLabel ?? step.toolName ?? 'Ferramenta'
  return step.kind === 'APPROVAL' ? `Pediu aprovação: ${name}` : name
}

function stepDetail(step: SteelAgentRunStepDTO): string | null {
  const output = (step.output ?? {}) as Record<string, unknown>
  if (step.error) return step.error
  if (step.kind === 'MODEL') {
    const text = typeof output.text === 'string' ? output.text : ''
    const calls = Array.isArray(output.toolCalls) ? output.toolCalls.length : 0
    if (text) return text
    return calls > 0 ? `Chamou ${calls} ferramenta(s)` : null
  }
  if (typeof output.summary === 'string') return output.summary
  if (typeof output.title === 'string') return output.title
  return null
}

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
            <h2 className='font-semibold text-sm'>Linha do tempo</h2>
            {data.steps.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                {data.status === 'QUEUED'
                  ? 'A execução está na fila.'
                  : 'Nenhuma etapa registrada.'}
              </p>
            ) : (
              <ol className='relative ml-3 space-y-4 border-border/80 border-l pl-5'>
                {data.steps.map((step) => {
                  const detail = stepDetail(step)
                  return (
                    <li key={step.id} className='relative'>
                      <span
                        className={cn(
                          '-left-[33px] absolute top-0 flex size-6 items-center justify-center rounded-full border border-border/80 bg-primary-foreground text-muted-foreground',
                          step.status === 'FAILED' &&
                            'border-destructive text-destructive',
                        )}
                      >
                        <SteelIcon
                          icon={STEP_ICON[step.kind]}
                          strokeWidth={2}
                          className='size-3.5'
                        />
                      </span>
                      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
                        <span className='min-w-0 break-words font-medium text-sm'>
                          {stepTitle(step)}
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          {STEP_STATUS_LABEL[step.status]} ·{' '}
                          {formatAgentDate(step.createdAt, timezone)}
                        </span>
                      </div>
                      {detail ? (
                        <p className='mt-0.5 line-clamp-4 whitespace-pre-wrap break-words text-muted-foreground text-xs'>
                          {detail}
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            )}
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
