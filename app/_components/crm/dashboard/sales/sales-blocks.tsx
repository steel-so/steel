'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ChampionIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type * as React from 'react'
import { useDashboardDisplay } from '@/app/_components/crm/dashboard/dashboard-display'
import { SteelIcon } from '@/components/icon/icon'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type {
  SalesMetricOf,
  SalesPerson,
} from '@/src/schemas/crm-sales-metrics.schema'
import {
  firstName,
  formatAgo,
  formatBrl,
  formatChange,
  formatDays,
  formatInt,
  formatPct,
  initialsOf,
} from './sales-format'
import {
  podiumTone,
  SALES_TONE,
  SALES_TONE_FILL,
  SALES_TONE_RING,
  SALES_TONE_TEXT,
} from './sales-tone'

/*
 * Blocos do kit de Vendas. Tudo escala com o tamanho do bloco (container
 * query em `cqmin`): o mesmo componente fica legível num card de 300 px no
 * editor e a 5 m de distância numa TV 1080p ou 4K.
 */

/**
 * Tamanho de fonte que acompanha o bloco: `clamp(min, cq·cqmin, max)`. No
 * modo TV os limites crescem (`--sales-scale`): um bloco baixo continua
 * legível a 5 m.
 */
function fluid(min: number, cq: number, max: number): React.CSSProperties {
  return {
    fontSize: `clamp(calc(${min}rem * var(--sales-scale, 1)), ${cq}cqmin, calc(${max}rem * var(--sales-scale, 1)))`,
  }
}

/** Escala dos limites de fonte no modo TV. */
const TV_SCALE = 1.7

function Shell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const { variant } = useDashboardDisplay()
  return (
    <div
      className={cn('flex h-full min-h-0 flex-col', className)}
      style={
        {
          containerType: 'size',
          ...(variant === 'tv' ? { '--sales-scale': TV_SCALE } : {}),
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}

/** Estado vazio que diz ao time o que preencher. */
export function SalesEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <Shell className='items-center justify-center gap-1 px-3 text-center'>
      <p
        className='font-medium text-muted-foreground'
        style={fluid(0.85, 6, 2.2)}
      >
        {title}
      </p>
      {hint ? (
        <p className='text-muted-foreground/80' style={fluid(0.75, 4.5, 1.6)}>
          {hint}
        </p>
      ) : null}
    </Shell>
  )
}

function PersonAvatar({
  person,
  className,
  ringClass,
}: {
  person: SalesPerson | null
  className?: string
  ringClass?: string
}) {
  const name = person?.name ?? 'Sem responsável'
  return (
    <Avatar
      className={cn(
        'shrink-0',
        ringClass && 'ring-2 ring-offset-2 ring-offset-card',
        ringClass,
        className,
      )}
    >
      {person?.image ? <AvatarImage src={person.image} alt='' /> : null}
      <AvatarFallback className='font-semibold'>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

function Trend({
  change,
  lowerIsBetter = false,
}: {
  change: number | null
  lowerIsBetter?: boolean
}) {
  if (change === null) return null
  const good = lowerIsBetter ? change <= 0 : change >= 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums',
        SALES_TONE[good ? 'up' : 'down'],
      )}
      style={fluid(0.7, 4, 1.4)}
    >
      <SteelIcon
        icon={change >= 0 ? ArrowUp01Icon : ArrowDown01Icon}
        className='size-[1em]'
      />
      {formatChange(change)}
    </span>
  )
}

function Stat({
  label,
  value,
  tone,
  testId,
}: {
  label: string
  value: string
  tone?: keyof typeof SALES_TONE_TEXT
  testId?: string
}) {
  return (
    <div className='min-w-0'>
      <p
        className='truncate text-muted-foreground uppercase tracking-wide'
        style={fluid(0.62, 3.6, 1.2)}
      >
        {label}
      </p>
      <p
        data-testid={testId}
        className={cn(
          'truncate font-semibold tabular-nums leading-tight',
          tone ? SALES_TONE_TEXT[tone] : 'text-foreground',
        )}
        style={fluid(0.95, 7.5, 3)}
      >
        {value}
      </p>
    </div>
  )
}

