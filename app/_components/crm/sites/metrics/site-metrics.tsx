'use client'

import {
  ArrowLeft01Icon,
  PencilEdit02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { ResponsiveLine } from '@nivo/line'
import Link from 'next/link'
import { type ReactNode, useMemo, useState } from 'react'
import {
  ChartLegend,
  ChartSkeleton,
  EmptyState,
  StatTile,
  Swatch,
  VIZ,
  VIZ_VARS,
} from '@/app/_components/steel-ai-usage/usage-charts'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCrmSite } from '@/src/hooks/use-crm-sites'
import { useSiteAnalytics } from '@/src/hooks/use-site-platform'
import { addDays, localDayOf } from '@/src/lib/sites/analytics'
import { DEFAULT_SITE_TIMEZONE } from '@/src/schemas/site.schema'
import type {
  SiteAnalyticsCountDTO,
  SiteAnalyticsDTO,
} from '@/types/site-platform'
import { SiteStatusBadge } from '../site-status-badge'
import { SiteCampaignsPanel } from './site-campaigns-panel'

/*
 * "Métricas" of a site. Colors follow the app's dataviz convention
 * (steel-ai-usage/usage-charts): visits are the accent series, visitors the
 * de-emphasis gray; bars are one hue (magnitude). Days are the site's own
 * (`YYYY-MM-DD` in its timezone) and are formatted from the string, never
 * through the browser's timezone.
 */

export const METRIC_PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
] as const

const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

