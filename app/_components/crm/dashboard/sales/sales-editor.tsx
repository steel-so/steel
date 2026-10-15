'use client'

import type * as React from 'react'
import {
  SALES_KIND_META,
  SALES_PERIOD_LABELS,
  salesKindMeta,
} from '@/app/_components/crm/dashboard/widget-meta'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useDashboardLookups } from '@/src/hooks/use-crm-dashboard-tv'
import {
  SALES_DEFAULT_STALLED_DAYS,
  SALES_PERIODS,
  type SalesConfig,
  type SalesKind,
  type SalesPeriod,
} from '@/src/schemas/crm-sales-metrics.schema'

const ALL_PIPELINES = '__all__'

/** Config inicial de um widget de Vendas do tipo `kind`. */
export function defaultSalesConfig(kind: SalesKind = 'goal'): SalesConfig {
  const meta = salesKindMeta(kind)
  return {
    kind,
    title: meta.label,
    period: 'month',
    stalledDays: SALES_DEFAULT_STALLED_DAYS,
    ...(meta.uses.limit ? { limit: meta.uses.limit } : {}),
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <span className='block text-sm'>{label}</span>
      {children}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

/**
 * Painel de configuração do widget "Vendas": escolhe a métrica do kit e
 * os poucos ajustes que ela usa (período, pipeline, dias parado, linhas).
 */
export function SalesEditor({
  config,
  onChange,
  workspaceId,
}: {
  config: SalesConfig
  onChange: (config: Record<string, unknown>) => void
  workspaceId: string
}) {
  const meta = salesKindMeta(config.kind)
  const lookups = useDashboardLookups(meta.uses.pipeline ? workspaceId : null)
  const pipelines = lookups?.pipelines ?? []

  function pickKind(kind: SalesKind) {
    const previousDefault = salesKindMeta(config.kind).label
    const next = defaultSalesConfig(kind)
    // Mantém um título digitado à mão; troca o título padrão pelo do novo tipo.
    const title =
      config.title && config.title !== previousDefault
        ? config.title
        : next.title
    onChange({ ...next, title })
  }

  return (
    <div className='space-y-5'>
      <div className='space-y-2'>
        <h3 className='font-semibold text-muted-foreground text-xs uppercase tracking-wide'>
          Métrica
        </h3>
        <div className='grid grid-cols-2 gap-2'>
          {SALES_KIND_META.map((item) => (
            <button
              key={item.kind}
              type='button'
              aria-pressed={item.kind === config.kind}
              onClick={() => pickKind(item.kind)}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors',
                item.kind === config.kind
                  ? 'border-primary bg-primary/5'
                  : 'border-border/70 bg-card/60 hover:border-border hover:bg-accent',
              )}
            >
              <span className='font-medium text-sm'>{item.label}</span>
              <span className='text-muted-foreground text-xs leading-snug'>
                {item.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Field label='Título'>
        <Input
          value={config.title ?? ''}
          maxLength={120}
          placeholder={meta.label}
          onChange={(e) => onChange({ ...config, title: e.target.value })}
        />
      </Field>

      {meta.uses.period ? (
        <Field label='Período'>
          <Select
            value={config.period}
            onValueChange={(value) =>
              onChange({ ...config, period: value as SalesPeriod })
            }
          >
            <SelectTrigger className='w-full' aria-label='Período'>
              <span>{SALES_PERIOD_LABELS[config.period]}</span>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {SALES_PERIODS.map((period) => (
                <SelectItem key={period} value={period}>
                  {SALES_PERIOD_LABELS[period]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {meta.uses.pipeline ? (
        <Field
          label='Pipeline'
          hint={
            config.kind === 'pipeline'
              ? 'Sem escolha, usa o pipeline padrão.'
              : 'Sem escolha, considera todos os pipelines.'
          }
        >
          <Select
            value={config.pipelineId ?? ALL_PIPELINES}
            onValueChange={(value) =>
              onChange({
                ...config,
                pipelineId:
                  value === ALL_PIPELINES ? undefined : (value as string),
              })
            }
          >
            <SelectTrigger className='w-full' aria-label='Pipeline'>
              <span>
                {pipelines.find((p) => p.id === config.pipelineId)?.name ??
                  (config.kind === 'pipeline' ? 'Pipeline padrão' : 'Todos')}
              </span>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value={ALL_PIPELINES}>
                {config.kind === 'pipeline' ? 'Pipeline padrão' : 'Todos'}
              </SelectItem>
              {pipelines.map((pipeline) => (
                <SelectItem key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {meta.uses.stalledDays ? (
        <Field
          label='Parado há (dias)'
          hint='Sem atividade (nota, tarefa, edição) há pelo menos estes dias.'
        >
          <Input
            type='number'
            min={1}
            max={365}
            value={config.stalledDays}
            onChange={(e) => {
              const days = Number.parseInt(e.target.value, 10)
              onChange({
                ...config,
                stalledDays: Number.isFinite(days)
                  ? Math.min(365, Math.max(1, days))
                  : SALES_DEFAULT_STALLED_DAYS,
              })
            }}
          />
        </Field>
      ) : null}

      {meta.uses.limit ? (
        <Field label='Linhas exibidas' hint='Na TV, menos linhas leem melhor.'>
          <Input
            type='number'
            min={1}
            max={20}
            value={config.limit ?? meta.uses.limit}
            onChange={(e) => {
              const limit = Number.parseInt(e.target.value, 10)
              onChange({
                ...config,
                limit: Number.isFinite(limit)
                  ? Math.min(20, Math.max(1, limit))
                  : meta.uses.limit,
              })
            }}
          />
        </Field>
      ) : null}
    </div>
  )
}