/* ------------------------------- meta do mês ------------------------------- */

export function GoalBlock({ metric }: { metric: SalesMetricOf<'goal'> }) {
  const won = formatBrl(metric.wonAmount, true)
  const deals = `${formatInt(metric.wonCount)} ${metric.wonCount === 1 ? 'negócio ganho' : 'negócios ganhos'}`

  if (metric.targetAmount === null) {
    return (
      <Shell className='justify-center gap-2 px-2'>
        <p className='text-muted-foreground' style={fluid(0.75, 4.5, 1.6)}>
          Ganho em {metric.period.label}
        </p>
        <p
          data-testid='sales-goal-won'
          className='font-semibold text-foreground tabular-nums leading-none'
          style={fluid(1.8, 20, 8)}
        >
          {won}
        </p>
        <p className='text-muted-foreground' style={fluid(0.75, 4.5, 1.6)}>
          {deals}
        </p>
        <p
          className={cn('mt-1 rounded-md px-2 py-1', SALES_TONE.warn)}
          style={fluid(0.7, 4, 1.4)}
        >
          Cadastre as metas do período (CRM › Previsão) para ver o % da meta e o
          ritmo.
        </p>
      </Shell>
    )
  }

  const pct = metric.pct ?? 0
  const hit = metric.wonAmount >= metric.targetAmount
  const tone = metric.onTrack ? 'up' : 'down'
  const expected =
    metric.businessDays.total > 0
      ? Math.min(
          100,
          (metric.businessDays.elapsed / metric.businessDays.total) * 100,
        )
      : 0

  return (
    <Shell className='justify-between gap-2 px-2 py-1'>
      <div className='flex items-end justify-between gap-3'>
        <div className='min-w-0'>
          <p
            data-testid='sales-goal-won'
            className='truncate font-semibold text-foreground tabular-nums leading-none'
            style={fluid(1.6, 13, 6)}
          >
            {won}
          </p>
          <p
            className='mt-1 truncate text-muted-foreground'
            style={fluid(0.72, 4.2, 1.5)}
          >
            de {formatBrl(metric.targetAmount, true)} · {deals}
          </p>
        </div>
        <p
          data-testid='sales-goal-pct'
          className={cn(
            'font-semibold tabular-nums leading-none',
            SALES_TONE_TEXT[tone],
          )}
          style={fluid(1.4, 11, 5)}
        >
          {formatPct(pct)}
        </p>
      </div>

      <div
        className='relative h-[clamp(0.6rem,5cqmin,2rem)] overflow-hidden rounded-full bg-muted'
        role='progressbar'
        aria-label='Progresso da meta'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(100, pct))}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-700',
            SALES_TONE_FILL[tone],
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        {!hit && expected > 0 ? (
          <div
            className='absolute inset-y-0 w-0.5 bg-foreground/70'
            style={{ left: `${expected}%` }}
            title='Onde a meta deveria estar hoje'
          />
        ) : null}
      </div>

      {hit ? (
        <p
          className={cn(
            'rounded-md px-2 py-1 text-center font-semibold',
            SALES_TONE.up,
          )}
          style={fluid(0.85, 6, 2.4)}
        >
          Meta batida!
        </p>
      ) : (
        <div className='space-y-2'>
          <div className='grid grid-cols-3 gap-x-4'>
            <Stat
              label='Falta'
              value={formatBrl(metric.remaining ?? 0, true)}
            />
            <Stat
              label='Úteis restantes'
              value={formatInt(metric.businessDays.left)}
            />
            <Stat
              label='Por dia útil'
              value={
                metric.requiredPerDay === null
                  ? '—'
                  : formatBrl(metric.requiredPerDay, true)
              }
            />
          </div>
          {metric.paceAmount !== null ? (
            <p
              data-testid='sales-goal-pace'
              className={cn('truncate font-semibold', SALES_TONE_TEXT[tone])}
              style={fluid(0.8, 5.5, 2.2)}
            >
              No ritmo atual, fecha o mês em{' '}
              {formatBrl(metric.paceAmount, true)}
            </p>
          ) : null}
        </div>
      )}
    </Shell>
  )
}

