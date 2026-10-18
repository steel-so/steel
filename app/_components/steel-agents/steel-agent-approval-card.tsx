'use client'

import {
  Alert02Icon,
  CancelCircleIcon,
  Clock01Icon,
  Loading03Icon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelAiActionPreview } from '@/app/_components/steel-ai/steel-ai-action-preview'
import { STEEL_AI_MODULE_META } from '@/app/_components/steel-ai/steel-ai-starters'
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
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import { useDecideSteelAgentAction } from '@/src/hooks/use-steel-agents'
import type {
  AiActionKindDTO,
  AiPendingActionDTO,
  AiPendingActionStatusDTO,
} from '@/types/steel-ai'

const KIND_LABEL: Record<AiActionKindDTO, string> = {
  CREATE: 'Criar',
  UPDATE: 'Alterar',
  DELETE: 'Excluir',
  ACTION: 'Ação',
}

const OUTCOME: Record<
  Exclude<AiPendingActionStatusDTO, 'PENDING'>,
  { icon: typeof Tick02Icon; label: string; className: string }
> = {
  EXECUTED: {
    icon: Tick02Icon,
    label: 'Aprovada e executada',
    className: 'text-primary',
  },
  FAILED: {
    icon: Alert02Icon,
    label: 'Aprovada, mas falhou',
    className: 'text-destructive',
  },
  CANCELED: {
    icon: CancelCircleIcon,
    label: 'Rejeitada — nada foi alterado',
    className: 'text-muted-foreground',
  },
  EXPIRED: {
    icon: Clock01Icon,
    label: 'Expirou sem decisão — nada foi alterado',
    className: 'text-muted-foreground',
  },
}

/**
 * A write proposed by a Steel Agent, waiting for the owner or an admin.
 * Shows the preview (before → after); DELETE asks twice and sends
 * `doubleConfirmed: true`. The tool runs with the agent owner's permissions.
 */
export function SteelAgentApprovalCard({
  workspaceId,
  runId,
  action: initial,
  canApprove,
}: {
  workspaceId: string
  runId: string
  action: AiPendingActionDTO
  canApprove: boolean
}) {
  const [override, setOverride] = useState<AiPendingActionDTO | null>(null)
  const [askTwice, setAskTwice] = useState(false)
  const { approve, reject } = useDecideSteelAgentAction(workspaceId, runId)
  const action = override && initial.status === 'PENDING' ? override : initial
  const expired =
    action.status === 'PENDING' && Date.parse(action.expiresAt) <= Date.now()
  const status: AiPendingActionStatusDTO = expired ? 'EXPIRED' : action.status
  const busy = approve.isPending || reject.isPending
  const isDelete = action.kind === 'DELETE' || action.requiresDoubleConfirm
  const { preview } = action
  const moduleMeta = action.module ? STEEL_AI_MODULE_META[action.module] : null
  const outcome = status === 'PENDING' ? null : OUTCOME[status]

  async function doApprove(doubleConfirmed: boolean) {
    try {
      setOverride(
        await approve.mutateAsync({
          actionId: action.id,
          ...(doubleConfirmed && { doubleConfirmed: true }),
        }),
      )
      setAskTwice(false)
      notify.success('Ação aprovada.')
    } catch (error) {
      setAskTwice(false)
      if (isApiErrorCode(error, 'AI_PENDING_ACTION_CHANGED')) {
        // Still pending: the run refetch brings the fresh preview.
        notify.warning(
          'O registro mudou desde a prévia. Revise e aprove de novo.',
        )
        return
      }
      notify.error(error)
    }
  }

  async function doReject() {
    try {
      setOverride(await reject.mutateAsync(action.id))
      notify.success('Ação rejeitada.')
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <article
      aria-label={`Ação proposta: ${preview.title}`}
      data-status={status}
      className={cn(
        'w-full space-y-3 rounded-xl border bg-card p-3.5 text-card-foreground sm:p-4',
        isDelete && status === 'PENDING'
          ? 'border-destructive/40'
          : 'border-border/80',
      )}
    >
      <header className='space-y-1.5'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
          <Badge
            variant={action.kind === 'DELETE' ? 'destructive' : 'secondary'}
          >
            {KIND_LABEL[action.kind]}
          </Badge>
          {moduleMeta ? (
            <span className='inline-flex items-center gap-1 text-muted-foreground'>
              <SteelIcon
                icon={moduleMeta.icon}
                strokeWidth={2}
                className='size-3.5'
              />
              {moduleMeta.label}
            </span>
          ) : null}
          {status === 'PENDING' ? (
            <span className='text-muted-foreground'>Aguardando aprovação</span>
          ) : null}
        </div>
        <h3 className='font-semibold text-sm leading-snug'>{preview.title}</h3>
      </header>

      <SteelAiActionPreview preview={preview} />

      {status === 'PENDING' ? (
        canApprove ? (
          <footer className='flex items-center justify-end gap-2 pt-1'>
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={doReject}
              className='flex-1 sm:flex-none'
            >
              Rejeitar
            </Button>
            <Button
              size='sm'
              variant={isDelete ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => (isDelete ? setAskTwice(true) : doApprove(false))}
              className='flex-1 sm:flex-none'
            >
              {approve.isPending ? (
                <SteelIcon
                  icon={Loading03Icon}
                  strokeWidth={2}
                  className='animate-spin'
                />
              ) : null}
              {approve.isPending ? 'Executando…' : 'Aprovar'}
            </Button>
          </footer>
        ) : (
          <p className='text-muted-foreground text-xs'>
            Só o responsável pelo agente ou um administrador pode decidir.
          </p>
        )
      ) : outcome ? (
        <footer
          role='status'
          className={cn('flex items-start gap-1.5 text-xs', outcome.className)}
        >
          <SteelIcon
            icon={outcome.icon}
            strokeWidth={2}
            className='mt-px size-3.5 shrink-0'
          />
          <span>
            <span className='font-medium'>{outcome.label}</span>
            {status === 'EXECUTED' && action.resultSummary
              ? ` — ${action.resultSummary}`
              : null}
            {status === 'FAILED' && action.error ? ` — ${action.error}` : null}
          </span>
        </footer>
      ) : null}

      <AlertDialog
        open={askTwice}
        onOpenChange={(open) => {
          if (!open && !approve.isPending) setAskTwice(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar exclusão?</AlertDialogTitle>
            <AlertDialogDescription>
              {preview.title}. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approve.isPending}>
              Voltar
            </AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={approve.isPending}
              onClick={() => doApprove(true)}
            >
              Excluir definitivamente
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
