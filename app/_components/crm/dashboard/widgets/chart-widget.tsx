'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { ResponsiveBar } from '@nivo/bar'
import { ResponsiveLine } from '@nivo/line'
import { ResponsivePie } from '@nivo/pie'
import * as React from 'react'
import { useDashboardDisplay } from '@/app/_components/crm/dashboard/dashboard-display'
import { useDashboardRows } from '@/app/_components/crm/dashboard/use-dashboard-rows'
import {
  aggregateChart,
  aggregateCompare,
  aggregateTotal,
  formatAggregate,
  type Row,
  refLabelsOf,
  withDerivedFields,
} from '@/app/_components/crm/dashboard/widget-data'
import {
  sourceNeedsLookups,
  sourceResource,
} from '@/app/_components/crm/dashboard/widget-meta'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { useDashboardLookups } from '@/src/hooks/use-crm-dashboard-tv'
import type { ChartConfig } from '@/src/schemas/crm-dashboard.schema'

const COLORS = [
  '#6366f1',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#a855f7',
]

/** Paleta mais clara/saturada para o fundo escuro do modo TV. */
const TV_COLORS = [
  '#818cf8',
  '#4ade80',
  '#fbbf24',
  '#f472b6',
  '#22d3ee',
  '#c084fc',
]

/** Tema nivo que herda a cor do texto do container (claro/escuro). */
function nivoTheme(fontSize: number) {
  return {
    text: { fill: 'currentColor', fontSize },
    axis: {
      ticks: {
        text: { fill: 'currentColor', fontSize },
        line: { stroke: 'transparent' },
      },
      legend: { text: { fill: 'currentColor', fontSize } },
      domain: { line: { stroke: 'currentColor', strokeOpacity: 0.15 } },
    },
    grid: { line: { stroke: 'currentColor', strokeOpacity: 0.08 } },
    legends: { text: { fill: 'currentColor', fontSize } },
    labels: { text: { fontSize, fontWeight: 600 } },
    tooltip: {
      container: {
        background: 'var(--color-popover)',
        color: 'var(--color-popover-foreground)',
        fontSize: 12,
      },
    },
  } as const
}

const THEME = nivoTheme(11)
const TV_THEME = nivoTheme(16)

function Empty({ message }: { message: string }) {
  return (
    <div className='flex h-full items-center justify-center px-3 text-center text-muted-foreground text-sm'>
      {message}
    </div>
  )
}

/**
 * Sem OAuth real por plataforma (ver Fase 13 do plano), o Steel não coleta
 * métricas sociais — a fonte "socials" sempre retorna uma série vazia. O
 * widget fica funcional na UI (não quebra), só sem dado até essa integração
 * existir.
 */
function useChartRows(
  workspaceId: string,
  source: ChartConfig['source'],
  refreshKey: number,
  tv?: { token: string; widgetId: string },
): {
  items: Row[]
  isLoading: boolean
} {
  const path = source === 'socials' ? '' : sourceResource(source)
  const { items, isLoading } = useDashboardRows(
    workspaceId,
    path,
    refreshKey,
    tv,
  )
  const derived = React.useMemo(
    () => withDerivedFields(source, items),
    [source, items],
  )
  if (source === 'socials') return { items: [], isLoading: false }
  return { items: derived, isLoading }
}

/**
 * Número único (chart "aggregate"). No modo TV o número escala com o
 * tamanho do bloco (container query) — legível do outro lado da sala em
 * 1080p ou 4K.
 */
export function AggregateTile({
  value,
  config,
  changePct,
  tv,
}: {
  value: number
  config: ChartConfig
  changePct: number | null
  tv: boolean
}) {
  const formatted = formatAggregate(value, config)
  const isUp = changePct !== null && changePct >= 0
  const caption = tv ? null : config.xAxisName
  return (
    <div
      className='flex h-full flex-col items-center justify-center text-muted-foreground'
      style={tv ? { containerType: 'size' } : undefined}
    >
      <span
        data-testid='aggregate-value'
        className={cn(
          'font-heading font-semibold text-foreground tabular-nums leading-none',
          !tv && 'text-4xl',
        )}
        style={{
          ...(config.color ? { color: config.color } : {}),
          ...(tv ? { fontSize: 'min(62cqh, 26cqw)' } : {}),
        }}
      >
        {config.prefix}
        {formatted}
        {config.suffix}
      </span>
      {caption ? (
        <span className='mt-1 text-xs uppercase tracking-wide'>{caption}</span>
      ) : null}
      {changePct !== null ? (
        <span
          className={cn(
            'mt-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium',
            tv ? 'text-[max(0.9rem,7cqh)]' : 'text-xs',
            isUp
              ? 'bg-emerald-500/15 text-emerald-500'
              : 'bg-rose-500/15 text-rose-500',
          )}
        >
          <SteelIcon
            icon={isUp ? ArrowUp01Icon : ArrowDown01Icon}
            className={tv ? 'size-[1em]' : 'size-3'}
          />
          {new Intl.NumberFormat('pt-BR', {
            maximumFractionDigits: 1,
          }).format(Math.abs(changePct))}
          %
        </span>
      ) : null}
    </div>
  )
}