/* -------------------------------- ranking -------------------------------- */

export function RankingBlock({ metric }: { metric: SalesMetricOf<'ranking'> }) {
  if (metric.rows.length === 0) {
    return (
      <SalesEmpty
        title={`Nenhuma venda ganha em ${metric.period.label} ainda.`}
        hint='Defina o responsável das oportunidades e cadastre as metas para montar o ranking.'
      />
    )
  }
  const onlyUnassigned = metric.rows.every((row) => row.owner.id === null)
  const top = Math.max(...metric.rows.map((row) => row.wonAmount), 1)

  return (
    <Shell className='gap-1 overflow-hidden'>
      <ol className='flex min-h-0 flex-1 flex-col justify-around gap-1'>
        {metric.rows.map((row) => {
          const podium = podiumTone(row.position)
          const share = row.pct ?? (row.wonAmount / top) * 100
          return (
            <li
              key={row.owner.id ?? 'none'}
              data-testid='sales-ranking-row'
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1',
                podium === 'gold' && 'bg-muted/60',
              )}
            >
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums',
                  podium ? SALES_TONE[podium] : 'text-muted-foreground',
                )}
                style={{
                  width: '1.8em',
                  height: '1.8em',
                  ...fluid(0.7, 4.5, 1.6),
                }}
              >
                {row.position}º
              </span>
              <PersonAvatar
                person={row.owner}
                ringClass={podium ? SALES_TONE_RING[podium] : undefined}
                className='size-[clamp(1.5rem,9cqmin,3.5rem)]'
              />
              <div className='min-w-0 flex-1'>
                <div className='flex items-baseline justify-between gap-2'>
                  <span
                    className='truncate font-medium text-foreground'
                    style={fluid(0.78, 5, 1.9)}
                  >
                    {row.owner.name}
                  </span>
                  <span
                    className='shrink-0 font-semibold tabular-nums'
                    style={fluid(0.78, 5, 1.9)}
                  >
                    {formatBrl(row.wonAmount, true)}
                  </span>
                </div>
                <div className='mt-0.5 flex items-center gap-2'>
                  <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-muted'>
                    <div
                      className={cn(
                        'h-full rounded-full',
                        row.pct !== null && row.pct >= 100
                          ? SALES_TONE_FILL.up
                          : 'bg-primary/70',
                      )}
                      style={{ width: `${Math.min(100, share)}%` }}
                    />
                  </div>
                  <span
                    className='shrink-0 text-muted-foreground tabular-nums'
                    style={fluid(0.65, 3.6, 1.3)}
                  >
                    {row.pct === null
                      ? 'sem meta'
                      : `${formatPct(row.pct)} da meta`}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      {onlyUnassigned ? (
        <p
          className='text-center text-muted-foreground'
          style={fluid(0.65, 3.6, 1.3)}
        >
          Defina o responsável das oportunidades para ranquear o time.
        </p>
      ) : null}
    </Shell>
  )
}

/* ------------------------------ pipeline ------------------------------ */

