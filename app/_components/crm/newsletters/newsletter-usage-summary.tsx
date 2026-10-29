'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCrmNewsletterUsage } from '@/src/hooks/use-crm-newsletter-issues'
import { formatCount } from './issues/issue-format'

/**
 * One-line monthly usage for every CRM member (read-only, ADR 0054):
 * "X de Y e-mails usados neste mês" on the newsletters list header. The
 * full card with the progress bar lives in the newsletter settings.
 */
export function NewsletterUsageSummary({
  workspaceId,
  className,
}: {
  workspaceId: string
  className?: string
}) {
  const usage = useCrmNewsletterUsage(workspaceId)

  if (usage.isError) return null
  if (!usage.data) {
    return <Skeleton className={cn('h-5 w-48', className)} />
  }

  const { emailsSent, limit } = usage.data
  const full = limit !== null && emailsSent >= limit
  const near = limit !== null && !full && emailsSent >= limit * 0.8
  return (
    <p
      className={cn(
        'text-sm tabular-nums',
        full ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
      title='Vale para todas as newsletters do workspace. Envios de teste não contam.'
    >
      {limit === null ? (
        <>
          <strong className='font-medium text-foreground'>
            {formatCount(emailsSent)}
          </strong>{' '}
          {emailsSent === 1 ? 'e-mail enviado' : 'e-mails enviados'} neste mês ·
          sem limite
        </>
      ) : (
        <>
          <strong
            className={cn(
              'font-medium',
              full ? 'text-destructive' : 'text-foreground',
            )}
          >
            {formatCount(emailsSent)}
          </strong>{' '}
          de {formatCount(limit)} e-mails usados neste mês
          {full ? ' · limite atingido' : near ? ' · perto do limite' : ''}
        </>
      )}
    </p>
  )
}
