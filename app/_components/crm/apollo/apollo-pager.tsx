'use client'

import { Button } from '@/components/ui/button'

/** Previous/next with the position; Apollo caps previews at 500 pages. */
export function ApolloPager({
  page,
  totalPages,
  totalEntries,
  disabled,
  onPage,
}: {
  page: number
  totalPages: number
  totalEntries: number
  disabled?: boolean
  onPage: (page: number) => void
}) {
  const last = Math.max(1, Math.min(totalPages, 500))
  return (
    <div className='flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm'>
      <span className='text-muted-foreground'>
        {totalEntries.toLocaleString('pt-BR')} resultado
        {totalEntries === 1 ? '' : 's'} · página {page} de {last}
      </span>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Anterior
        </Button>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={disabled || page >= last}
          onClick={() => onPage(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  )
}
