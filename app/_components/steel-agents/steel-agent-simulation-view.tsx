'use client'

import {
  ArrowLeft02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  RefreshIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useDeleteSteelAgentSimulation,
  useRerunSteelAgentSimulation,
  useSteelAgentSimulation,
} from '@/src/hooks/use-steel-agent-simulations'
import {
  useSteelAgent,
  useSteelAgentCatalog,
} from '@/src/hooks/use-steel-agents'
import { SIMULATION_CHANNEL_LABEL } from '@/src/lib/steel-agents/simulation/personas'
import type { SteelAgentSimulationCaseDTO } from '@/types/steel-agent-simulation'
import { formatAgentDate } from './steel-agent-labels'
import {
  describeScoreboard,
  formatSimulationCost,
  SIMULATION_CASE_STATUS_LABEL,
  SIMULATION_STATUS_LABEL,
  SIMULATION_STATUS_VARIANT,
  SIMULATION_VERDICT_LABEL,
  SIMULATION_VERDICT_VARIANT,
  TOOL_EVENT_STATUS_LABEL,
} from './steel-agent-simulation-labels'

function CaseCard({
  item,
  defaultOpen,
}: {
  item: SteelAgentSimulationCaseDTO
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className='overflow-hidden rounded-xl border bg-card'>
        <CollapsibleTrigger
          className='flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50'
          aria-label={`Cenário ${item.label}`}
        >
          {item.verdict ? (
            <Badge variant={SIMULATION_VERDICT_VARIANT[item.verdict]}>
              {SIMULATION_VERDICT_LABEL[item.verdict]}
            </Badge>
          ) : (
            <Badge
              variant={item.status === 'FAILED' ? 'destructive' : 'outline'}
            >
              {SIMULATION_CASE_STATUS_LABEL[item.status]}
            </Badge>
          )}
          <span className='min-w-0 flex-1 break-words font-medium text-sm'>
            {item.label}
          </span>
          <span className='shrink-0 text-muted-foreground text-xs'>
            {SIMULATION_CHANNEL_LABEL[item.channel]}
            {item.score !== null ? ` · nota ${item.score}` : ''}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className='space-y-4 border-t px-4 py-4'>
            {item.judgeSummary ? (
              <p className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
                {item.judgeSummary}
              </p>
            ) : null}
            {item.error ? (
              <p className='break-words text-destructive text-sm'>
                {item.error}
              </p>
            ) : null}

            <section className='space-y-1.5' aria-label='Critérios'>
              <h3 className='font-medium text-sm'>Critérios</h3>
              {item.criteriaResults.length > 0 ? (
                <ul className='space-y-1.5'>
                  {item.criteriaResults.map((result) => (
                    <li key={result.criterion} className='flex gap-2 text-sm'>
                      <SteelIcon
                        icon={result.met ? CheckmarkCircle02Icon : Cancel01Icon}
                        strokeWidth={2}
                        className={
                          result.met
                            ? 'mt-0.5 size-4 shrink-0 text-primary'
                            : 'mt-0.5 size-4 shrink-0 text-destructive'
                        }
                      />
                      <span className='min-w-0'>
                        <span className='break-words'>{result.criterion}</span>
                        <span className='sr-only'>
                          {result.met ? ' — atendido' : ' — não atendido'}
                        </span>
                        {result.evidence ? (
                          <span className='block break-words text-muted-foreground text-xs'>
                            {result.evidence}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className='list-disc space-y-1 pl-5 text-muted-foreground text-sm'>
                  {item.criteria.map((criterion) => (
                    <li key={criterion} className='break-words'>
                      {criterion}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className='space-y-1.5' aria-label='Conversa'>
              <h3 className='font-medium text-sm'>Conversa</h3>
              {item.transcript.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  A conversa ainda não começou.
                </p>
              ) : (
                <ol className='space-y-2'>
                  {item.transcript.map((turn, index) => (
                    <li
                      key={index}
                      className={
                        turn.role === 'customer'
                          ? 'flex justify-start'
                          : 'flex justify-end'
                      }
                    >
                      <div
                        className={
                          turn.role === 'customer'
                            ? 'max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm'
                            : 'max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground text-sm'
                        }
                      >
                        <span className='block font-medium text-[11px] opacity-70'>
                          {turn.role === 'customer' ? 'Cliente' : 'Agente'}
                        </span>
                        <span className='whitespace-pre-wrap break-words'>
                          {turn.text}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {item.endReason ? (
                <p className='text-muted-foreground text-xs'>
                  Encerrada: {item.endReason}
                </p>
              ) : null}
            </section>

            {item.toolEvents.length > 0 ? (
              <section className='space-y-1.5' aria-label='Ferramentas'>
                <h3 className='font-medium text-sm'>Ferramentas usadas</h3>
                <ul className='space-y-1'>
                  {item.toolEvents.map((event, index) => (
                    <li
                      key={index}
                      className='flex flex-wrap items-center gap-x-2 text-sm'
                    >
                      <Badge
                        variant={
                          event.status === 'FAILED' ? 'destructive' : 'outline'
                        }
                      >
                        {TOOL_EVENT_STATUS_LABEL[event.status]}
                      </Badge>
                      <span className='break-all font-mono text-xs'>
                        {event.toolName}
                      </span>
                      <span className='min-w-0 break-words text-muted-foreground text-xs'>
                        {event.error ?? event.title ?? ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className='text-muted-foreground text-xs tabular-nums'>
              {formatSimulationCost(item.costUsd)}
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

/** `/ai/agents/[agentId]/simulations/[simulationId]` — scoreboard + transcripts. */
export function SteelAgentSimulationView({
  workspaceId,
  slug,
  agentId,
  simulationId,
}: {
  workspaceId: string
  slug: string
  agentId: string
  simulationId: string
}) {
  const simulation = useSteelAgentSimulation(workspaceId, agentId, simulationId)
  const agent = useSteelAgent(workspaceId, agentId)
  const catalog = useSteelAgentCatalog(workspaceId)
  const rerun = useRerunSteelAgentSimulation(workspaceId, agentId)
  const remove = useDeleteSteelAgentSimulation(workspaceId, agentId)
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const timezone = agent.data?.timezone ?? 'America/Sao_Paulo'
  const canManage = catalog.data?.canManage ?? false

  if (simulation.isLoading) {
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
  if (!simulation.data) {
    return (
      <div className='flex h-full min-h-0 w-full flex-col'>
        <SteelAiTopBar />
        <div className='mx-auto w-full max-w-3xl px-4 pt-4 text-muted-foreground text-sm sm:px-6'>
          Simulação não encontrada.{' '}
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
  const data = simulation.data
  const live = data.status === 'QUEUED' || data.status === 'RUNNING'

  async function repeat() {
    try {
      const created = await rerun.mutateAsync(simulationId)
      notify.success('Simulação enfileirada.')
      router.push(`/${slug}/ai/agents/${agentId}/simulations/${created.id}`)
    } catch (error) {
      notify.error(error)
    }
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync(simulationId)
      notify.success('Simulação excluída.')
      router.push(`/${slug}/ai/agents/${agentId}`)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar
        title={`${data.agentName} · simulação`}
        actions={
          <div className='flex items-center gap-1'>
            <Button
              size='sm'
              variant='outline'
              aria-label='Repetir simulação'
              className='max-sm:size-8 max-sm:px-0'
              disabled={live || rerun.isPending}
              onClick={repeat}
            >
              <SteelIcon icon={RefreshIcon} strokeWidth={2} />
              <span className='hidden sm:inline'>Repetir</span>
            </Button>
            {canManage ? (
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label='Excluir simulação'
                onClick={() => setDeleting(true)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            ) : null}
          </div>
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-5 px-4 pt-2 pb-8 sm:px-6 sm:pt-4'>
          <header className='space-y-2'>
            <Link
              href={`/${slug}/ai/agents/${agentId}`}
              className='inline-flex max-w-full items-center gap-1 text-muted-foreground text-xs hover:text-foreground'
            >
              <SteelIcon
                icon={ArrowLeft02Icon}
                strokeWidth={2}
                className='size-3.5 shrink-0'
              />
              <span className='truncate'>{data.agentName}</span>
            </Link>
            <h1 className='break-words font-semibold text-lg'>{data.name}</h1>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs'>
              <Badge variant={SIMULATION_STATUS_VARIANT[data.status]}>
                {SIMULATION_STATUS_LABEL[data.status]}
              </Badge>
              <span>{describeScoreboard(data)}</span>
              {data.avgScore !== null ? (
                <span className='whitespace-nowrap tabular-nums'>
                  Nota média {data.avgScore} (mínima {data.passScore})
                </span>
              ) : null}
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
                {formatSimulationCost(data.costUsd)}
              </span>
            </div>
            {data.error ? (
              <p className='break-words text-destructive text-sm'>
                {data.error}
              </p>
            ) : null}
            <p className='text-muted-foreground text-xs'>
              Simulação: as consultas foram reais e as alterações só foram
              simuladas. Nada foi gravado nem enviado.
            </p>
          </header>

          <div className='space-y-3'>
            {data.cases.map((item, index) => (
              <CaseCard
                key={item.id}
                item={item}
                defaultOpen={data.cases.length === 1 || index === 0}
              />
            ))}
          </div>
        </div>
      </div>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir simulação?</AlertDialogTitle>
            <AlertDialogDescription>
              “{data.name}” e as conversas dela serão excluídas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={remove.isPending}
              onClick={confirmDelete}
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
