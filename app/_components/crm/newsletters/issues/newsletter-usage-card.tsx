'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCrmNewsletterUsage } from '@/src/hooks/use-crm-newsletter-issues'
import { formatCount, formatUsageMonth } from './issue-format'

/**
 * Month's newsletter usage of the workspace (ADR 0054), for the newsletter
 * "Configurações" tab: e-mails sent in the São Paulo month against the
 * limit (plan or admin adjustment). Owned by nl-issues; nl-core mounts it.
 */
export function NewsletterUsageCard({
  workspaceId,
  className,
}: {
  workspaceId: string
  className?: string
}) {
  const usage = useCrmNewsletterUsage(workspaceId)

  if (usage.isError) return null
  if (!usage.data) return <Skeleton className={cn('h-24 w-full', className)} />

  const { emailsSent, limit, month } = usage.data
  const ratio = limit ? Math.min(1, emailsSent / limit) : 0
  const remaining = limit === null ? null : Math.max(0, limit - emailsSent)

  return (
    <section
      aria-label='Uso de e-mails da newsletter no mês'
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border p-4',
        className,
      )}
    >
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h3 className='font-medium text-sm'>
          E-mails de newsletter em {formatUsageMonth(month)}
        </h3>
        <span className='text-muted-foreground text-xs'>
          Vale para todas as newsletters do workspace
        </span>
      </div>
      <p className='text-sm'>
        <strong className='tabular-nums'>{formatCount(emailsSent)}</strong>{' '}
        enviados
        {limit === null ? (
          ' · sem limite mensal'
        ) : (
          <>
            {' '}
            de <span className='tabular-nums'>{formatCount(limit)}</span> ·
            restam{' '}
            <span className='tabular-nums'>{formatCount(remaining ?? 0)}</span>
          </>
        )}
      </p>
      {limit !== null ? (
        <div
          className='h-2 overflow-hidden rounded-full bg-muted'
          role='progressbar'
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={emailsSent}
          aria-label='Uso do limite mensal'
        >
          <div
            className={cn(
              'h-full rounded-full',
              ratio >= 1 ? 'bg-destructive' : 'bg-primary',
            )}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      ) : null}
      <p className='text-muted-foreground text-xs'>
        Envios de teste não contam. Um envio que não cabe no saldo do mês é
        recusado antes de começar.
      </p>
    </section>
  )
}
