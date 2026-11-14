'use client'

import { AlertCircleIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import type { CanvasDraft } from './lib/draft-recovery'

/** Offer to bring back the copy kept locally after a failed save. */
export function DraftBanner({
  draft,
  onRestore,
  onDiscard,
}: {
  draft: CanvasDraft
  onRestore: () => void
  onDiscard: () => void
}) {
  const when = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(draft.savedAt)
  return (
    <div
      role='alert'
      data-testid='canvas-draft-banner'
      className='flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted px-3 py-2 text-xs'
    >
      <SteelIcon
        icon={AlertCircleIcon}
        className='size-4 shrink-0 text-muted-foreground'
      />
      <span className='min-w-0 flex-1'>
        Encontramos alterações de {when} que não chegaram a ser salvas. Deseja
        recuperá-las?
      </span>
      <button
        type='button'
        onClick={onRestore}
        className='rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
      >
        Recuperar
      </button>
      <button
        type='button'
        onClick={onDiscard}
        className='rounded-md px-2.5 py-1 font-medium hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
      >
        Descartar
      </button>
    </div>
  )
}
