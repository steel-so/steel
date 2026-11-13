'use client'

import { CheckmarkCircle02Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type OnboardingChecklistItem = {
  key: string
  title: string
  description: string
  href: string
  actionLabel: string
  done: boolean
  /** Still loading: the step is shown but not marked as pending/done. */
  loading?: boolean
}

/**
 * First-steps card for empty modules. Presentational: the module wrappers
 * (`CrmOnboardingChecklist`, `ZapOnboardingChecklist`) decide which steps are
 * done. Renders nothing once every step is done.
 */
export function OnboardingChecklist({
  title,
  description,
  items,
  className,
}: {
  title: string
  description: string
  items: OnboardingChecklistItem[]
  className?: string
}) {
  const settled = items.filter((item) => !item.loading)
  if (settled.length === items.length && items.every((item) => item.done)) {
    return null
  }
  const doneCount = items.filter((item) => item.done).length

  return (
    <section
      aria-label={title}
      className={cn(
        'w-full max-w-xl rounded-xl border bg-card p-5 text-left shadow-sm',
        className,
      )}
    >
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='font-semibold text-sm'>{title}</h2>
          <p className='text-muted-foreground text-xs'>{description}</p>
        </div>
        <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs tabular-nums'>
          {doneCount} de {items.length}
        </span>
      </div>
      <ol className='flex flex-col gap-2'>
        {items.map((item) => (
          <li
            key={item.key}
            className='flex items-center gap-3 rounded-lg border p-3'
          >
            {item.done ? (
              <SteelIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={2}
                className='size-5 shrink-0 text-emerald-600'
              />
            ) : (
              <span
                aria-hidden='true'
                className='size-5 shrink-0 rounded-full border-2 border-muted-foreground/40'
              />
            )}
            <div className='min-w-0 flex-1'>
              <p
                className={cn(
                  'font-medium text-sm',
                  item.done && 'text-muted-foreground line-through',
                )}
              >
                {item.title}
              </p>
              <p className='text-muted-foreground text-xs'>
                {item.description}
              </p>
            </div>
            {item.done || item.loading ? null : (
              <Link
                href={item.href}
                className={buttonVariants({ size: 'xs', variant: 'outline' })}
              >
                {item.actionLabel}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
