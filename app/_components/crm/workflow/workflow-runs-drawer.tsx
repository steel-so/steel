'use client'

import { Cancel01Icon, PlayIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCrmWorkflowRun,
  useCrmWorkflowRuns,
  useResumeCrmWorkflowRun,
} from '@/src/hooks/use-crm-workflow'
import type {
  CrmWorkflowRunDTO,
  CrmWorkflowRunStatus,
} from '@/src/schemas/crm-workflow.schema'
import {
  WORKFLOW_RUN_STATUS_LABELS,
  WORKFLOW_STEP_STATUS_LABELS,
  workflowNodeLabel,
  workflowTriggerLabel,
} from './workflow-labels'

const STATUS_COLOR: Record<CrmWorkflowRunStatus, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  RUNNING: 'bg-amber-500/10 text-amber-600',
  WAITING: 'bg-sky-500/10 text-sky-600',
  COMPLETED: 'bg-emerald-500/10 text-emerald-600',
  FAILED: 'bg-rose-500/10 text-rose-600',
  CANCELED: 'bg-zinc-500/10 text-zinc-600',
}

export function WorkflowRunsDrawer({
  workspaceId,
  workflowId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  workflowId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const {
    data: runs,
    isLoading,
    refetch,
  } = useCrmWorkflowRuns(workspaceId, open ? workflowId : null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className='!w-full overflow-auto p-0 sm:!w-[480px] sm:!max-w-[480px]'
      >
        <div className='flex h-14 shrink-0 items-center gap-2 border-b px-4'>
          <span className='font-semibold text-sm'>Histórico de execuções</span>
          <SheetClose
            className='ml-auto'
            nativeButton={true}
            render={
              <Button variant='ghost' size='icon-sm' aria-label='Fechar'>
                <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            }
          />
        </div>
        <div className='flex-1 space-y-2 p-3'>
          {isLoading && (
            <>
              <Skeleton className='h-16 w-full' />
              <Skeleton className='h-16 w-full' />
            </>
          )}
          {!isLoading && (!runs || runs.length === 0) && (
            <p className='py-8 text-center text-muted-foreground text-sm'>
              Nenhuma execução ainda. Use "Testar" para disparar uma.
            </p>
          )}
          {!isLoading &&
            runs?.map((run) => (
              <div
                key={run.id}
                className='rounded-lg border bg-card p-3 text-card-foreground'
              >
                <div className='flex items-center gap-2'>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 font-semibold text-xs',
                      STATUS_COLOR[run.status],
                    )}
                  >
                    {WORKFLOW_RUN_STATUS_LABELS[run.status]}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {workflowTriggerLabel(run.triggerType)}
                  </span>
                  <span className='ml-auto text-muted-foreground text-xs'>
                    {new Date(run.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                {run.error && (
                  <p className='mt-2 rounded bg-rose-500/10 p-2 text-rose-600 text-xs'>
                    {run.error}
                  </p>
                )}
                {run.steps && run.steps.length > 0 && (
                  <ul className='mt-2 space-y-1 text-xs'>
                    {run.steps.map((step) => (
                      <li
                        key={step.id}
                        className='flex items-center gap-2 text-muted-foreground'
                      >
                        <span
                          className={cn(
                            'rounded px-1.5 py-px text-[10px]',
                            step.status === 'COMPLETED'
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : step.status === 'FAILED'
                                ? 'bg-rose-500/10 text-rose-600'
                                : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {WORKFLOW_STEP_STATUS_LABELS[step.status]}
                        </span>
                        <span className='truncate'>
                          {workflowNodeLabel(step.nodeType)} · {step.nodeId}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {run.status === 'WAITING' && (
                  <WaitingRun
                    workspaceId={workspaceId}
                    workflowId={workflowId}
                    run={run}
                    onResolved={refetch}
                  />
                )}
              </div>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * The runs list comes without steps; a waiting run loads its detail to know
 * whether it waits for a delay (shows when it continues) or for a form.
 */
function WaitingRun({
  workspaceId,
  workflowId,
  run,
  onResolved,
}: {
  workspaceId: string
  workflowId: string
  run: CrmWorkflowRunDTO
  onResolved: () => void
}) {
  const { data } = useCrmWorkflowRun(workspaceId, workflowId, run.id)
  const detailed = data ?? run
  return (
    <>
      <DelayNotice run={detailed} />
      <ResumeForm
        workspaceId={workspaceId}
        workflowId={workflowId}
        run={detailed}
        onResolved={onResolved}
      />
    </>
  )
}

/** A run paused on an "Atraso" step continues by itself at `resumeAt`. */
export function DelayNotice({ run }: { run: CrmWorkflowRunDTO }) {
  const step = run.steps?.find((s) => s.id === run.waitingStepId)
  const resumeAt = (step?.output as { resumeAt?: string } | null)?.resumeAt
  if (step?.nodeType !== 'delay' || !resumeAt) return null
  return (
    <p className='mt-2 text-muted-foreground text-xs'>
      Aguardando o atraso. Continua sozinha em{' '}
      {new Date(resumeAt).toLocaleString('pt-BR')}.
    </p>
  )
}

function ResumeForm({
  workspaceId,
  workflowId,
  run,
  onResolved,
}: {
  workspaceId: string
  workflowId: string
  run: CrmWorkflowRunDTO
  onResolved: () => void
}) {
  const waitingStep = run.steps?.find((s) => s.id === run.waitingStepId)
  const fields =
    (waitingStep?.output as { fields?: string[] } | null)?.fields ?? []
  const [values, setValues] = useState<Record<string, string>>({})
  const resumeRun = useResumeCrmWorkflowRun(workspaceId)

  if (fields.length === 0) return null

  const handleSubmit = async () => {
    try {
      await resumeRun.mutateAsync({
        workflowId,
        runId: run.id,
        payload: values,
      })
      notify.success('Execução retomada')
      onResolved()
    } catch (err) {
      notify.error(err, 'Não foi possível retomar a execução.')
    }
  }

  return (
    <div className='mt-3 space-y-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-3'>
      <p className='font-medium text-sky-700 text-xs dark:text-sky-300'>
        Aguardando preenchimento
      </p>
      {fields.map((name) => (
        <div key={name} className='space-y-1'>
          <Label className='text-muted-foreground text-xs'>{name}</Label>
          <Input
            value={values[name] ?? ''}
            onChange={(e) =>
              setValues((v) => ({ ...v, [name]: e.target.value }))
            }
            className='h-8'
          />
        </div>
      ))}
      <Button
        size='sm'
        onClick={handleSubmit}
        disabled={resumeRun.isPending}
        className='w-full'
      >
        <SteelIcon icon={PlayIcon} strokeWidth={2} />
        Continuar
      </Button>
    </div>
  )
}
