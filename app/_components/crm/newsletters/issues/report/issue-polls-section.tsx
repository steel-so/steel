'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  crmNewsletterPollsExportUrl,
  useCrmNewsletterIssuePolls,
} from '@/src/hooks/use-crm-newsletter-engage'
import type { CrmNewsletterPollReportDTO } from '@/src/schemas/crm-newsletter-engage.schema'
import { formatCount, formatIssueDateTime, formatRate } from '../issue-format'

/** CRM person page (opens the record panel). */
export function personHref(slug: string, personId: string): string {
  return `/${slug}/crm/people?record=${encodeURIComponent(personId)}`
}

function PollCard({
  poll,
  slug,
}: {
  poll: CrmNewsletterPollReportDTO
  slug: string
}) {
  const top = Math.max(0, ...poll.options.map((option) => option.votes))
  return (
    <article className='flex min-w-0 flex-col gap-4 rounded-xl border p-4'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <h3 className='min-w-0 break-words font-medium text-sm'>
          {poll.question || 'Enquete sem pergunta'}
        </h3>
        <div className='flex items-center gap-2'>
          {!poll.showResults ? (
            <Badge variant='outline'>Resultado oculto para leitores</Badge>
          ) : null}
          <span className='text-muted-foreground text-xs tabular-nums'>
            {poll.totalVotes === 1
              ? '1 voto'
              : `${formatCount(poll.totalVotes)} votos`}
          </span>
        </div>
      </div>
      <ul className='flex flex-col gap-2.5' aria-label='Votos por opção'>
        {poll.options.map((option) => (
          <li key={option.index} className='flex flex-col gap-1'>
            <div className='flex items-baseline justify-between gap-3 text-sm'>
              <span className='min-w-0 break-words'>{option.label}</span>
              <span className='shrink-0 tabular-nums'>
                <strong>{formatCount(option.votes)}</strong>{' '}
                <span className='text-muted-foreground text-xs'>
                  {formatRate(option.votes, poll.totalVotes)}
                </span>
              </span>
            </div>
            <div className='h-2 overflow-hidden rounded-full bg-muted'>
              <div
                className={
                  option.votes > 0 && option.votes === top
                    ? 'h-full rounded-full bg-primary'
                    : 'h-full rounded-full bg-primary/50'
                }
                style={{
                  width:
                    poll.totalVotes > 0
                      ? `${(option.votes / poll.totalVotes) * 100}%`
                      : '0%',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      {poll.voters.length > 0 ? (
        <div className='flex min-w-0 flex-col gap-2'>
          <h4 className='font-medium text-muted-foreground text-xs'>
            Quem votou
            {poll.votersTruncated ? ' (mais recentes — o CSV traz todos)' : ''}
          </h4>
          <div className='max-h-80 overflow-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assinante</TableHead>
                  <TableHead>Opção</TableHead>
                  <TableHead>Quando</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poll.voters.map((voter) => (
                  <TableRow key={voter.id}>
                    <TableCell className='max-w-64'>
                      {voter.personId ? (
                        <Link
                          href={personHref(slug, voter.personId)}
                          className='block truncate font-medium hover:underline'
                        >
                          {voter.name || voter.email}
                        </Link>
                      ) : (
                        <span className='block truncate'>
                          {voter.name || voter.email}
                        </span>
                      )}
                      {voter.name ? (
                        <span className='block truncate text-muted-foreground text-xs'>
                          {voter.email}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='max-w-48 text-sm'>
                      <span className='block truncate'>
                        {poll.options[voter.optionIndex]?.label ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground text-sm'>
                      {formatIssueDateTime(voter.votedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>Nenhum voto ainda.</p>
      )}
    </article>
  )
}

/**
 * "Enquetes" of the issue report (nl2-engage): votes per option, the
 * latest voters (linked to the CRM person when there is one) and the CSV
 * with every vote. Renders nothing when the issue has no poll.
 */
export function IssuePollsSection({
  workspaceId,
  slug,
  newsletterId,
  issueId,
  live = false,
}: {
  workspaceId: string
  slug: string
  newsletterId: string
  issueId: string
  live?: boolean
}) {
  const polls = useCrmNewsletterIssuePolls(
    workspaceId,
    newsletterId,
    issueId,
    live,
  )
  if (polls.isLoading) return <Skeleton className='h-40 w-full' />
  if (!polls.data || polls.data.polls.length === 0) return null
  const voted = polls.data.polls.some((poll) => poll.totalVotes > 0)
  return (
    <section
      aria-label='Enquetes'
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='font-medium text-sm'>Enquetes</h2>
        {voted ? (
          <a
            href={crmNewsletterPollsExportUrl(
              workspaceId,
              newsletterId,
              issueId,
            )}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            <SteelIcon icon={Download01Icon} />
            Exportar votos (CSV)
          </a>
        ) : null}
      </div>
      <div className='grid min-w-0 gap-3 lg:grid-cols-2'>
        {polls.data.polls.map((poll) => (
          <PollCard key={poll.blockId} poll={poll} slug={slug} />
        ))}
      </div>
    </section>
  )
}
