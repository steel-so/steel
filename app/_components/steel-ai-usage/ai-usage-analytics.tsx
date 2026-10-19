'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { AiQualityBody } from '@/app/_components/steel-ai-quality/ai-quality-panel'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  type AiQualityExportView,
  aiQualityExportUrl,
  useAiQuality,
} from '@/src/hooks/use-ai-feedback'
import {
  type AiUsageExportView,
  type AiUsageFilter,
  aiUsageExportUrl,
  useAiUsageAnalytics,
} from '@/src/hooks/use-ai-usage'
import type {
  AiUsageAnalyticsDTO,
  AiUsagePeriodPreset,
  AiUsageScope,
} from '@/types/ai-usage'
import {
  BreakdownBars,
  ChartSkeleton,
  EmptyState,
  StatTile,
  UsageLineChart,
  VIZ,
  VIZ_VARS,
} from './usage-charts'
import {
  formatCompact,
  formatDayMonth,
  formatInteger,
  formatLongDay,
  formatRange,
  formatUsd,
} from './usage-format'

export const PERIOD_LABELS: Record<AiUsagePeriodPreset, string> = {
  this_month: 'Este mês',
  last_month: 'Mês passado',
  last_7_days: 'Últimos 7 dias',
  last_30_days: 'Últimos 30 dias',
  last_90_days: 'Últimos 90 dias',
  custom: 'Personalizado',
}

const EXPORTS: {
  view: AiUsageExportView
  label: string
  workspaceOnly?: boolean
}[] = [
  { view: 'rows', label: 'Todas as chamadas (linha a linha)' },
  { view: 'model', label: 'Totais por modelo' },
  { view: 'feature', label: 'Totais por recurso' },
  { view: 'module', label: 'Totais por escopo' },
  { view: 'user', label: 'Totais por usuário', workspaceOnly: true },
]

const QUALITY_EXPORTS: { view: AiQualityExportView; label: string }[] = [
  { view: 'feedback', label: 'Todas as avaliações (linha a linha)' },
  { view: 'surface', label: 'Aprovação por superfície' },
  { view: 'model', label: 'Aprovação por modelo' },
]

