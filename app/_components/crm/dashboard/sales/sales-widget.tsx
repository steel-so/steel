'use client'

import * as React from 'react'
import {
  type SalesConfig,
  SalesConfigSchema,
  type SalesMetric,
} from '@/src/schemas/crm-sales-metrics.schema'
import {
  ConversionBlock,
  DealStatsBlock,
  ForecastBlock,
  GoalBlock,
  PipelineBlock,
  ProposalsBlock,
  RankingBlock,
  SalesEmpty,
  ScoreboardBlock,
  StalledBlock,
  WinsFeedBlock,
} from './sales-blocks'
import { useSalesMetric } from './use-sales-metric'

/** The wins feed checks for new wins every 15 s. */
export const WINS_POLL_MS = 15_000

/** Relative times ("há 5 min") tick once a minute. */
function useMinuteClock(): Date {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function SalesMetricView({
  metric,
  now,
}: {
  metric: SalesMetric
  now: Date
}) {
  switch (metric.kind) {
    case 'goal':
      return <GoalBlock metric={metric} />
    case 'ranking':
      return <RankingBlock metric={metric} />
    case 'pipeline':
      return <PipelineBlock metric={metric} />
    case 'forecast':
      return <ForecastBlock metric={metric} />
    case 'conversion':
      return <ConversionBlock metric={metric} />
    case 'deal-stats':
      return <DealStatsBlock metric={metric} />
    case 'stalled':
      return <StalledBlock metric={metric} />
    case 'proposals':
      return <ProposalsBlock metric={metric} />
    case 'scoreboard':
      return <ScoreboardBlock metric={metric} />
    case 'wins-feed':
      return <WinsFeedBlock metric={metric} now={now} />
  }
}

function SalesWidgetBody({
  config,
  workspaceId,
  widgetId,
}: {
  config: SalesConfig
  workspaceId: string
  widgetId?: string
}) {
  const { metric, error, isLoading } = useSalesMetric(
    config,
    workspaceId,
    widgetId,
    config.kind === 'wins-feed' ? WINS_POLL_MS : undefined,
  )
  const now = useMinuteClock()

  if (metric) return <SalesMetricView metric={metric} now={now} />
  if (error) return <SalesEmpty title={error} />
  if (isLoading) return <SalesEmpty title='Carregando…' />
  return null
}

/** Widget "Vendas": one metric of the kit, computed on the server. */
export function SalesWidget({
  config,
  workspaceId,
  widgetId,
}: {
  config: Record<string, unknown>
  workspaceId: string
  widgetId?: string
}) {
  const parsed = React.useMemo(
    () => SalesConfigSchema.safeParse(config),
    [config],
  )
  if (!parsed.success) {
    return <SalesEmpty title='Configuração inválida. Edite o widget.' />
  }
  return (
    <SalesWidgetBody
      config={parsed.data}
      workspaceId={workspaceId}
      widgetId={widgetId}
    />
  )
}
