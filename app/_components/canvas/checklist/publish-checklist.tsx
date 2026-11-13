'use client'

import {
  Alert02Icon,
  ArrowRight01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import {
  type PublishCheckItem,
  summarizePublishChecks,
} from '@/src/lib/canvas/checklist'

/**
 * Generic list of pre-publish checks, shared by the site, document and
 * e-mail editors. Errors come first and block; warnings only recommend.
 * Items with a target are buttons (`onPick`), the others plain rows.
 */
export function PublishChecklist({
  items,
  onPick,
  okTitle = 'Tudo certo para publicar',
  okText = 'Nenhum problema encontrado.',
  errorHint = 'Impede a publicação',
  warningHint = 'Recomendado corrigir',
  className,
}: {
  items: PublishCheckItem[]
  /** Called when an item that points somewhere is clicked. */
  onPick?: (item: PublishCheckItem) => void
  okTitle?: string
  okText?: string
  errorHint?: string
  warningHint?: string
  className?: string
}) {
  const summary = summarizePublishChecks(items)
  if (summary.items.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-3',
          className,
        )}
      >
        <SteelIcon
          icon={CheckmarkCircle02Icon}
          className='size-5 shrink-0 text-primary'
        />
        <div className='text-xs'>
          <p className='font-medium text-foreground'>{okTitle}</p>
          <p className='text-muted-foreground'>{okText}</p>
        </div>
      </div>
    )
  }
  const ordered = [...summary.errors, ...summary.warnings]
  return (
    <ul
      className={cn('flex flex-col gap-1', className)}
      aria-label='Itens do checklist'
      data-testid='publish-checklist'
    >
      {ordered.map((item, index) => {
        const error = item.level === 'error'
        const pickable = Boolean(onPick && (item.nodeId || item.documentId))
        const content = (
          <>
            <SteelIcon
              icon={error ? CancelCircleIcon : Alert02Icon}
              className={cn(
                'mt-px size-4 shrink-0',
                error ? 'text-destructive' : 'text-muted-foreground',
              )}
            />
            <span className='min-w-0 flex-1'>
              <span className='block text-foreground'>{item.message}</span>
              <span
                className={cn(
                  'text-[11px]',
                  error ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {item.documentName ? `${item.documentName} · ` : ''}
                {error ? errorHint : warningHint}
              </span>
            </span>
            {pickable ? (
              <SteelIcon
                icon={ArrowRight01Icon}
                className='mt-px size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'
              />
            ) : null}
          </>
        )
        const key = `${item.code}-${item.documentId ?? ''}-${item.nodeId ?? ''}-${index}`
        return (
          <li key={key} data-level={item.level}>
            {pickable ? (
              <button
                type='button'
                onClick={() => onPick?.(item)}
                className='group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'
              >
                {content}
              </button>
            ) : (
              <div className='flex items-start gap-2 px-2 py-1.5 text-xs'>
                {content}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
