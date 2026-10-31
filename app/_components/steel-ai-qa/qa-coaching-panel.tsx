'use client'

import { useMemo, useState } from 'react'
import { EmptyState } from '@/app/_components/steel-ai-usage/usage-charts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useQaCoaching } from '@/src/hooks/use-qa-review'
import type { QaCoachingAgentDTO } from '@/types/qa-review'
import { formatQaDay, QA_SUBJECT_LABEL } from './qa-format'
import { QaReviewDialog } from './qa-review-dialog'
import { QaScoreBadge } from './qa-score-badge'

const PERIODS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
] as const

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-xl border bg-card px-4 py-3'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='font-semibold text-xl tabular-nums'>{value}</p>
    </div>
  )
}

function Trend({ agent }: { agent: QaCoachingAgentDTO }) {
  if (agent.trend.length < 2) return null
  return (
    <div>
      <p className='mb-1 text-muted-foreground text-xs'>Evolução por semana</p>
      <ul className='flex items-end gap-1.5' aria-label='Evolução por semana'>
        {agent.trend.map((point) => (
          <li
            key={point.weekStart}
            className='flex flex-1 flex-col items-center gap-0.5'
            title={`Semana de ${formatQaDay(point.weekStart)}: ${point.average} (${point.reviews})`}
          >
            <span className='text-[10px] text-muted-foreground tabular-nums'>
              {point.average}
            </span>
            <div
              className='w-full rounded-sm bg-primary/70'
              style={{ height: `${Math.max(4, point.average * 0.5)}px` }}
            />
            <span className='text-[10px] text-muted-foreground'>
              {formatQaDay(point.weekStart)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AgentCard({
  agent,
  onOpen,
}: {
  agent: QaCoachingAgentDTO
  onOpen: (reviewId: string) => void
}) {
  return (
    <li className='space-y-3 rounded-xl border bg-card px-4 py-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{agent.agentName}</span>
        <QaScoreBadge
          score={agent.averageScore}
          lowScore={agent.lowScoreCount > 0 && agent.averageScore < 60}
        />
        <span className='text-muted-foreground text-xs'>
          {agent.reviews} {agent.reviews === 1 ? 'avaliação' : 'avaliações'}
          {agent.lowScoreCount > 0
            ? ` · ${agent.lowScoreCount} com nota baixa`
            : ''}
        </span>
      </div>

      {agent.byCriterion.length > 0 ? (
        <ul className='grid gap-1.5 sm:grid-cols-2'>
          {agent.byCriterion.map((criterion) => (
            <li
              key={criterion.key}
              className='flex items-center gap-2 text-sm'
            >
              <span className='min-w-0 flex-1 truncate'>{criterion.name}</span>
              <div className='h-1.5 w-24 overflow-hidden rounded-full bg-muted'>
                <div
                  className='h-full rounded-full bg-primary'
                  style={{ width: `${criterion.average}%` }}
                />
              </div>
              <span className='w-7 text-right text-xs tabular-nums'>
                {criterion.average}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {agent.weakestCriterion ? (
        <p className='text-sm'>
          Ponto a melhorar:{' '}
          <Badge variant='secondary'>{agent.weakestCriterion.name}</Badge>
        </p>
      ) : null}

      <Trend agent={agent} />

      {agent.topTips.length > 0 ? (
        <div className='space-y-1'>
          <p className='font-medium text-sm'>Dicas que mais se repetem</p>
          <ul className='list-disc space-y-0.5 pl-5 text-sm'>
            {agent.topTips.map((tip) => (
              <li key={tip.tip}>
                {tip.tip}
                {tip.count > 1 ? (
                  <span className='text-muted-foreground'> ({tip.count}×)</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {agent.lowest.length > 0 ? (
        <div className='space-y-1'>
          <p className='font-medium text-sm'>Piores avaliações</p>
          <ul className='space-y-1'>
            {agent.lowest.map((review) => (
              <li key={review.id}>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal'
                  onClick={() => onOpen(review.id)}
                >
                  <QaScoreBadge score={review.score} lowScore={review.lowScore} />
                  <span className='min-w-0 flex-1 truncate text-left'>
                    {review.subjectLabel ?? QA_SUBJECT_LABEL[review.subjectType]}
                    {review.customerName ? ` · ${review.customerName}` : ''}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  )
}

/** Coaching: who needs help first, with the weakest criterion and the tips. */
export function QaCoachingPanel({ workspaceId }: { workspaceId: string }) {
  const [days, setDays] = useState<string>('30')
  const [openId, setOpenId] = useState<string | null>(null)
  // The clock is read once: a moving `to` would change the query key forever.
  const [now] = useState(() => Date.now())
  const params = useMemo(
    () => ({
      from: new Date(now - Number(days) * 86_400_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
    }),
    [days, now],
  )
  const coaching = useQaCoaching(workspaceId, params)
  const data = coaching.data

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select value={days} onValueChange={(value) => value && setDays(value)}>
          <SelectTrigger className='w-48' aria-label='Período'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PERIODS.map((period) => (
                <SelectItem key={period.value} value={period.value}>
                  {period.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {coaching.isLoading ? (
        <div className='space-y-3'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-40 w-full' />
        </div>
      ) : coaching.isError || !data ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar o painel de coaching.
        </p>
      ) : data.reviews === 0 ? (
        <EmptyState>
          Nenhuma avaliação no período. Com o QA ligado, cada conversa
          encerrada e cada chamado resolvido é avaliado automaticamente.
        </EmptyState>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
            <Tile label='Atendimentos avaliados' value={String(data.reviews)} />
            <Tile
              label='Nota média'
              value={data.averageScore === null ? '—' : String(data.averageScore)}
            />
            <Tile label='Notas baixas' value={String(data.lowScoreCount)} />
            <Tile
              label='Bot × humano'
              value={`${data.botAverage ?? '—'} × ${data.humanAverage ?? '—'}`}
            />
          </div>
          <ul className='grid gap-3'>
            {data.agents.map((agent) => (
              <AgentCard
                key={agent.agentUserId ?? 'bot'}
                agent={agent}
                onOpen={setOpenId}
              />
            ))}
          </ul>
        </>
      )}

      <QaReviewDialog
        workspaceId={workspaceId}
        reviewId={openId}
        onClose={() => setOpenId(null)}
      />
    </div>
  )
}