type AnalyticsView = 'spend' | 'quality'

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** `/ai/analytics` — AI spend breakdowns with CSV export. */
export function AiUsageAnalytics({
  workspaceId,
  canViewWorkspace,
}: {
  workspaceId: string
  /** OWNER/ADMIN (resolved on the server): may open the workspace view. */
  canViewWorkspace: boolean
}) {
  const [view, setView] = useState<AnalyticsView>('spend')
  const [scope, setScope] = useState<AiUsageScope>('personal')
  const [period, setPeriod] = useState<AiUsagePeriodPreset>('this_month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const customReady = isDay(from) && isDay(to) && from <= to
  const filter: AiUsageFilter =
    period === 'custom' ? { scope, period, from, to } : { scope, period }
  const ready = period !== 'custom' || customReady
  const analytics = useAiUsageAnalytics(
    workspaceId,
    filter,
    ready && view === 'spend',
  )
  const quality = useAiQuality(workspaceId, filter, ready && view === 'quality')
  const exports =
    view === 'spend'
      ? EXPORTS.filter((e) => !e.workspaceOnly || scope === 'workspace').map(
          (e) => ({
            key: e.view,
            label: e.label,
            url: aiUsageExportUrl(workspaceId, filter, e.view),
          }),
        )
      : QUALITY_EXPORTS.map((e) => ({
          key: e.view,
          label: e.label,
          url: aiQualityExportUrl(workspaceId, filter, e.view),
        }))

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', VIZ_VARS)}>
      <SteelAiTopBar title='Análises' />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-4xl space-y-5 px-4 pt-2 pb-10 sm:px-6 sm:pt-4'>
          <header className='space-y-1'>
            <h1 className='font-semibold text-lg'>Análises</h1>
            <p className='max-w-prose text-muted-foreground text-sm'>
              {view === 'spend'
                ? 'Para onde vai o gasto com IA: por modelo, recurso, escopo e — para administradores — por pessoa. Valores em US$ pelo preço real; dias em UTC.'
                : 'Se a IA acerta: aprovação das respostas (👍/👎) por superfície e modelo, resolução sem humano, custo por resolução e as piores respostas. Dias em UTC.'}
            </p>
          </header>

          <Tabs
            value={view}
            onValueChange={(value) =>
              setView(value === 'quality' ? 'quality' : 'spend')
            }
          >
            <TabsList aria-label='Análise'>
              <TabsTrigger value='spend'>Gasto</TabsTrigger>
              <TabsTrigger value='quality'>Qualidade</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className='flex flex-wrap items-end gap-3'>
            {canViewWorkspace ? (
              <Tabs
                value={scope}
                onValueChange={(value) =>
                  setScope(value === 'workspace' ? 'workspace' : 'personal')
                }
              >
                <TabsList aria-label='Visão'>
                  <TabsTrigger value='personal'>Pessoal</TabsTrigger>
                  <TabsTrigger value='workspace'>
                    Espaço de trabalho
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
            <Select
              value={period}
              onValueChange={(value) => {
                if (typeof value === 'string' && value in PERIOD_LABELS) {
                  setPeriod(value as AiUsagePeriodPreset)
                }
              }}
            >
              <SelectTrigger aria-label='Período' className='w-44'>
                <SelectValue>
                  {(value: AiUsagePeriodPreset) => PERIOD_LABELS[value]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {(Object.keys(PERIOD_LABELS) as AiUsagePeriodPreset[]).map(
                    (key) => (
                      <SelectItem key={key} value={key}>
                        {PERIOD_LABELS[key]}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
            {period === 'custom' ? (
              <div className='flex flex-wrap items-end gap-2'>
                <div className='space-y-1'>
                  <Label htmlFor='ai-usage-from' className='text-xs'>
                    De
                  </Label>
                  <Input
                    id='ai-usage-from'
                    type='date'
                    value={from}
                    max={to || undefined}
                    onChange={(event) => setFrom(event.target.value)}
                    className='w-40'
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='ai-usage-to' className='text-xs'>
                    Até
                  </Label>
                  <Input
                    id='ai-usage-to'
                    type='date'
                    value={to}
                    min={from || undefined}
                    onChange={(event) => setTo(event.target.value)}
                    className='w-40'
                  />
                </div>
              </div>
            ) : null}
            <div className='ml-auto'>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={period === 'custom' && !customReady}
                    />
                  }
                >
                  <SteelIcon icon={Download01Icon} strokeWidth={2} />
                  Exportar CSV
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-64'>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {scope === 'workspace'
                        ? 'Espaço de trabalho'
                        : view === 'spend'
                          ? 'Só o seu consumo'
                          : 'Só as suas avaliações'}{' '}
                      · {PERIOD_LABELS[period].toLowerCase()}
                    </DropdownMenuLabel>
                    {exports.map((e) => (
                      <DropdownMenuItem
                        key={e.key}
                        onClick={() => window.location.assign(e.url)}
                      >
                        {e.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {period === 'custom' && !customReady ? (
            <EmptyState>
              Escolha o início e o fim do período (até 366 dias).
            </EmptyState>
          ) : view === 'quality' ? (
            quality.isLoading ? (
              <AnalyticsSkeleton />
            ) : quality.data ? (
              <div
                className={cn(
                  'transition-opacity',
                  quality.isPlaceholderData && 'opacity-60',
                )}
              >
                <AiQualityBody data={quality.data} />
              </div>
            ) : (
              <p className='text-destructive text-sm'>
                {quality.error instanceof Error
                  ? quality.error.message
                  : 'Não foi possível carregar a qualidade da IA.'}
              </p>
            )
          ) : analytics.isLoading ? (
            <AnalyticsSkeleton />
          ) : analytics.data ? (
            <div
              className={cn(
                'transition-opacity',
                analytics.isPlaceholderData && 'opacity-60',
              )}
            >
              <AnalyticsBody data={analytics.data} />
            </div>
          ) : (
            <p className='text-destructive text-sm'>
              {analytics.error instanceof Error
                ? analytics.error.message
                : 'Não foi possível carregar as análises.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function AnalyticsSkeleton() {
  return (
    <div className='space-y-5' data-testid='usage-analytics-loading'>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        {[0, 1, 2, 3].map((key) => (
          <ChartSkeleton key={key} className='h-20' />
        ))}
      </div>
      <ChartSkeleton className='h-56' />
    </div>
  )
}

export function AnalyticsBody({ data }: { data: AiUsageAnalyticsDTO }) {
  const workspace = data.scope === 'workspace'
  const hasData = data.totals.calls > 0

  return (
    <div className='space-y-5'>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <StatTile
          label='Gasto no período'
          value={formatUsd(data.totals.costUsd)}
          detail={formatRange(data.from, data.to)}
        />
        <StatTile label='Chamadas' value={formatInteger(data.totals.calls)} />
        <StatTile
          label='Tokens de entrada'
          value={formatCompact(data.totals.inputTokens)}
        />
        <StatTile
          label='Tokens de saída'
          value={formatCompact(data.totals.outputTokens)}
        />
      </div>

      {hasData ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Gasto por dia</CardTitle>
              <CardDescription>
                {workspace
                  ? 'Todo o espaço de trabalho, incluindo automações.'
                  : 'Só as chamadas feitas por você.'}{' '}
                Dias em UTC.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UsageLineChart
                labels={data.daily.map((d) => formatDayMonth(d.date))}
                tooltipLabels={data.daily.map((d) => formatLongDay(d.date))}
                series={[
                  {
                    id: 'cost',
                    label: 'Gasto',
                    color: VIZ.mine,
                    values: data.daily.map((d) => d.costUsd),
                  },
                ]}
                ariaLabel={`Gasto de IA por dia: total de ${formatUsd(data.totals.costUsd)} no período`}
              />
            </CardContent>
          </Card>

          <div className='grid gap-5 md:grid-cols-2'>
            <BreakdownCard
              title='Por modelo'
              description='Modelos que responderam.'
              items={data.byModel}
            />
            <BreakdownCard
              title='Por recurso'
              description='Steel AI, agentes, WhatsApp, ServiceDesk…'
              items={data.byFeature}
            />
            <BreakdownCard
              title='Por escopo'
              description='Módulo das ferramentas usadas; “Plataforma” quando nenhum.'
              items={data.byModule}
            />
            {data.byUser ? (
              <BreakdownCard
                title='Por usuário'
                description='Quem gastou; automações sem usuário à parte.'
                items={data.byUser}
              />
            ) : null}
          </div>
        </>
      ) : (
        <EmptyState>
          {workspace
            ? 'Nenhum uso de IA no espaço de trabalho neste período.'
            : 'Você não usou IA neste período.'}
        </EmptyState>
      )}
    </div>
  )
}

function BreakdownCard({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: AiUsageAnalyticsDTO['byModel']
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <BreakdownBars items={items} label={title} />
      </CardContent>
    </Card>
  )
}
