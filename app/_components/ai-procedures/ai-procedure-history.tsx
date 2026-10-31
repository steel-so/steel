'use client'

import { useState } from 'react'
import { SteelAgentTrace } from '@/app/_components/steel-agents/steel-agent-trace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useAiProcedureRun,
  useAiProcedureRuns,
  useAiProcedureVersions,
  useRestoreAiProcedureVersion,
} from '@/src/hooks/use-ai-procedures'
import type { SteelAgentRunStepDTO } from '@/types/steel-agent'
import {
  formatProcedureDate,
  RUN_STATUS_LABEL,
  SUBJECT_LABEL,
} from './ai-procedure-labels'

// Rendered in the workspace's timezone would need a setting; Brasília is
// the product's reference zone (same as the agents' default).
const TIMEZONE = 'America/Sao_Paulo'

export function AiProcedureVersions({
  workspaceId,
  procedureId,
  canManage,
}: {
  workspaceId: string
  procedureId: string
  canManage: boolean
}) {
  const versions = useAiProcedureVersions(workspaceId, procedureId)
  const restore = useRestoreAiProcedureVersion(workspaceId, procedureId)

  if (versions.isLoading) return <Skeleton className='h-24 w-full' />
  if (!versions.data?.length) {
    return (
      <p className='text-muted-foreground text-sm'>Nenhuma versão ainda.</p>
    )
  }
  return (
    <ul className='space-y-2'>
      {versions.data.map((version) => (
        <li
          key={version.id}
          className='flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm'
        >
          <span className='font-medium'>Versão {version.number}</span>
          {version.current ? <Badge>Em uso</Badge> : null}
          <span className='text-muted-foreground'>
            {version.steps.length}{' '}
            {version.steps.length === 1 ? 'passo' : 'passos'} ·{' '}
            {formatProcedureDate(version.createdAt, TIMEZONE)}
          </span>
          {version.changeNote ? (
            <span className='min-w-0 flex-1 truncate text-muted-foreground'>
              {version.changeNote}
            </span>
          ) : (
            <span className='flex-1' />
          )}
          {canManage && !version.current ? (
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate(version.id, {
                  onSuccess: () => notify.success('Versão restaurada.'),
                  onError: notify.error,
                })
              }
            >
              Restaurar
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function AiProcedureRuns({
  workspaceId,
  procedureId,
}: {
  workspaceId: string
  procedureId: string
}) {
  const runs = useAiProcedureRuns(workspaceId, procedureId)
  const [openId, setOpenId] = useState<string | null>(null)
  const detail = useAiProcedureRun(workspaceId, openId)

  if (runs.isLoading) return <Skeleton className='h-24 w-full' />
  if (!runs.data?.length) {
    return (
      <p className='text-muted-foreground text-sm'>
        Nenhuma execução ainda. Elas aparecem quando a IA usa o procedimento
        numa conversa ou num agente.
      </p>
    )
  }

  // The run trace reuses the agent timeline (A4): same entries, same look.
  const steps: SteelAgentRunStepDTO[] = (detail.data?.steps ?? []).map(
    (step) => ({
      id: step.id,
      kind: 'PROCEDURE',
      toolName: step.stepKey,
      toolLabel: null,
      pendingActionId: null,
      input: step.input,
      output: {
        ...((step.output as Record<string, unknown> | null) ?? {}),
        title: step.title,
        stepStatus: step.status,
      },
      status: step.status === 'OK' || step.status === 'SKIPPED' ? 'OK' : 'FAILED',
      error: step.error,
      createdAt: step.createdAt,
    }),
  )

  return (
    <>
      <ul className='space-y-2'>
        {runs.data.map((run) => (
          <li key={run.id}>
            <button
              type='button'
              onClick={() => setOpenId(run.id)}
              className='flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50'
            >
              <span className='font-medium'>{RUN_STATUS_LABEL[run.status]}</span>
              <Badge variant='secondary'>{SUBJECT_LABEL[run.subjectType]}</Badge>
              <span className='text-muted-foreground'>
                versão {run.versionNumber} ·{' '}
                {formatProcedureDate(run.startedAt, TIMEZONE)}
              </span>
              {run.failureReason ? (
                <span className='min-w-0 flex-1 truncate text-muted-foreground'>
                  {run.failureReason}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Passos da execução</DialogTitle>
            <DialogDescription>
              O que o sistema executou, dispensou ou bloqueou, na ordem.
            </DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <Skeleton className='h-32 w-full' />
          ) : (
            <SteelAgentTrace
              steps={steps}
              timezone={TIMEZONE}
              emptyText='Nenhum passo registrado.'
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
