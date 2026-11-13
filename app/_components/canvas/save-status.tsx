'use client'

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SaveStatusValue = 'idle' | 'saving' | 'saved' | 'error'

/** Small "Salvo / Salvando / Erro" indicator shared by the builders. */
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
  return (
    <output
      aria-live='polite'
      className={cn(
        'flex items-center gap-1.5 text-xs',
        status === 'error' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {status === 'saving' ? (
        <>
          <SteelIcon
            icon={Loading03Icon}
            strokeWidth={2}
            size={14}
            className='animate-spin'
          />
          Salvando…
        </>
      ) : null}
      {status === 'saved' ? (
        <>
          <SteelIcon icon={CheckmarkCircle02Icon} strokeWidth={2} size={14} />
          Salvo
        </>
      ) : null}
      {status === 'error' ? (
        <>
          <SteelIcon icon={AlertCircleIcon} strokeWidth={2} size={14} />
          Não foi possível salvar
          {onRetry ? (
            <Button variant='ghost' size='xs' onClick={onRetry}>
              Tentar de novo
            </Button>
          ) : null}
        </>
      ) : null}
    </output>
  )
}
