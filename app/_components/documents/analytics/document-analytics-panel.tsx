'use client'

import { ResponsiveBar } from '@nivo/bar'
import { type ReactNode, useState } from 'react'
import {
  ChartSkeleton,
  EmptyState,
  StatTile,
  Swatch,
  VIZ,
  VIZ_VARS,
} from '@/app/_components/steel-ai-usage/usage-charts'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useDocumentAnalytics } from '@/src/hooks/use-document-analytics'
import { REMOVED_SECTION_NAME } from '@/src/mappers/document-analytics.mapper'
import type { DocumentAnalyticsPeriod } from '@/src/schemas/document-analytics.schema'
import type { DocumentAnalyticsDTO } from '@/types/document'
import {
  biggestDropOff,
  deviceLabel,
  formatCount,
  formatDay,
  formatDuration,
  formatRate,
  formatSeenAt,
  readerName,
  visitorTag,
} from './document-analytics-format'

/**
 * Reading analytics of a document (owned by the documents analytics slice):
 * total and per-section time, readers, revisits, devices, drop-off.
 * The props are the contract used by the document page.
 *
 * Colors follow the app's dataviz convention (steel-ai-usage/usage-charts):
 * time is the accent series, reach the de-emphasis gray; bars are one hue
 * (magnitude). Text never wears the series colors.
 */
export interface DocumentAnalyticsPanelProps {
  workspaceId: string
  documentId: string
  /** Templates show the aggregate of the documents created from them. */
  isTemplate?: boolean
}

export const DOCUMENT_ANALYTICS_PERIOD_OPTIONS: {
  value: DocumentAnalyticsPeriod
  label: string
}[] = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: 'all', label: 'Tudo' },
]

/** Bar width in %, with a visible sliver for any non-zero value. */
export function barWidth(value: number, max: number): string {
  if (value <= 0 || max <= 0) return '0%'
  return `${Math.max(1, Math.min(100, (value / max) * 100))}%`
}

const THEME = {
  text: { fill: 'currentColor', fontSize: 11 },
  axis: {
    ticks: { text: { fill: 'currentColor' }, line: { stroke: 'transparent' } },
    domain: { line: { stroke: 'currentColor', strokeOpacity: 0.15 } },
  },
  grid: { line: { stroke: 'currentColor', strokeOpacity: 0.08 } },
} as const