/** "15 out" from `2026-10-15`. */
export function formatDay(day: string): string {
  const [, month, date] = day.split('-')
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? ''}`
}

const integer = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
})

export function formatCount(value: number): string {
  return integer.format(value)
}

/** "+12% vs. período anterior" / "sem dados anteriores". */
export function deltaText(current: number, previous: number): string {
  if (previous === 0) {
    return current === 0 ? 'Sem variação' : 'Sem dados no período anterior'
  }
  const change = (current - previous) / previous
  const sign = change > 0 ? '+' : ''
  return `${sign}${percent.format(change)} vs. período anterior`
}

const THEME = {
  text: { fill: 'currentColor', fontSize: 11 },
  axis: {
    ticks: { text: { fill: 'currentColor' }, line: { stroke: 'transparent' } },
    domain: { line: { stroke: 'currentColor', strokeOpacity: 0.15 } },
  },
  grid: { line: { stroke: 'currentColor', strokeOpacity: 0.08 } },
  crosshair: { line: { stroke: 'currentColor', strokeOpacity: 0.35 } },
} as const

function VisitsChart({ data }: { data: SiteAnalyticsDTO }) {
  const labels = data.days.map((day) => formatDay(day.date))
  const every = Math.max(1, Math.ceil(labels.length / 8))
  const series = [
    {
      id: 'views',
      label: 'Visitas',
      color: VIZ.mine,
      values: data.days.map((day) => day.views),
    },
    {
      id: 'visitors',
      label: 'Visitantes',
      color: VIZ.workspace,
      values: data.days.map((day) => day.visitors),
    },
  ]
  const names = new Map(series.map((s) => [s.id, s.label]))
  return (
    <div className='h-60 min-w-0 text-muted-foreground'>
      <ResponsiveLine
        data={series.map((s) => ({
          id: s.id,
          color: s.color,
          data: s.values.map((y, i) => ({ x: `${i}`, y })),
        }))}
        margin={{ top: 10, right: 16, bottom: 26, left: 40 }}
        colors={(s) => s.color as string}
        curve='monotoneX'
        lineWidth={2}
        pointSize={0}
        enableSlices='x'
        enableGridX={false}
        yScale={{ type: 'linear', min: 0, max: 'auto' }}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: labels
            .map((_, i) => `${i}`)
            .filter((_, i) => i % every === 0),
          format: (v) => labels[Number(v)] ?? '',
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: 4,
          format: (v) =>
            Number.isInteger(Number(v)) ? formatCount(Number(v)) : '',
        }}
        sliceTooltip={({ slice }) => (
          <div className='min-w-40 rounded-md border border-border bg-popover px-2.5 py-2 text-popover-foreground text-xs shadow-sm'>
            <p className='mb-1 font-medium'>
              {labels[Number(slice.points[0]?.data.x)] ?? ''}
            </p>
            {slice.points.map((point) => (
              <p key={point.id} className='flex items-center gap-2'>
                <Swatch color={point.seriesColor} />
                <span className='text-muted-foreground'>
                  {names.get(String(point.seriesId)) ?? point.seriesId}
                </span>
                <span className='ml-auto pl-3 font-medium tabular-nums'>
                  {formatCount(Number(point.data.y))}
                </span>
              </p>
            ))}
          </div>
        )}
        theme={THEME}
        role='img'
        ariaLabel='Visitas e visitantes por dia'
      />
    </div>
  )
}

/** One breakdown as labeled bars (the list is its own table view). */
export function CountBars({
  items,
  label,
  empty,
  keyLabel,
}: {
  items: SiteAnalyticsCountDTO[]
  label: string
  empty: string
  keyLabel: (item: SiteAnalyticsCountDTO) => ReactNode
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>
  const max = Math.max(...items.map((item) => item.views), 1)
  return (
    <ul aria-label={label} className='space-y-2.5'>
      {items.map((item) => (
        <li key={item.key ?? '∅'} className='space-y-1'>
          <div className='flex min-w-0 items-baseline gap-2 text-sm'>
            <span className='min-w-0 flex-1 truncate'>{keyLabel(item)}</span>
            <span className='shrink-0 font-medium tabular-nums'>
              {formatCount(item.views)}
            </span>
          </div>
          <div className='h-1.5 w-full rounded-sm bg-muted' aria-hidden>
            <div
              className='h-full rounded-r-sm'
              style={{
                width: `${Math.max(1, (item.views / max) * 100)}%`,
                backgroundColor: VIZ.mine,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Panel({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-xl border border-border/80 bg-card p-4',
        className,
      )}
    >
      <header className='mb-3'>
        <h2 className='font-medium text-sm'>{title}</h2>
        {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
      </header>
      {children}
    </section>
  )
}

const UTM_TABS = [
  { id: 'utmSources', label: 'Fonte' },
  { id: 'utmMediums', label: 'Meio' },
  { id: 'utmCampaigns', label: 'Campanha' },
] as const

function UtmPanel({ data }: { data: SiteAnalyticsDTO }) {
  const [tab, setTab] = useState<(typeof UTM_TABS)[number]['id']>('utmSources')
  return (
    <Panel title='Campanhas (UTM)' hint='Visitas com parâmetros utm_ no link.'>
      <div
        role='tablist'
        aria-label='Parâmetro UTM'
        className='mb-3 inline-flex rounded-md border p-0.5'
      >
        {UTM_TABS.map((item) => (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'rounded px-2.5 py-1 text-xs transition-colors',
              tab === item.id
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <CountBars
        items={data[tab]}
        label={`Visitas por ${UTM_TABS.find((item) => item.id === tab)?.label.toLowerCase()}`}
        empty='Nenhuma visita com UTM no período.'
        keyLabel={(item) => item.key}
      />
    </Panel>
  )
}

function ConversionsTable({ data }: { data: SiteAnalyticsDTO }) {
  if (data.conversionsByPage.length === 0) {
    return (
      <EmptyState>
        Nenhum formulário enviado no período. Adicione um formulário do CRM às
        páginas para medir conversões.
      </EmptyState>
    )
  }
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[22rem] text-sm'>
        <thead>
          <tr className='text-left text-muted-foreground text-xs'>
            <th className='pb-2 font-normal'>Página</th>
            <th className='pb-2 text-right font-normal'>Visitas</th>
            <th className='pb-2 text-right font-normal'>Envios</th>
            <th className='pb-2 text-right font-normal'>Taxa</th>
          </tr>
        </thead>
        <tbody>
          {data.conversionsByPage.map((row) => (
            <tr key={row.path} className='border-t'>
              <td className='max-w-0 truncate py-2 pr-2'>
                {row.label ?? row.path}
                {row.label ? (
                  <span className='ml-1.5 text-muted-foreground text-xs'>
                    {row.path}
                  </span>
                ) : null}
              </td>
              <td className='py-2 text-right tabular-nums'>
                {formatCount(row.views)}
              </td>
              <td className='py-2 text-right font-medium tabular-nums'>
                {formatCount(row.conversions)}
              </td>
              <td className='py-2 text-right tabular-nums'>
                {percent.format(row.rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MetricsBody({ data }: { data: SiteAnalyticsDTO }) {
  const { totals, previous } = data
  const previousRate =
    previous.views > 0 ? previous.conversions / previous.views : 0
  return (
    <div className='grid gap-4'>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <StatTile
          label='Visitas'
          value={formatCount(totals.views)}
          detail={deltaText(totals.views, previous.views)}
        />
        <StatTile
          label='Visitantes'
          value={formatCount(totals.visitors)}
          detail={deltaText(totals.visitors, previous.visitors)}
        />
        <StatTile
          label='Formulários enviados'
          value={formatCount(totals.conversions)}
          detail={deltaText(totals.conversions, previous.conversions)}
        />
        <StatTile
          label='Taxa de conversão'
          value={percent.format(totals.conversionRate)}
          detail={`${percent.format(previousRate)} no período anterior`}
        />
      </div>

      <Panel
        title='Visitas por dia'
        hint={`De ${formatDay(data.from)} a ${formatDay(data.to)} · fuso ${data.timezone}`}
      >
        <div className='mb-2'>
          <ChartLegend
            items={[
              { label: 'Visitas', color: VIZ.mine },
              { label: 'Visitantes', color: VIZ.workspace },
            ]}
          />
        </div>
        {totals.views === 0 ? (
          <EmptyState>Ainda não há visitas neste período.</EmptyState>
        ) : (
          <VisitsChart data={data} />
        )}
      </Panel>

      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel title='Páginas mais vistas'>
          <CountBars
            items={data.topPages}
            label='Visitas por página'
            empty='Nenhuma visita no período.'
            keyLabel={(item) => (
              <>
                {item.label ?? item.key}
                {item.label ? (
                  <span className='ml-1.5 text-muted-foreground text-xs'>
                    {item.key}
                  </span>
                ) : null}
              </>
            )}
          />
        </Panel>
        <Panel title='Origens' hint='Site de onde o visitante veio.'>
          <CountBars
            items={data.referrers}
            label='Visitas por origem'
            empty='Nenhuma visita no período.'
            keyLabel={(item) => item.key ?? 'Acesso direto'}
          />
        </Panel>
        <UtmPanel data={data} />
        <Panel
          title='Conversões por página'
          hint='Formulários do CRM enviados em cada página.'
        >
          <ConversionsTable data={data} />
        </Panel>
      </div>
      <SiteCampaignsPanel data={data} />
      <p className='text-muted-foreground text-xs'>
        Métricas anônimas: o visitante é contado por um código diário gerado no
        servidor, sem cookies. Com o aviso de cookies ligado, só conta quem
        aceitou.
      </p>
    </div>
  )
}

function MetricsSkeleton() {
  return (
    <div className='grid gap-4' aria-busy='true'>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className='h-20 rounded-xl' />
        ))}
      </div>
      <ChartSkeleton className='h-72' />
    </div>
  )
}

/** "Métricas" screen of one site. */
export function SiteMetrics({
  workspaceId,
  slug,
  siteId,
  now,
}: {
  workspaceId: string
  slug: string
  siteId: string
  /** Injected in tests. */
  now?: Date
}) {
  const { site } = useCrmSite(workspaceId, siteId)
  const canEdit = useCan('landing-pages', 'EDIT')
  const [days, setDays] = useState<number>(30)
  const [today] = useState(() => now ?? new Date())
  const timezone = site.data?.settings.timezone ?? DEFAULT_SITE_TIMEZONE
  const range = useMemo(() => {
    const to = localDayOf(today, timezone)
    return { from: addDays(to, -(days - 1)), to }
  }, [today, timezone, days])
  const analytics = useSiteAnalytics(workspaceId, siteId, range)

  return (
    <div
      className={cn('mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-6', VIZ_VARS)}
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <Link
            href={`/${slug}/crm/sites`}
            aria-label='Voltar para os sites'
            className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
          >
            <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
          </Link>
          <div className='min-w-0'>
            <h1 className='truncate font-semibold text-lg'>
              {site.data?.name ?? 'Métricas'}
            </h1>
            <p className='truncate text-muted-foreground text-xs'>
              Métricas do site
            </p>
          </div>
          {site.data ? <SiteStatusBadge status={site.data.status} /> : null}
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <fieldset className='inline-flex rounded-md border p-0.5'>
            <legend className='sr-only'>Período</legend>
            {METRIC_PERIODS.map((period) => (
              <button
                key={period.days}
                type='button'
                aria-pressed={days === period.days}
                onClick={() => setDays(period.days)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs transition-colors',
                  days === period.days
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {period.label}
              </button>
            ))}
          </fieldset>
          {canEdit ? (
            <Button
              size='sm'
              variant='outline'
              nativeButton={false}
              render={<Link href={`/${slug}/crm/sites/${siteId}`} />}
            >
              <SteelIcon icon={PencilEdit02Icon} data-icon='inline-start' />
              Abrir editor
            </Button>
          ) : null}
        </div>
      </div>
      {site.data?.status === 'DRAFT' ? (
        <p className='rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-sm'>
          Este site ainda não foi publicado: as visitas começam a contar depois
          da primeira publicação.
        </p>
      ) : null}
      {analytics.error ? (
        <EmptyState>
          Não foi possível carregar as métricas. Tente novamente em instantes.
        </EmptyState>
      ) : analytics.data ? (
        <MetricsBody data={analytics.data} />
      ) : (
        <MetricsSkeleton />
      )}
    </div>
  )
}
