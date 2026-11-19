'use client'

import { useMemo, useState } from 'react'
import {
  formatCount,
  formatDay,
} from '@/app/_components/crm/sites/metrics/site-metrics'
import {
  ChartSkeleton,
  EmptyState,
  StatTile,
  VIZ,
  VIZ_VARS,
} from '@/app/_components/steel-ai-usage/usage-charts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useBioLinkAnalytics } from '@/src/hooks/use-bio-links'
import { BIO_ANALYTICS_DAYS } from '@/src/schemas/bio-link.schema'
import type { BioCountDTO, BioLinkAnalyticsDTO } from '@/types/bio-link'

const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
})

const DEVICE_LABELS: Record<string, string> = {
  mobile: 'Celular',
  desktop: 'Computador',
  tablet: 'Tablet',
  unknown: 'Não identificado',
}

let countryNames: Intl.DisplayNames | null = null
function countryName(code: string): string {
  try {
    countryNames ??= new Intl.DisplayNames(['pt-BR'], { type: 'region' })
    return countryNames.of(code) ?? code
  } catch {
    return code
  }
}

function Panel({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-xl border border-border/80 bg-card p-4',
        className,
      )}
    >
      <h3 className='font-medium text-sm'>{title}</h3>
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
      <div className='mt-3'>{children}</div>
    </section>
  )
}

