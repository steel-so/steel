'use client'

import * as React from 'react'
import { useDashboardDisplay } from '@/app/_components/crm/dashboard/dashboard-display'
import type {
  SalesConfig,
  SalesMetric,
} from '@/src/schemas/crm-sales-metrics.schema'

type Envelope = {
  success: boolean
  data?: SalesMetric | { type: string; metric?: SalesMetric }
  message?: string
  error?: { code?: string; message?: string }
}

/** Query string of `GET …/crm/sales-metrics` for a widget config. */
export function salesMetricsQuery(config: SalesConfig): string {
  const params = new URLSearchParams({ kind: config.kind })
  params.set('period', config.period ?? 'month')
  if (config.pipelineId) params.set('pipelineId', config.pipelineId)
  if (config.stalledDays) params.set('stalledDays', String(config.stalledDays))
  if (config.limit) params.set('limit', String(config.limit))
  return params.toString()
}

/** URL of the metric: workspace route, or the widget route of a TV link. */
export function salesMetricUrl(
  config: SalesConfig,
  target: { workspaceId: string; tvToken?: string; widgetId?: string },
): string {
  if (target.tvToken && target.widgetId) {
    return `/api/crm/tv/${target.tvToken}/widgets/${target.widgetId}`
  }
  return `/api/workspaces/${target.workspaceId}/crm/sales-metrics?${salesMetricsQuery(config)}`
}

async function load(url: string): Promise<SalesMetric> {
  const response = await fetch(url)
  const json = (await response.json().catch(() => null)) as Envelope | null
  if (!response.ok || !json?.success || !json.data) {
    throw new Error(
      json?.error?.message ??
        json?.message ??
        'Não foi possível carregar os números.',
    )
  }
  const data = json.data
  return 'kind' in data ? data : (data.metric as SalesMetric)
}

/**
 * A metric of the sales kit. Refetches when the TV refreshes
 * (`refreshKey`) or every `pollMs` (wins feed), keeping the last numbers
 * on screen meanwhile.
 */
export function useSalesMetric(
  config: SalesConfig,
  workspaceId: string,
  widgetId?: string,
  pollMs?: number,
): { metric: SalesMetric | null; error: string | null; isLoading: boolean } {
  const { refreshKey, tvToken } = useDashboardDisplay()
  const url = salesMetricUrl(config, { workspaceId, tvToken, widgetId })
  const [metric, setMetric] = React.useState<SalesMetric | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    if (!pollMs) return
    const timer = setInterval(() => setTick((value) => value + 1), pollMs)
    return () => clearInterval(timer)
  }, [pollMs])

  React.useEffect(() => {
    let active = true
    load(url)
      .then((value) => {
        if (!active) return
        setMetric(value)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Erro de rede.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [url, refreshKey, tick])

  return { metric, error, isLoading }
}
