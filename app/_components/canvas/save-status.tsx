'use client'

import { cn } from '@/lib/utils'

export type SaveStatusValue = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Shared "Salvo / Salvando / Erro" indicator for every editor top bar.
 * Renders nothing visible while idle, but keeps the live region mounted so
 * screen readers announce the next change.
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
  return (
    <span
      role='status'
      aria-live='polite'
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs',
        status === 'error' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {status === 'saving' ? 'Salvando…' : null}
      {status === 'saved' ? 'Salvo' : null}
      {status === 'error' ? (
        <>
          Não foi possível salvar
          {onRetry ? (
            <button
              type='button'
              onClick={onRetry}
              className='underline underline-offset-2 hover:no-underline'
            >
              Tentar de novo
            </button>
          ) : null}
        </>
      ) : null}
    </span>
  )
}