function Panel({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: ReactNode
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
        <h3 className='font-medium text-sm'>{title}</h3>
        {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
      </header>
      {children}
    </section>
  )
}

function PeriodPicker({
  value,
  onChange,
}: {
  value: DocumentAnalyticsPeriod
  onChange: (value: DocumentAnalyticsPeriod) => void
}) {
  return (
    <div
      role='tablist'
      aria-label='Período'
      className='inline-flex rounded-md border p-0.5'
    >
      {DOCUMENT_ANALYTICS_PERIOD_OPTIONS.map((option) => (
        <button
          key={option.value}
          type='button'
          role='tab'
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs transition-colors',
            value === option.value
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Totals({ totals }: { totals: DocumentAnalyticsDTO['totals'] }) {
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6'>
      <StatTile
        label='Tempo total'
        value={formatDuration(totals.totalActiveMs)}
        detail={`${formatCount(totals.sessions)} ${
          totals.sessions === 1 ? 'sessão' : 'sessões'
        }`}
      />
      <StatTile
        label='Tempo médio'
        value={formatDuration(totals.avgActiveMs)}
        detail='por sessão'
      />
      <StatTile
        label='Leitores únicos'
        value={formatCount(totals.uniqueVisitors)}
        detail='navegadores diferentes'
      />
      <StatTile
        label='Chegaram ao fim'
        value={formatRate(totals.completionRate)}
        detail={`rolagem média de ${totals.avgScrollPct}%`}
      />
      <StatTile
        label='Revisitas'
        value={formatCount(totals.revisits)}
        detail='voltaram a abrir'
      />
      <StatTile
        label='Encaminhamentos'
        value={formatCount(totals.forwards)}
        detail='link pessoal em outro navegador'
      />
    </div>
  )
}

function SectionBars({
  sections,
}: {
  sections: DocumentAnalyticsDTO['sections']
}) {
  if (sections.length === 0) {
    return (
      <EmptyState>
        Este documento ainda não tem seções. Organize o conteúdo em seções no
        editor para ver o tempo de leitura de cada parte.
      </EmptyState>
    )
  }
  const max = Math.max(...sections.map((section) => section.avgActiveMs), 1)
  return (
    <div className='space-y-3'>
      <ul className='flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs'>
        <li className='inline-flex items-center gap-1.5'>
          <Swatch color={VIZ.mine} />
          Tempo médio de quem viu
        </li>
        <li className='inline-flex items-center gap-1.5'>
          <Swatch color={VIZ.workspace} />
          Alcance (sessões que chegaram à seção)
        </li>
      </ul>
      <ol aria-label='Tempo e alcance por seção' className='space-y-3'>
        {sections.map((section) => (
          <li key={section.id} className='space-y-1'>
            <div className='flex min-w-0 items-baseline gap-2 text-sm'>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  section.name === REMOVED_SECTION_NAME &&
                    'text-muted-foreground italic',
                )}
                title={section.name}
              >
                <span className='mr-1.5 text-muted-foreground tabular-nums'>
                  {section.index + 1}.
                </span>
                {section.name}
              </span>
              <span className='shrink-0 font-medium tabular-nums'>
                {formatDuration(section.avgActiveMs)}
              </span>
              <span className='w-11 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
                {formatRate(section.reachRate)}
              </span>
            </div>
            <div className='h-2 w-full rounded-sm bg-muted' aria-hidden>
              <div
                className='h-full rounded-r-sm'
                style={{
                  width: barWidth(section.avgActiveMs, max),
                  backgroundColor: VIZ.mine,
                }}
              />
            </div>
            <div className='h-1 w-full rounded-sm bg-muted' aria-hidden>
              <div
                className='h-full rounded-r-sm'
                style={{
                  width: barWidth(section.reachRate, 1),
                  backgroundColor: VIZ.workspace,
                }}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function DropOffHint({
  sections,
}: {
  sections: DocumentAnalyticsDTO['sections']
}) {
  const drop = biggestDropOff(
    sections.filter((section) => section.name !== REMOVED_SECTION_NAME),
  )
  if (!drop) return null
  return (
    <p className='rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-sm'>
      A maior queda é entre <strong>{drop.from.name}</strong> e{' '}
      <strong>{drop.to.name}</strong>: o alcance cai de{' '}
      {formatRate(drop.from.reachRate)} para {formatRate(drop.to.reachRate)}.
    </p>
  )
}

function DailyChart({ daily }: { daily: DocumentAnalyticsDTO['daily'] }) {
  if (daily.every((day) => day.sessions === 0)) {
    return <EmptyState>Nenhuma leitura neste período.</EmptyState>
  }
  const every = Math.max(1, Math.ceil(daily.length / 8))
  const labels = new Map(daily.map((day) => [day.date, formatDay(day.date)]))
  const time = new Map(daily.map((day) => [day.date, day.activeMs]))
  return (
    <div className='h-52 min-w-0 text-muted-foreground'>
      <ResponsiveBar
        data={daily.map((day) => ({ date: day.date, sessions: day.sessions }))}
        keys={['sessions']}
        indexBy='date'
        margin={{ top: 10, right: 8, bottom: 26, left: 32 }}
        padding={0.3}
        colors={[VIZ.mine]}
        borderRadius={2}
        enableLabel={false}
        animate={false}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: daily
            .filter((_, index) => index % every === 0)
            .map((day) => day.date),
          format: (value) => labels.get(String(value)) ?? '',
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: 4,
          format: (value) =>
            Number.isInteger(Number(value)) ? formatCount(Number(value)) : '',
        }}
        tooltip={({ indexValue, value }) => (
          <div className='min-w-36 rounded-md border border-border bg-popover px-2.5 py-2 text-popover-foreground text-xs shadow-sm'>
            <p className='mb-1 font-medium'>
              {labels.get(String(indexValue)) ?? ''}
            </p>
            <p className='flex items-center gap-2'>
              <Swatch color={VIZ.mine} />
              <span className='text-muted-foreground'>Sessões</span>
              <span className='ml-auto pl-3 font-medium tabular-nums'>
                {formatCount(Number(value))}
              </span>
            </p>
            <p className='mt-0.5 text-muted-foreground'>
              {formatDuration(time.get(String(indexValue)) ?? 0)} de leitura
            </p>
          </div>
        )}
        theme={THEME}
        role='img'
        ariaLabel='Sessões de leitura por dia'
      />
    </div>
  )
}

function DeviceBars({ devices }: { devices: DocumentAnalyticsDTO['devices'] }) {
  const rows = (['desktop', 'mobile', 'tablet', 'unknown'] as const)
    .map((key) => ({ key, count: devices[key] }))
    .filter((row) => row.count > 0 || row.key !== 'unknown')
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const max = Math.max(...rows.map((row) => row.count), 1)
  return (
    <ul aria-label='Sessões por dispositivo' className='space-y-2.5'>
      {rows.map((row) => (
        <li key={row.key} className='space-y-1'>
          <div className='flex min-w-0 items-baseline gap-2 text-sm'>
            <span className='min-w-0 flex-1 truncate'>
              {deviceLabel(row.key)}
            </span>
            <span className='shrink-0 font-medium tabular-nums'>
              {formatCount(row.count)}
            </span>
            <span className='w-11 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
              {formatRate(total > 0 ? row.count / total : 0)}
            </span>
          </div>
          <div className='h-1.5 w-full rounded-sm bg-muted' aria-hidden>
            <div
              className='h-full rounded-r-sm'
              style={{
                width: barWidth(row.count, max),
                backgroundColor: VIZ.mine,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function ReadersTable({
  readers,
}: {
  readers: DocumentAnalyticsDTO['readers']
}) {
  if (readers.length === 0) {
    return <EmptyState>Nenhum leitor neste período.</EmptyState>
  }
  return (
    <div className='-mx-4 overflow-x-auto px-4'>
      <Table className='min-w-[34rem]'>
        <TableHeader>
          <TableRow>
            <TableHead>Leitor</TableHead>
            <TableHead className='text-right'>Sessões</TableHead>
            <TableHead className='text-right'>Tempo</TableHead>
            <TableHead>Dispositivo</TableHead>
            <TableHead>Última leitura</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {readers.map((reader) => (
            <TableRow key={`${reader.visitorId}:${reader.recipientId ?? ''}`}>
              <TableCell className='max-w-56'>
                <p className='truncate font-medium'>{readerName(reader)}</p>
                <p className='text-muted-foreground text-xs'>
                  {reader.recipientId ? 'Link pessoal' : 'Link público'} ·{' '}
                  {visitorTag(reader.visitorId)}
                </p>
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatCount(reader.sessions)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatDuration(reader.activeMs)}
              </TableCell>
              <TableCell>{deviceLabel(reader.device)}</TableCell>
              <TableCell className='whitespace-nowrap'>
                {formatSeenAt(reader.lastSeenAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className='grid gap-4' data-testid='document-analytics-loading'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6'>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className='h-[4.75rem] rounded-xl' />
        ))}
      </div>
      <ChartSkeleton className='h-52' />
      <ChartSkeleton className='h-40' />
    </div>
  )
}

function emptyMessage(
  period: DocumentAnalyticsPeriod,
  isTemplate: boolean,
): string {
  if (period !== 'all') return `Nenhuma leitura nos últimos ${period} dias.`
  return isTemplate
    ? 'Nenhum documento criado a partir deste modelo foi aberto ainda. Quando alguém abrir um deles, a soma da leitura aparece aqui.'
    : 'Ninguém abriu este documento ainda. Assim que o link for aberto, você vê aqui quanto tempo cada seção foi lida, até onde o leitor chegou e de qual aparelho.'
}

export function DocumentAnalyticsPanel({
  workspaceId,
  documentId,
  isTemplate = false,
}: DocumentAnalyticsPanelProps) {
  const [period, setPeriod] = useState<DocumentAnalyticsPeriod>('all')
  const query = useDocumentAnalytics(workspaceId, documentId, period)
  const data = query.data

  return (
    <div className={cn('grid gap-4', VIZ_VARS)}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='min-w-0'>
          <h2 className='font-semibold text-base'>Leitura</h2>
          <p className='text-muted-foreground text-xs'>
            {isTemplate
              ? 'Soma dos documentos criados a partir deste modelo.'
              : 'Atualizado a cada minuto. Só conta o tempo com a aba aberta e o leitor ativo.'}
          </p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {query.isPending ? (
        <PanelSkeleton />
      ) : query.isError || !data ? (
        <div className='flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center text-sm'>
          <p className='text-muted-foreground'>
            {query.error?.message ??
              'Não foi possível carregar a leitura do documento'}
          </p>
          <Button variant='outline' size='sm' onClick={() => query.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : data.totals.sessions === 0 ? (
        <EmptyState>{emptyMessage(period, isTemplate)}</EmptyState>
      ) : (
        <>
          <Totals totals={data.totals} />
          <Panel
            title='Tempo por seção'
            hint='Onde o leitor passou mais tempo e onde ele parou de ler.'
          >
            <div className='space-y-4'>
              <DropOffHint sections={data.sections} />
              <SectionBars sections={data.sections} />
            </div>
          </Panel>
          <div className='grid gap-4 lg:grid-cols-3'>
            <Panel
              title='Sessões por dia'
              hint='Dias no fuso de Brasília.'
              className='lg:col-span-2'
            >
              <DailyChart daily={data.daily} />
            </Panel>
            <Panel title='Dispositivos'>
              <DeviceBars devices={data.devices} />
            </Panel>
          </div>
          <Panel
            title='Leitores'
            hint='Cada navegador conta como um leitor; o link pessoal mostra o nome do destinatário.'
          >
            <ReadersTable readers={data.readers} />
          </Panel>
        </>
      )}
    </div>
  )
}
