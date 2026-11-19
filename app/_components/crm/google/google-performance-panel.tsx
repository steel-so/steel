'use client'

import {
  Call02Icon,
  CursorPointer01Icon,
  Navigation03Icon,
  Search01Icon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { ResponsiveLine } from '@nivo/line'
import { useState } from 'react'
import {
  CHART_THEME,
  formatAxisLabel,
} from '@/app/_components/crm/social/chart-utils'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  useCrmGoogleKeywords,
  useCrmGooglePerformance,
  useReconnectOnAuthError,
} from '@/src/hooks/use-crm-google-presence'
import {
  GOOGLE_PERFORMANCE_RANGES,
  type GooglePerformanceRange,
  type GooglePerformanceTotalsDTO,
} from '@/src/schemas/crm-google-presence.schema'
import { formatDateTime, formatInt, percentChange } from './google-format'

const RANGE_LABELS: Record<GooglePerformanceRange, string> = {
  '7d': '7 dias',
  '28d': '28 dias',
  '90d': '90 dias',
}

type MetricKey = keyof GooglePerformanceTotalsDTO

const METRICS: {
  key: MetricKey
  label: string
  icon: typeof ViewIcon
  color: string
}[] = [
  {
    key: 'searchImpressions',
    label: 'Buscas no Google',
    icon: Search01Icon,
    color: '#2563eb',
  },
  {
    key: 'mapsImpressions',
    label: 'Visualizações no Maps',
    icon: ViewIcon,
    color: '#16a34a',
  },
  { key: 'callClicks', label: 'Ligações', icon: Call02Icon, color: '#f97316' },
  {
    key: 'directionRequests',
    label: 'Pedidos de rota',
    icon: Navigation03Icon,
    color: '#9333ea',
  },
  {
    key: 'websiteClicks',
    label: 'Cliques no site',
    icon: CursorPointer01Icon,
    color: '#0891b2',
  },
]

function Delta({ current, previous }: { current: number; previous: number }) {
  const change = percentChange(current, previous)
  if (change === null) {
    return (
      <span className='text-muted-foreground text-xs'>sem base anterior</span>
    )
  }
  return (
    <span
      className={cn(
        'text-xs',
        change > 0 && 'text-emerald-600 dark:text-emerald-400',
        change < 0 && 'text-rose-600 dark:text-rose-400',
        change === 0 && 'text-muted-foreground',
      )}
    >
      {change > 0 ? '+' : ''}
      {change}% vs. período anterior
    </span>
  )
}