export function PipelineBlock({
  metric,
}: {
  metric: SalesMetricOf<'pipeline'>
}) {
  if (!metric.pipeline) {
    return (
      <SalesEmpty
        title='Nenhum pipeline no CRM.'
        hint='Crie um pipeline com etapas (Ganho/Perdido) em CRM › Pipelines.'
      />
    )
  }
  if (metric.stages.length === 0) {
    return (
      <SalesEmpty
        title='Este pipeline não tem etapas abertas.'
        hint='Configure as etapas em CRM › Pipelines.'
      />
    )
  }
  const max = Math.max(...metric.stages.map((stage) => stage.amount), 1)
  return (
    <Shell className='gap-2'>
      <div className='flex flex-wrap items-baseline justify-between gap-x-3'>
        <span
          className='truncate text-muted-foreground'
          style={fluid(0.7, 4, 1.4)}
        >
          {metric.pipeline.name} · {formatInt(metric.totals.count)} abertas
        </span>
        <span
          className='font-semibold tabular-nums'
          style={fluid(0.85, 5.5, 2.2)}
        >
          {formatBrl(metric.totals.weightedAmount, true)}{' '}
          <span className='font-normal text-muted-foreground'>
            ponderado de {formatBrl(metric.totals.amount, true)}
          </span>
        </span>
      </div>
      <ul className='flex min-h-0 flex-1 flex-col justify-around gap-1'>
        {metric.stages.map((stage) => (
          <li
            key={stage.id}
            data-testid='sales-pipeline-stage'
            className='min-w-0'
          >
            <div className='flex items-baseline justify-between gap-2'>
              <span
                className='truncate text-foreground'
                style={fluid(0.72, 4.4, 1.7)}
              >
                {stage.name}{' '}
                <span className='text-muted-foreground'>
                  · {formatInt(stage.count)} · {stage.probability}%
                </span>
              </span>
              <span
                className='shrink-0 font-medium tabular-nums'
                style={fluid(0.72, 4.4, 1.7)}
              >
                {formatBrl(stage.weightedAmount, true)}
              </span>
            </div>
            <div className='relative mt-0.5 h-[clamp(0.4rem,3cqmin,1.2rem)] overflow-hidden rounded-full bg-muted'>
              <div
                className='absolute inset-y-0 left-0 rounded-full bg-primary/25'
                style={{ width: `${(stage.amount / max) * 100}%` }}
              />
              <div
                className='absolute inset-y-0 left-0 rounded-full bg-primary'
                style={{ width: `${(stage.weightedAmount / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

/* ------------------------------- previsão ------------------------------- */

export function ForecastBlock({
  metric,
}: {
  metric: SalesMetricOf<'forecast'>
}) {
  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: 'Ganho', value: metric.wonAmount },
    { label: 'Comprometido (≥ 70%)', value: metric.commitAmount, strong: true },
    { label: 'Ponderado', value: metric.weightedAmount },
    { label: 'Melhor cenário', value: metric.bestCaseAmount },
  ]
  const max = Math.max(metric.bestCaseAmount, metric.targetAmount ?? 0, 1)
  const targetAt = metric.targetAmount
    ? (metric.targetAmount / max) * 100
    : null
  return (
    <Shell className='gap-1'>
      <p
        className='truncate text-muted-foreground'
        style={fluid(0.68, 3.8, 1.35)}
      >
        {metric.period.label} · {formatInt(metric.openCount)} abertas fechando
        no período
        {metric.targetAmount
          ? ` · meta ${formatBrl(metric.targetAmount, true)}`
          : ''}
      </p>
      <ul className='flex min-h-0 flex-1 flex-col justify-around gap-1'>
        {rows.map((row) => (
          <li key={row.label}>
            <div className='flex items-baseline justify-between gap-2'>
              <span
                className='truncate text-muted-foreground'
                style={fluid(0.7, 4.2, 1.5)}
              >
                {row.label}
              </span>
              <span
                className={cn(
                  'shrink-0 tabular-nums',
                  row.strong ? 'font-semibold text-foreground' : 'font-medium',
                )}
                style={fluid(0.8, row.strong ? 6.5 : 5, row.strong ? 2.6 : 2)}
              >
                {formatBrl(row.value, true)}
              </span>
            </div>
            <div className='relative mt-0.5 h-1.5 rounded-full bg-muted'>
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  row.strong ? 'bg-primary' : 'bg-primary/50',
                )}
                style={{ width: `${(row.value / max) * 100}%` }}
              />
              {targetAt !== null ? (
                <div
                  className='absolute -inset-y-1 w-0.5 bg-foreground/70'
                  style={{ left: `${Math.min(99.5, targetAt)}%` }}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

/* ------------------------------- conversão ------------------------------- */

function rateChange(current: number | null, previous: number | null) {
  return current === null || previous === null ? null : current - previous
}

function FunnelStep({
  label,
  value,
  previous,
  previousLabel,
  testId,
}: {
  label: string
  value: number | null
  previous: number | null
  previousLabel: string
  testId: string
}) {
  const change = rateChange(value, previous)
  return (
    <div className='min-w-0'>
      <p className='truncate text-muted-foreground' style={fluid(0.68, 4, 1.4)}>
        {label}
      </p>
      <div className='flex flex-wrap items-baseline gap-x-2'>
        <span
          data-testid={testId}
          className='font-semibold text-foreground tabular-nums leading-tight'
          style={fluid(1.1, 10, 4)}
        >
          {formatPct(value)}
        </span>
        {change !== null ? (
          <span
            className={cn(
              'font-medium tabular-nums',
              SALES_TONE_TEXT[change >= 0 ? 'up' : 'down'],
            )}
            style={fluid(0.65, 3.8, 1.4)}
          >
            {change >= 0 ? '+' : '−'}
            {formatPct(Math.abs(change)).replace('%', ' p.p.')}
          </span>
        ) : null}
      </div>
      <p
        className='truncate text-muted-foreground'
        style={fluid(0.6, 3.2, 1.15)}
      >
        {previousLabel}: {formatPct(previous)}
      </p>
    </div>
  )
}

export function ConversionBlock({
  metric,
}: {
  metric: SalesMetricOf<'conversion'>
}) {
  const { current, previous } = metric
  if (current.leads === 0 && current.opportunities === 0) {
    return (
      <SalesEmpty
        title={`Sem leads nem oportunidades em ${current.label}.`}
        hint='Registre os leads no CRM para acompanhar a conversão.'
      />
    )
  }
  return (
    <Shell className='justify-around gap-2'>
      <p
        className='truncate text-muted-foreground'
        style={fluid(0.68, 3.8, 1.35)}
      >
        {formatInt(current.leads)} leads → {formatInt(current.opportunities)}{' '}
        oportunidades → {formatInt(current.opportunitiesWon)} ganhas
      </p>
      <FunnelStep
        label='Lead → oportunidade'
        value={current.leadToOpportunityPct}
        previous={previous.leadToOpportunityPct}
        previousLabel={previous.label}
        testId='sales-conversion-lead'
      />
      <FunnelStep
        label='Oportunidade → ganho'
        value={current.opportunityToWonPct}
        previous={previous.opportunityToWonPct}
        previousLabel={previous.label}
        testId='sales-conversion-won'
      />
    </Shell>
  )
}

/* ---------------------------- ticket e ciclo ---------------------------- */

export function DealStatsBlock({
  metric,
}: {
  metric: SalesMetricOf<'deal-stats'>
}) {
  if (metric.current.wins === 0 && metric.previous.wins === 0) {
    return (
      <SalesEmpty
        title='Sem negócios ganhos para calcular.'
        hint='Mova as oportunidades fechadas para uma etapa de Ganho.'
      />
    )
  }
  return (
    <Shell className='justify-around gap-2'>
      <div>
        <p className='text-muted-foreground' style={fluid(0.68, 4, 1.4)}>
          Ticket médio
        </p>
        <div className='flex flex-wrap items-baseline gap-2'>
          <span
            data-testid='sales-ticket'
            className='font-semibold tabular-nums leading-tight'
            style={fluid(1.1, 10, 4)}
          >
            {metric.current.averageTicket === null
              ? '—'
              : formatBrl(metric.current.averageTicket, true)}
          </span>
          <Trend change={metric.ticketChangePct} />
        </div>
      </div>
      <div>
        <p className='text-muted-foreground' style={fluid(0.68, 4, 1.4)}>
          Ciclo médio (criação → ganho)
        </p>
        <div className='flex flex-wrap items-baseline gap-2'>
          <span
            data-testid='sales-cycle'
            className='font-semibold tabular-nums leading-tight'
            style={fluid(1.1, 10, 4)}
          >
            {formatDays(metric.current.averageCycleDays)}
          </span>
          <Trend change={metric.cycleChangePct} lowerIsBetter />
        </div>
      </div>
      <p
        className='truncate text-muted-foreground'
        style={fluid(0.6, 3.2, 1.15)}
      >
        vs. {metric.previous.label}
      </p>
    </Shell>
  )
}

/* ------------------------------- parados ------------------------------- */

export function StalledBlock({ metric }: { metric: SalesMetricOf<'stalled'> }) {
  if (metric.total === 0) {
    return (
      <SalesEmpty
        title={`Nenhum negócio parado há ${metric.days}+ dias.`}
        hint='Toda oportunidade aberta teve atividade recente.'
      />
    )
  }
  return (
    <Shell className='gap-1'>
      <p className='truncate' style={fluid(0.72, 4.4, 1.6)}>
        <span
          className={cn('font-semibold tabular-nums', SALES_TONE_TEXT.warn)}
        >
          {formatInt(metric.total)} parados
        </span>{' '}
        <span className='text-muted-foreground'>
          há {metric.days}+ dias · {formatBrl(metric.totalAmount, true)}
        </span>
      </p>
      <ul className='flex min-h-0 flex-1 flex-col gap-1 overflow-hidden'>
        {metric.rows.map((row) => (
          <li
            key={row.id}
            data-testid='sales-stalled-row'
            className='flex min-w-0 items-center gap-2'
          >
            <PersonAvatar
              person={row.owner}
              className='size-[clamp(1.25rem,7cqmin,2.75rem)]'
            />
            <div className='min-w-0 flex-1'>
              <p
                className='truncate text-foreground'
                style={fluid(0.72, 4.4, 1.6)}
              >
                {row.name}
                {row.companyName ? (
                  <span className='text-muted-foreground'>
                    {' '}
                    · {row.companyName}
                  </span>
                ) : null}
              </p>
              <p
                className='truncate text-muted-foreground'
                style={fluid(0.62, 3.5, 1.25)}
              >
                {row.stageName}
                {row.amount !== null ? ` · ${formatBrl(row.amount, true)}` : ''}
              </p>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 font-semibold tabular-nums',
                SALES_TONE.warn,
              )}
              style={fluid(0.65, 3.8, 1.4)}
            >
              {row.idleDays} dias
            </span>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

/* ------------------------------- propostas ------------------------------- */

function expiryLabel(days: number | null): string {
  if (days === null) return 'sem validade'
  if (days === 0) return 'vence hoje'
  if (days === 1) return 'vence amanhã'
  return `vence em ${days} dias`
}

export function ProposalsBlock({
  metric,
}: {
  metric: SalesMetricOf<'proposals'>
}) {
  if (metric.waitingCount === 0) {
    return (
      <SalesEmpty
        title='Nenhuma proposta aguardando resposta.'
        hint='Propostas enviadas e visualizadas pelo cliente aparecem aqui.'
      />
    )
  }
  return (
    <Shell className='gap-1'>
      <p className='truncate' style={fluid(0.72, 4.4, 1.6)}>
        <span className='font-semibold tabular-nums'>
          {formatInt(metric.waitingCount)} aguardando
        </span>
        {metric.expiringThisWeekCount > 0 ? (
          <span className={cn('font-semibold', SALES_TONE_TEXT.warn)}>
            {' '}
            · {formatInt(metric.expiringThisWeekCount)} vencem esta semana
          </span>
        ) : null}
      </p>
      <ul className='flex min-h-0 flex-1 flex-col gap-1 overflow-hidden'>
        {metric.rows.map((row) => (
          <li
            key={row.id}
            data-testid='sales-proposal-row'
            className='flex min-w-0 items-center gap-2'
          >
            <PersonAvatar
              person={row.responsible}
              className='size-[clamp(1.25rem,7cqmin,2.75rem)]'
            />
            <div className='min-w-0 flex-1'>
              <p
                className='truncate text-foreground'
                style={fluid(0.72, 4.4, 1.6)}
              >
                {row.name}
              </p>
              <p
                className='truncate text-muted-foreground'
                style={fluid(0.62, 3.5, 1.25)}
              >
                {[
                  row.companyName,
                  row.status === 'VIEWED' ? 'vista pelo cliente' : 'enviada',
                  row.amount !== null ? formatBrl(row.amount, true) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 font-medium',
                row.expiringThisWeek
                  ? SALES_TONE.warn
                  : 'bg-muted text-muted-foreground',
              )}
              style={fluid(0.62, 3.6, 1.35)}
            >
              {expiryLabel(row.expiresInDays)}
            </span>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

/* ------------------------------ placar do dia ------------------------------ */

export function ScoreboardBlock({
  metric,
}: {
  metric: SalesMetricOf<'scoreboard'>
}) {
  const tiles = [
    { label: 'Vendas hoje', value: formatInt(metric.winsToday), id: 'wins' },
    {
      label: 'Valor hoje',
      value: formatBrl(metric.amountToday, true),
      id: 'amount',
    },
    {
      label: 'Reuniões',
      value: formatInt(metric.meetingsToday),
      id: 'meetings',
    },
    {
      label: 'Atividades',
      value: formatInt(metric.activitiesToday),
      id: 'activities',
    },
    {
      label: 'Leads novos',
      value: formatInt(metric.newLeadsToday),
      id: 'leads',
    },
  ]
  return (
    <Shell className='gap-1'>
      <div className='grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2'>
        {tiles.map((tile) => (
          <div
            key={tile.id}
            className='flex min-w-0 flex-col justify-center rounded-lg bg-muted/50 px-3 py-1'
          >
            <p
              className='truncate text-muted-foreground uppercase tracking-wide'
              style={fluid(0.6, 7, 1.3)}
            >
              {tile.label}
            </p>
            <p
              data-testid={`sales-scoreboard-${tile.id}`}
              className='truncate font-semibold text-foreground tabular-nums leading-tight'
              style={fluid(1, 22, 4.2)}
            >
              {tile.value}
            </p>
          </div>
        ))}
      </div>
      {metric.leadsBySource.length > 0 ? (
        <p
          className='truncate text-muted-foreground'
          style={fluid(0.62, 6, 1.3)}
        >
          Leads por origem:{' '}
          {metric.leadsBySource
            .map((entry) => `${entry.source} (${formatInt(entry.count)})`)
            .join(' · ')}
        </p>
      ) : null}
    </Shell>
  )
}

/* ------------------------------ feed de vitórias ------------------------------ */

/** "Ana fechou R$ 18.400 com Empresa X" — a frase da vitória. */
export function winSentence(
  row: SalesMetricOf<'wins-feed'>['rows'][number],
): string {
  const who = row.owner ? firstName(row.owner.name) : 'O time'
  const amount = row.amount !== null ? ` ${formatBrl(row.amount)}` : ''
  const target = row.companyName ?? row.opportunityName
  return `${who} fechou${amount} com ${target}`
}

export function WinsFeedBlock({
  metric,
  now,
  freshIds,
}: {
  metric: SalesMetricOf<'wins-feed'>
  now: Date
  /** Vitórias que acabaram de chegar (ganham destaque animado). */
  freshIds?: Set<string>
}) {
  if (metric.rows.length === 0) {
    return (
      <SalesEmpty
        title='Nenhuma vitória nos últimos 30 dias.'
        hint='Quando uma oportunidade for para uma etapa de Ganho, ela aparece aqui na hora.'
      />
    )
  }
  return (
    <Shell className='gap-1 overflow-hidden'>
      <ul className='flex min-h-0 flex-1 flex-col gap-1.5'>
        {metric.rows.map((row) => {
          const fresh = freshIds?.has(row.id) ?? false
          return (
            <li
              key={row.id}
              data-testid='sales-win-row'
              data-fresh={fresh || undefined}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1',
                fresh &&
                  cn(
                    SALES_TONE.gold,
                    'motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:animate-in motion-safe:duration-700',
                  ),
              )}
            >
              <SteelIcon
                icon={ChampionIcon}
                strokeWidth={2}
                aria-hidden
                className={cn('shrink-0', SALES_TONE_TEXT.gold)}
                style={{
                  width: '1.4em',
                  height: '1.4em',
                  ...fluid(0.9, 6, 2.2),
                }}
              />
              <PersonAvatar
                person={row.owner}
                className='size-[clamp(1.25rem,8cqmin,3rem)]'
              />
              <div className='min-w-0 flex-1'>
                <p
                  className='line-clamp-2 font-medium text-foreground leading-tight'
                  style={fluid(0.72, 4.6, 1.7)}
                >
                  {winSentence(row)}
                </p>
                <p
                  className='truncate text-muted-foreground'
                  style={fluid(0.6, 3.4, 1.2)}
                >
                  {row.opportunityName} · {formatAgo(row.wonAt, now)}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </Shell>
  )
}