export function ChartWidget({
  workspaceId,
  config,
  widgetId,
}: {
  workspaceId: string
  config: ChartConfig
  /** Id do widget: no link da TV, os dados vêm por ele. */
  widgetId?: string
}) {
  const { variant, refreshKey, tvToken, lookups } = useDashboardDisplay()
  const tv = variant === 'tv'
  const theme = tv ? TV_THEME : THEME
  const palette = tv ? TV_COLORS : COLORS
  const tvSource = React.useMemo(
    () => (tvToken && widgetId ? { token: tvToken, widgetId } : undefined),
    [tvToken, widgetId],
  )
  const { items, isLoading } = useChartRows(
    workspaceId,
    config.source,
    refreshKey,
    tvSource,
  )
  const names = useDashboardLookups(
    tvToken || !sourceNeedsLookups(config.source) ? null : workspaceId,
    lookups,
  )
  const labels = React.useMemo(() => refLabelsOf(names), [names])

  const data = React.useMemo(
    () => aggregateChart(items, config, undefined, labels),
    [items, config, labels],
  )
  const total = React.useMemo(
    () => aggregateTotal(items, config, undefined, labels),
    [items, config, labels],
  )
  const compare = React.useMemo(
    () => aggregateCompare(items, config, undefined, labels),
    [items, config, labels],
  )

  if (isLoading) return <Empty message='Carregando…' />

  if (config.source === 'socials' && config.platforms.length === 0) {
    return <Empty message='Selecione ao menos uma rede no painel.' />
  }
  if (config.source === 'socials') {
    return (
      <Empty message='Sem métricas sociais disponíveis (conexão via OAuth ainda não configurada).' />
    )
  }

  /* -------------------------------- aggregate ------------------------------ */
  if (config.chartType === 'aggregate') {
    return (
      <AggregateTile
        value={compare ? compare.current : total}
        config={config}
        changePct={compare?.changePct ?? null}
        tv={tv}
      />
    )
  }

  if (!config.xField) {
    return (
      <Empty message='Escolha o campo a exibir na customização do gráfico.' />
    )
  }
  if (data.categories.length === 0) {
    return <Empty message='Sem dados para os filtros atuais.' />
  }

  const isHorizontal = config.chartType === 'horizontal'
  const categoryLegend = config.xAxisName || undefined
  const valueLegend = config.yAxisName || undefined
  /** Nome do eixo que fica embaixo/à esquerda (barra horizontal inverte os dois). */
  const bottomAxisName = isHorizontal ? valueLegend : categoryLegend
  const leftAxisName = isHorizontal ? categoryLegend : valueLegend

  /*
   * O espaço embaixo do gráfico é compartilhado por até três elementos
   * empilhados: tick labels do eixo X, o nome do eixo (axisBottom.legend) e
   * a legenda de série (chart legend). O espaço à esquerda é compartilhado
   * por tick labels do eixo Y e o nome do eixo (axisLeft.legend). Cada faixa
   * reserva sua própria altura/largura e os offsets abaixo são derivados
   * dela, para nunca ultrapassar a margem reservada (o que antes causava
   * sobreposição/corte de texto).
   */
  const scale = tv ? 1.5 : 1
  const TICK_SPACE_X = 24 * scale
  const AXIS_NAME_SPACE_X = 20 * scale
  const SERIES_LEGEND_SPACE = 24 * scale
  // Barra horizontal: as categorias (ex.: nomes de agentes) ficam à
  // esquerda — reserva a largura do rótulo mais longo (com teto).
  const longestLabel = data.categories.reduce(
    (max, category) => Math.max(max, category.length),
    0,
  )
  const TICK_SPACE_Y = isHorizontal
    ? Math.min(Math.max(32, longestLabel * 6.5 * scale + 12), 220 * scale)
    : 32 * scale
  const AXIS_NAME_SPACE_Y = 20 * scale

  const bottomMargin =
    TICK_SPACE_X +
    (bottomAxisName ? AXIS_NAME_SPACE_X : 0) +
    (config.legend ? SERIES_LEGEND_SPACE : 0)
  const axisBottomLegendOffset = TICK_SPACE_X + AXIS_NAME_SPACE_X / 2 + 4
  const seriesLegendTranslateY =
    TICK_SPACE_X + (bottomAxisName ? AXIS_NAME_SPACE_X : 0) + 6

  const leftMargin = TICK_SPACE_Y + (leftAxisName ? AXIS_NAME_SPACE_Y : 0)
  const axisLeftLegendOffset = -(TICK_SPACE_Y + AXIS_NAME_SPACE_Y / 2 + 4)

  const legends = config.legend
    ? [
        {
          dataFrom: 'keys' as const,
          anchor: 'bottom' as const,
          direction: 'row' as const,
          translateY: seriesLegendTranslateY,
          itemWidth: 80 * scale,
          itemHeight: 16 * scale,
          symbolSize: 10,
        },
      ]
    : []

  /* ---------------------------------- pie ---------------------------------- */
  if (config.chartType === 'pie') {
    const pieData = data.categories.map((category) => ({
      id: category,
      value: data.totalOf(category),
    }))
    const PIE_LEGEND_TRANSLATE_Y = 32
    const PIE_LEGEND_HEIGHT = 16
    const pieBottomMargin = config.legend
      ? PIE_LEGEND_TRANSLATE_Y + PIE_LEGEND_HEIGHT + 8
      : 12
    return (
      <div className='h-full w-full text-muted-foreground'>
        <ResponsivePie
          data={pieData}
          margin={{
            top: 12,
            right: 12,
            bottom: pieBottomMargin,
            left: 12,
          }}
          innerRadius={0.5}
          padAngle={1}
          cornerRadius={3}
          colors={palette}
          borderWidth={0}
          enableArcLinkLabels={false}
          enableArcLabels={config.dataLabels}
          arcLabelsTextColor='#fff'
          theme={theme}
          legends={
            config.legend
              ? [
                  {
                    anchor: 'bottom',
                    direction: 'row',
                    translateY: PIE_LEGEND_TRANSLATE_Y,
                    itemWidth: 70,
                    itemHeight: PIE_LEGEND_HEIGHT,
                    symbolSize: 10,
                  },
                ]
              : []
          }
        />
      </div>
    )
  }

  /* ---------------------------------- line --------------------------------- */
  if (config.chartType === 'line') {
    const lineData = data.seriesKeys.map((series) => ({
      id: series,
      data: data.categories.map((category) => ({
        x: category,
        y: data.valueAt(category, series),
      })),
    }))
    return (
      <div className='h-full w-full text-muted-foreground'>
        <ResponsiveLine
          data={lineData}
          margin={{
            top: 12,
            right: 16,
            bottom: bottomMargin,
            left: leftMargin,
          }}
          colors={palette}
          curve='monotoneX'
          enableArea={config.stacked}
          areaOpacity={0.15}
          pointSize={6}
          pointColor={{ from: 'color' }}
          useMesh
          yScale={{
            type: 'linear',
            min: config.yMin ?? 'auto',
            max: config.yMax ?? 'auto',
            stacked: config.stacked,
          }}
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            legend: bottomAxisName,
            legendPosition: 'middle',
            legendOffset: axisBottomLegendOffset,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
            legend: leftAxisName,
            legendPosition: 'middle',
            legendOffset: axisLeftLegendOffset,
          }}
          theme={theme}
          legends={legends}
        />
      </div>
    )
  }

  /* ------------------------------- bar (v / h) ----------------------------- */
  const barData = data.categories.map((category) => {
    const entry: Record<string, string | number> = { category }
    for (const series of data.seriesKeys) {
      entry[series] = data.valueAt(category, series)
    }
    return entry
  })

  return (
    <div className='h-full w-full text-muted-foreground'>
      <ResponsiveBar
        data={barData}
        keys={data.seriesKeys}
        indexBy='category'
        layout={isHorizontal ? 'horizontal' : 'vertical'}
        groupMode={config.stacked ? 'stacked' : 'grouped'}
        margin={{ top: 12, right: 16, bottom: bottomMargin, left: leftMargin }}
        padding={0.3}
        colors={palette}
        borderRadius={3}
        enableLabel={config.dataLabels}
        valueScale={{
          type: 'linear',
          min: config.yMin ?? 'auto',
          max: config.yMax ?? 'auto',
        }}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          legend: bottomAxisName,
          legendPosition: 'middle',
          legendOffset: axisBottomLegendOffset,
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          legend: leftAxisName,
          legendPosition: 'middle',
          legendOffset: axisLeftLegendOffset,
        }}
        theme={theme}
        legends={legends}
      />
    </div>
  )
}