/** Where the business shows up and what people do afterwards, per period. */
export function GooglePerformancePanel({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [range, setRange] = useState<GooglePerformanceRange>('28d')
  const [metric, setMetric] = useState<MetricKey>('searchImpressions')
  const performance = useCrmGooglePerformance(workspaceId, range, true)
  const keywords = useCrmGoogleKeywords(workspaceId, true)
  useReconnectOnAuthError(workspaceId, performance.error)

  const data = performance.data
  const active = METRICS.find((item) => item.key === metric) ?? METRICS[0]

  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='font-heading font-semibold text-lg tracking-tight'>
            Desempenho
          </h3>
          <p className='text-muted-foreground text-xs'>
            {data?.syncedAt
              ? `Atualizado em ${formatDateTime(data.syncedAt)}. O Google fecha os números com 2 a 3 dias de atraso.`
              : 'O Google fecha os números com 2 a 3 dias de atraso.'}
          </p>
        </div>
        <Tabs
          value={range}
          onValueChange={(value) => setRange(value as GooglePerformanceRange)}
        >
          <TabsList>
            {GOOGLE_PERFORMANCE_RANGES.map((value) => (
              <TabsTrigger key={value} value={value}>
                {RANGE_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {performance.isLoading ? (
        <>
          <div className='grid grid-cols-2 gap-3 lg:grid-cols-5'>
            {METRICS.map((item) => (
              <Skeleton key={item.key} className='h-24' />
            ))}
          </div>
          <Skeleton className='h-72 w-full' />
        </>
      ) : performance.error && !data ? (
        <div className='space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
          <p role='alert' className='text-destructive text-sm'>
            {performance.error.message}
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => performance.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : data ? (
        <>
          <div className='grid grid-cols-2 gap-3 lg:grid-cols-5'>
            {METRICS.map((item) => (
              <button
                key={item.key}
                type='button'
                aria-pressed={metric === item.key}
                onClick={() => setMetric(item.key)}
                className='text-left'
              >
                <Card
                  size='sm'
                  className={cn(
                    'h-full gap-1 px-4 py-3 transition-colors',
                    metric === item.key && 'ring-2 ring-primary/60',
                  )}
                >
                  <div className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                    <SteelIcon icon={item.icon} size={14} />
                    {item.label}
                  </div>
                  <span className='font-heading font-semibold text-2xl tabular-nums tracking-tight'>
                    {formatInt(data.totals[item.key])}
                  </span>
                  <Delta
                    current={data.totals[item.key]}
                    previous={data.previousTotals[item.key]}
                  />
                </Card>
              </button>
            ))}
          </div>

          <Card className='h-72 p-2 text-muted-foreground'>
            {data.hasData ? (
              <ResponsiveLine
                data={[
                  {
                    id: active.label,
                    data: data.series.map((point) => ({
                      x: point.date,
                      y: point[active.key],
                    })),
                  },
                ]}
                margin={{ top: 36, right: 20, bottom: 48, left: 52 }}
                colors={[active.color]}
                curve='monotoneX'
                enableArea
                areaOpacity={0.12}
                pointSize={range === '7d' ? 5 : range === '28d' ? 3 : 0}
                pointColor={{ from: 'color' }}
                useMesh
                xScale={{ type: 'point' }}
                yScale={{ type: 'linear', min: 0, max: 'auto' }}
                axisBottom={{
                  tickSize: 0,
                  tickPadding: 8,
                  tickRotation: -45,
                  tickValues:
                    range === '7d' ? undefined : range === '28d' ? 7 : 8,
                  format: formatAxisLabel,
                }}
                axisLeft={{ tickSize: 0, tickPadding: 8 }}
                theme={CHART_THEME}
              />
            ) : (
              <div className='flex h-full items-center justify-center px-6 text-center text-sm'>
                O Google ainda não informou números para este período. Perfis
                novos ou com pouca atividade podem levar alguns dias.
              </div>
            )}
          </Card>

          <div className='grid gap-4 lg:grid-cols-2'>
            <Card className='gap-3 px-5 py-5'>
              <h4 className='font-medium text-sm'>Onde seu negócio aparece</h4>
              <Surfaces surfaces={data.surfaces} />
            </Card>
            <Card className='gap-3 px-5 py-5'>
              <h4 className='font-medium text-sm'>
                Buscas que levaram até você
              </h4>
              {keywords.isLoading ? (
                <Skeleton className='h-32 w-full' />
              ) : keywords.error ? (
                <p className='text-muted-foreground text-sm'>
                  {keywords.error.message}
                </p>
              ) : (keywords.data ?? []).length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  O Google ainda não listou termos de busca para este local.
                </p>
              ) : (
                <ul className='divide-y divide-border/60'>
                  {(keywords.data ?? []).map((item) => (
                    <li
                      key={item.keyword}
                      className='flex items-center justify-between gap-3 py-1.5 text-sm'
                    >
                      <span className='min-w-0 truncate'>{item.keyword}</span>
                      <span className='shrink-0 text-muted-foreground tabular-nums'>
                        {item.approximate ? 'menos de ' : ''}
                        {formatInt(item.impressions)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className='text-muted-foreground text-xs'>
                Últimos 3 meses fechados, em aparições.
              </p>
            </Card>
          </div>
        </>
      ) : null}
    </section>
  )
}

function Surfaces({
  surfaces,
}: {
  surfaces: {
    mapsMobile: number
    mapsDesktop: number
    searchMobile: number
    searchDesktop: number
  }
}) {
  const rows = [
    { label: 'Maps no celular', value: surfaces.mapsMobile },
    { label: 'Maps no computador', value: surfaces.mapsDesktop },
    { label: 'Busca no celular', value: surfaces.searchMobile },
    { label: 'Busca no computador', value: surfaces.searchDesktop },
  ]
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  if (total === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        Sem aparições registradas no período.
      </p>
    )
  }
  return (
    <ul className='space-y-3'>
      {rows.map((row) => (
        <li key={row.label} className='space-y-1'>
          <div className='flex justify-between text-sm'>
            <span>{row.label}</span>
            <span className='text-muted-foreground tabular-nums'>
              {formatInt(row.value)} ({Math.round((row.value / total) * 100)}%)
            </span>
          </div>
          <div className='h-1.5 overflow-hidden rounded-full bg-muted'>
            <div
              className='h-full rounded-full bg-primary'
              style={{ width: `${(row.value / total) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