function Bars({
  items,
  label,
  empty,
}: {
  items: { key: string; label: string; count: number }[]
  label: string
  empty: string
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>
  const max = Math.max(...items.map((item) => item.count), 1)
  return (
    <ul aria-label={label} className='space-y-2.5'>
      {items.map((item) => (
        <li key={item.key} className='space-y-1'>
          <div className='flex min-w-0 items-baseline gap-2 text-sm'>
            <span className='min-w-0 flex-1 truncate' title={item.label}>
              {item.label}
            </span>
            <span className='shrink-0 font-medium tabular-nums'>
              {formatCount(item.count)}
            </span>
          </div>
          <div className='h-1.5 w-full rounded-sm bg-muted' aria-hidden>
            <div
              className='h-full rounded-r-sm'
              style={{
                width: `${Math.max(1, (item.count / max) * 100)}%`,
                backgroundColor: VIZ.mine,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function counts(
  rows: BioCountDTO[],
  fallback: string,
  format: (key: string) => string = (key) => key,
) {
  return rows.map((row) => ({
    key: row.key ?? '∅',
    label: row.key ? format(row.key) : fallback,
    count: row.count,
  }))
}

/** Daily visits (gray) and clicks (blue) as paired bars, with a table for
 * assistive tech. */
function DailyChart({ data }: { data: BioLinkAnalyticsDTO }) {
  const max = Math.max(...data.daily.flatMap((d) => [d.views, d.clicks]), 1)
  const every = Math.max(1, Math.ceil(data.daily.length / 8))
  return (
    <div>
      <div className='mb-2 flex flex-wrap gap-4 text-muted-foreground text-xs'>
        <span className='flex items-center gap-1.5'>
          <span
            className='size-2.5 rounded-sm'
            style={{ background: VIZ.workspace }}
          />
          Visitas
        </span>
        <span className='flex items-center gap-1.5'>
          <span
            className='size-2.5 rounded-sm'
            style={{ background: VIZ.mine }}
          />
          Cliques
        </span>
      </div>
      <div
        role='img'
        aria-label={`Visitas e cliques por dia, de ${formatDay(data.from)} a ${formatDay(data.to)}`}
        className='flex h-44 items-end gap-px'
      >
        {data.daily.map((day, index) => (
          <div
            key={day.day}
            title={`${formatDay(day.day)}: ${day.views} visitas, ${day.clicks} cliques`}
            className='flex h-full min-w-0 flex-1 flex-col justify-end'
          >
            <div className='flex flex-1 items-end justify-center gap-px'>
              <span
                className='w-full max-w-3 rounded-t-sm'
                style={{
                  height: `${(day.views / max) * 100}%`,
                  minHeight: day.views > 0 ? 2 : 0,
                  background: VIZ.workspace,
                }}
              />
              <span
                className='w-full max-w-3 rounded-t-sm'
                style={{
                  height: `${(day.clicks / max) * 100}%`,
                  minHeight: day.clicks > 0 ? 2 : 0,
                  background: VIZ.mine,
                }}
              />
            </div>
            <span className='mt-1 h-4 truncate text-center text-[10px] text-muted-foreground'>
              {index % every === 0 ? formatDay(day.day) : ''}
            </span>
          </div>
        ))}
      </div>
      <table className='sr-only'>
        <caption>Visitas e cliques por dia</caption>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Visitas</th>
            <th>Cliques</th>
          </tr>
        </thead>
        <tbody>
          {data.daily.map((day) => (
            <tr key={day.day}>
              <td>{formatDay(day.day)}</td>
              <td>{day.views}</td>
              <td>{day.clicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Visits, clicks, click rate, per-link ranking and where visitors come
 * from, for a period of 7, 30 or 90 days. */
export function BioMetricsPanel({
  workspaceId,
  bioLinkId,
}: {
  workspaceId: string
  bioLinkId: string
}) {
  const [days, setDays] = useState<number>(30)
  const query = useBioLinkAnalytics(workspaceId, bioLinkId, days)
  const data = query.data

  const links = useMemo(
    () =>
      (data?.links ?? []).map((link) => ({
        key: link.linkId,
        label: link.exists ? link.title : `${link.title} (removido)`,
        count: link.clicks,
      })),
    [data],
  )

  return (
    <div className={cn('grid gap-4', VIZ_VARS)}>
      <fieldset className='m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0'>
        <legend className='sr-only'>Período</legend>
        {BIO_ANALYTICS_DAYS.map((option) => (
          <Button
            key={option}
            type='button'
            size='sm'
            variant={days === option ? 'default' : 'outline'}
            aria-pressed={days === option}
            onClick={() => setDays(option)}
          >
            {option} dias
          </Button>
        ))}
      </fieldset>

      {query.isLoading ? (
        <ChartSkeleton className='h-64' />
      ) : query.error || !data ? (
        <div className='rounded-xl border p-6 text-center'>
          <p className='text-muted-foreground text-sm'>
            Não foi possível carregar as métricas.
          </p>
          <Button
            className='mt-3'
            size='sm'
            variant='outline'
            onClick={() => void query.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
            <StatTile label='Visitas' value={formatCount(data.totals.views)} />
            <StatTile
              label='Visitantes únicos'
              value={formatCount(data.totals.visitors)}
              detail='Contados por dia, sem cookies'
            />
            <StatTile label='Cliques' value={formatCount(data.totals.clicks)} />
            <StatTile
              label='Taxa de cliques'
              value={percent.format(data.totals.clickRate)}
              detail='Cliques por visita'
            />
          </div>

          {data.totals.views === 0 && data.totals.clicks === 0 ? (
            <EmptyState>
              Ainda não há visitas no período. Publique a página e coloque o
              endereço na bio das suas redes.
            </EmptyState>
          ) : (
            <Panel title='Por dia'>
              <DailyChart data={data} />
            </Panel>
          )}

          <div className='grid gap-4 lg:grid-cols-2'>
            <Panel
              title='Cliques por link'
              hint='Quanto cada botão levou os visitantes para fora da página.'
              className='lg:col-span-2'
            >
              <Bars
                items={links}
                label='Cliques por link'
                empty='Nenhum link na página ainda.'
              />
            </Panel>
            <Panel
              title='Origem das visitas'
              hint='Site de onde o visitante veio.'
            >
              <Bars
                items={counts(data.referrers, 'Acesso direto')}
                label='Origem das visitas'
                empty='Sem dados no período.'
              />
            </Panel>
            <Panel
              title='Campanhas (UTM)'
              hint='Valor de utm_source nos endereços divulgados.'
            >
              <Bars
                items={counts(data.sources, 'Sem campanha')}
                label='Campanhas'
                empty='Sem dados no período.'
              />
            </Panel>
            <Panel title='Países'>
              <Bars
                items={counts(data.countries, 'Não identificado', countryName)}
                label='Países'
                empty='Sem dados no período.'
              />
            </Panel>
            <Panel title='Dispositivos'>
              <Bars
                items={counts(
                  data.devices,
                  'Não identificado',
                  (key) => DEVICE_LABELS[key] ?? key,
                )}
                label='Dispositivos'
                empty='Sem dados no período.'
              />
            </Panel>
          </div>
          <p className='text-muted-foreground text-xs'>
            Métricas anônimas: sem cookies, sem guardar o IP. O visitante vira
            um código que muda todo dia e o país vem do endereço de rede no
            momento do acesso. Dias contados no horário de Brasília.
          </p>
        </>
      )}
    </div>
  )
}
