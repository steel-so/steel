'use client'

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

export type SaveStatusValue =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  // Editors with pending changes or live co-editing also use these two.
  | 'dirty'
  | 'syncing'

const COPY = {
  saving: { icon: Loading03Icon, text: 'Salvando…' },
  syncing: { icon: Loading03Icon, text: 'Sincronizando…' },
  error: { icon: AlertCircleIcon, text: 'Não foi possível salvar' },
  dirty: { icon: null, text: 'Alterações não salvas' },
  saved: { icon: CheckmarkCircle02Icon, text: 'Salvo' },
} as const

/**
 * "Salvo / Salvando / Erro" indicator shared by every builder. `idle` draws
 * nothing; `error` offers "Tentar de novo" when `onRetry` is given.
 */
export function SaveStatus({
  status,
  onRetry,
  className,
}: {
  status: SaveStatusValue
  onRetry?: () => void
  className?: string
}) {
  if (status === 'idle') return null
  const copy = COPY[status]
  return (
    <span
      role='status'
      data-testid='canvas-save-status'
      data-status={status}
      className={cn(
        'flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground',
        status === 'error' && 'text-destructive',
        className,
      )}
    >
      {copy.icon ? (
        <SteelIcon
          icon={copy.icon}
          className={cn(
            'size-3.5',
            (status === 'saving' || status === 'syncing') && 'animate-spin',
          )}
        />
      ) : (
        <span className='size-1.5 rounded-full bg-muted-foreground/60' />
      )}
      {copy.text}
      {status === 'error' && onRetry ? (
        <button
          type='button'
          onClick={onRetry}
          className='rounded-sm font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          Tentar de novo
        </button>
      ) : null}
    </span>
  )
}
