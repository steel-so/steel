'use client'

import { Badge } from '@/components/ui/badge'
import { useCrmNewsletterAbTest } from '@/src/hooks/use-crm-newsletter-digest-ai'
import type { CrmNewsletterAbVariantStatsDTO } from '@/src/schemas/crm-newsletter-ab.schema'
import { formatIssueDateTime } from '../issue-format'

const pct = (value: number | null) =>
  value === null
    ? '—'
    : `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

function VariantRow({
  row,
  winner,
}: {
  row: CrmNewsletterAbVariantStatsDTO
  winner: boolean
}) {
  return (
    <div className='flex min-w-0 flex-col gap-2 rounded-lg border p-3'>
      <div className='flex min-w-0 items-start justify-between gap-2'>
        <p className='min-w-0 break-words text-sm'>
          <span className='mr-1.5 font-semibold'>{row.variant}</span>
          {row.subject}
        </p>
        {winner ? <Badge>Vencedor</Badge> : null}
      </div>
      <dl className='grid grid-cols-3 gap-2 text-xs'>
        <div>
          <dt className='text-muted-foreground'>Enviados</dt>
          <dd className='font-medium tabular-nums'>
            {row.sent.toLocaleString('pt-BR')}
          </dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>Abertura</dt>
          <dd className='font-medium tabular-nums'>{pct(row.openRate)}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>Clique</dt>
          <dd className='font-medium tabular-nums'>{pct(row.clickRate)}</dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * Subject A/B test card of the issue report (nl2-digest-ai): the two
 * variants of the test share, the winner once decided, or when it will be
 * picked. Renders nothing for issues without a test.
 */
export function IssueAbTestCard({
  workspaceId,
  newsletterId,
  issueId,
  live = false,
}: {
  workspaceId: string
  newsletterId: string
  issueId: string
  live?: boolean
}) {
  const report = useCrmNewsletterAbTest(
    workspaceId,
    newsletterId,
    issueId,
    live,
  )
  const data = report.data
  if (!data?.abTest || data.variants.length === 0) return null
  const { abTest } = data
  const metric =
    abTest.metric === 'CLICKS' ? 'taxa de clique' : 'taxa de abertura'
  return (
    <section className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'>
      <div className='min-w-0'>
        <h2 className='font-medium'>Teste A/B de assunto</h2>
        <p className='text-muted-foreground text-xs'>
          {abTest.winner
            ? `Vencedor escolhido por ${metric} em ${formatIssueDateTime(abTest.decidedAt)}; o resto da audiência recebeu o assunto ${abTest.winner}.`
            : `${abTest.testPercent}% da audiência no teste. O vencedor (por ${metric}) sai em ${formatIssueDateTime(abTest.decideAt)}${data.held > 0 ? ` e vai para ${data.held.toLocaleString('pt-BR')} assinantes` : ''}.`}
        </p>
      </div>
      <div className='grid min-w-0 gap-3 md:grid-cols-2'>
        {data.variants.map((row) => (
          <VariantRow
            key={row.variant}
            row={row}
            winner={abTest.winner === row.variant}
          />
        ))}
      </div>
    </section>
  )
}
