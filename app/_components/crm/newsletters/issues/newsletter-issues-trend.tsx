'use client'

import { useCrmNewsletterIssueTrend } from '@/src/hooks/use-crm-newsletter-issues'
import { formatIssueDate, formatRatio } from './issue-format'

/**
 * Overview of the newsletter: open and click rates of the last sent issues
 * (oldest → newest), one pair of bars per issue. Hidden until the first
 * issue is sent.
 */
export function NewsletterIssuesTrend({
  workspaceId,
  newsletterId,
}: {
  workspaceId: string
  newsletterId: string
}) {
  const trend = useCrmNewsletterIssueTrend(workspaceId, newsletterId)
  const issues = trend.data?.issues ?? []
  if (issues.length === 0) return null

  const last = issues[issues.length - 1]
  const opens = issues
    .map((issue) => issue.openRate)
    .filter((value): value is number => value !== null)
  const average =
    opens.length > 0
      ? opens.reduce((sum, value) => sum + value, 0) / opens.length
      : null

  return (
    <section
      aria-label='Evolução das últimas edições'
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 className='font-medium text-sm'>Últimas edições</h2>
        <p className='text-muted-foreground text-xs'>
          Abertura média {formatRatio(average)} · última{' '}
          {formatRatio(last.openRate)} de abertura e{' '}
          {formatRatio(last.clickRate)} de clique
        </p>
      </div>
      <ol className='flex h-28 items-end gap-1.5 overflow-x-auto'>
        {issues.map((issue) => {
          const open = Math.round((issue.openRate ?? 0) * 100)
          const click = Math.round((issue.clickRate ?? 0) * 100)
          const label = `${issue.number ? `#${issue.number} ` : ''}${issue.subject} — ${formatIssueDate(issue.sentAt)}: abertura ${formatRatio(issue.openRate)}, clique ${formatRatio(issue.clickRate)}`
          return (
            <li
              key={issue.id}
              title={label}
              aria-label={label}
              className='flex h-full min-w-6 flex-1 items-end justify-center gap-0.5'
            >
              <span
                className='w-2.5 rounded-t-sm bg-primary'
                style={{ height: `${Math.max(open, 2)}%` }}
              />
              <span
                className='w-2.5 rounded-t-sm bg-muted-foreground/40'
                style={{ height: `${Math.max(click, 2)}%` }}
              />
            </li>
          )
        })}
      </ol>
      <div className='flex gap-4 text-muted-foreground text-xs'>
        <span className='flex items-center gap-1.5'>
          <span className='size-2.5 rounded-sm bg-primary' /> Abertura
        </span>
        <span className='flex items-center gap-1.5'>
          <span className='size-2.5 rounded-sm bg-muted-foreground/40' /> Clique
        </span>
      </div>
    </section>
  )
}
