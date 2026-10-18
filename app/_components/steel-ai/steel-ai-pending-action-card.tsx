'use client'

import {
  Alert02Icon,
  CancelCircleIcon,
  Clock01Icon,
  Loading03Icon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
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
import {
  changedPendingAction,
  useCancelSteelAiAction,
  useConfirmSteelAiAction,
} from '@/src/hooks/use-steel-ai'
import type {
  AiActionKindDTO,
  AiPendingActionDTO,
  AiPendingActionStatusDTO,
} from '@/types/steel-ai'
import { SteelAiActionPreview } from './steel-ai-action-preview'
import { STEEL_AI_MODULE_META } from './steel-ai-starters'

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
  EXECUTED: { icon: Tick02Icon, label: 'Executada', className: 'text-primary' },
  FAILED: { icon: Alert02Icon, label: 'Falhou', className: 'text-destructive' },
  CANCELED: {
    icon: CancelCircleIcon,
    label: 'Cancelada',
    className: 'text-muted-foreground',
  },
  EXPIRED: {
    icon: Clock01Icon,
    label: 'Expirada — peça de novo ao Steel AI se ainda quiser fazer isso.',
    className: 'text-muted-foreground',
  },
}

function effectiveStatus(
  action: AiPendingActionDTO,
  now: number,
): AiPendingActionStatusDTO {
  if (action.status === 'PENDING' && Date.parse(action.expiresAt) <= now) {
    return 'EXPIRED'
  }
  return action.status
}

/**
 * A write proposed in agent mode. Nothing happens until the user confirms;
 * DELETE (or any action flagged `requiresDoubleConfirm`) asks a second
 * time and sends `doubleConfirmed: true`.
 */
export function SteelAiPendingActionCard({
  workspaceId,
  action: initial,
}: {
  workspaceId: string
  action: AiPendingActionDTO
}) {
  const [override, setOverride] = useState<AiPendingActionDTO | null>(null)
  const [askTwice, setAskTwice] = useState(false)
  const confirm = useConfirmSteelAiAction(workspaceId)
  const cancel = useCancelSteelAiAction(workspaceId)
  // The server copy wins once it moves past PENDING (e.g. after a refetch).
  const action = override && initial.status === 'PENDING' ? override : initial
  const status = effectiveStatus(action, Date.now())
  const busy = confirm.isPending || cancel.isPending
  const needsDouble = action.requiresDoubleConfirm || action.kind === 'DELETE'
  const { preview } = action
  const moduleMeta = action.module ? STEEL_AI_MODULE_META[action.module] : null

  async function run(doubleConfirmed: boolean) {
    try {
      const result = await confirm.mutateAsync({
        actionId: action.id,
        doubleConfirmed: doubleConfirmed || undefined,
      })
      setOverride(result)
      setAskTwice(false)
    } catch (error) {
      setAskTwice(false)
      if (isApiErrorCode(error, 'AI_PENDING_ACTION_EXPIRED')) {
        setOverride({ ...action, status: 'EXPIRED' })
        return
      }
      // The record changed after the preview: show the fresh one and wait
      // for a new confirmation instead of running something nobody saw.
      const fresh = changedPendingAction(error)
      if (fresh) {
        setOverride(fresh)
        notify.warning(
          'O registro mudou desde a prévia. Revise e confirme de novo.',
        )
        return
      }
      notify.error(error)
    }
  }

  async function dismiss() {
    try {
      setOverride(await cancel.mutateAsync(action.id))
    } catch (error) {
      notify.error(error)
    }
  }

  const outcome = status === 'PENDING' ? null : OUTCOME[status]

  return (
    <article
      aria-label={`Ação proposta: ${preview.title}`}
      data-status={status}
      className={cn(
        'w-full max-w-xl space-y-3 rounded-xl border bg-card p-3.5 text-card-foreground sm:p-4',
        action.kind === 'DELETE' && status === 'PENDING'
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
            <span className='text-muted-foreground'>
              Aguardando sua confirmação
            </span>
          ) : null}
        </div>
        <h3 className='font-semibold text-sm leading-snug'>{preview.title}</h3>
      </header>

      <SteelAiActionPreview preview={preview} />

      {status === 'PENDING' ? (
        <footer className='flex items-center justify-end gap-2 pt-1'>
          <Button
            variant='outline'
            size='sm'
            disabled={busy}
            onClick={dismiss}
            className='flex-1 sm:flex-none'
          >
            Cancelar
          </Button>
          <Button
            size='sm'
            variant={action.kind === 'DELETE' ? 'destructive' : 'default'}
            disabled={busy}
            data-ai-approve
            onClick={() => (needsDouble ? setAskTwice(true) : run(false))}
            className='flex-1 sm:flex-none'
          >
            {confirm.isPending ? (
              <SteelIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className='animate-spin'
              />
            ) : null}
            {confirm.isPending ? 'Executando…' : 'Confirmar'}
          </Button>
        </footer>
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
            {status === 'FAILED' && (action.error || action.resultSummary)
              ? ` — ${action.error ?? action.resultSummary}`
              : null}
          </span>
        </footer>
      ) : null}

      <AlertDialog
        open={askTwice}
        onOpenChange={(open) => {
          if (!open && !confirm.isPending) setAskTwice(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão?</AlertDialogTitle>
            <AlertDialogDescription>
              {preview.title}. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirm.isPending}>
              Voltar
            </AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={confirm.isPending}
              onClick={() => run(true)}
            >
              Excluir definitivamente
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
