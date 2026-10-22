import { StatTile } from '@/app/_components/steel-ai-usage/usage-charts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { WhatsAppCostReportDTO } from '@/types/whatsapp-cost'
import {
  formatBrl,
  formatCount,
  formatFullDay,
  formatShortDay,
} from './whatsapp-costs-format'

export function CostTotals({ report }: { report: WhatsAppCostReportDTO }) {
  const { totals } = report
  return (
    <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
      <StatTile
        label='Custo no período'
        value={formatBrl(totals.totalCost)}
        detail={`Meta estimado ${formatBrl(totals.variableCost)} + mensalidades ${formatBrl(totals.fees)}`}
      />
      <StatTile
        label='Mensagens enviadas'
        value={formatCount(totals.messages)}
        detail={`${formatCount(totals.templateMessages)} com template, ${formatCount(totals.serviceMessages)} na janela de atendimento`}
      />
      <StatTile
        label='Custo por conversa'
        value={formatBrl(totals.costPerConversation)}
        detail={`${formatCount(totals.conversations)} conversas com envio`}
      />
      <StatTile
        label='Custo por conversa resolvida'
        value={formatBrl(totals.costPerResolvedConversation)}
        detail={`${formatCount(totals.resolvedConversations)} resolvidas (fechadas sem insucesso)`}
      />
    </div>
  )
}

const LEVEL_COPY = {
  80: 'Atenção: o custo do mês passou de 80% do orçamento.',
  100: 'O orçamento do mês foi atingido. Os envios continuam normalmente.',
} as const

export function CostBudgetCard({ report }: { report: WhatsAppCostReportDTO }) {
  const { projection, budget } = report
  const percent = budget.percent === null ? 0 : Math.min(100, budget.percent)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mês corrente e orçamento</CardTitle>
        <CardDescription>
          Ritmo atual de {projection.period.slice(5, 7)}/
          {projection.period.slice(0, 4)}, sem considerar os filtros acima.
          Valores estimados.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid grid-cols-2 gap-3 lg:grid-cols-3'>
          <StatTile
            label='Gasto até agora'
            value={formatBrl(budget.spent)}
            detail={`Meta ${formatBrl(projection.variableToDate)} + mensalidades ${formatBrl(projection.fees)}`}
          />
          <StatTile
            label='Projeção do mês'
            value={formatBrl(projection.monthCost)}
            detail={`Pelo ritmo de ${projection.daysElapsed} de ${projection.daysInMonth} dias`}
          />
          <StatTile
            label='Orçamento mensal'
            value={
              budget.monthlyCostBudget === null
                ? 'Não definido'
                : formatBrl(budget.monthlyCostBudget)
            }
            detail={
              budget.percent === null
                ? 'Defina um valor para receber avisos'
                : `${budget.percent}% consumido`
            }
          />
        </div>
        {budget.monthlyCostBudget !== null ? (
          <div className='space-y-1.5'>
            <div
              role='progressbar'
              aria-label='Consumo do orçamento mensal'
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className='h-2 overflow-hidden rounded-full bg-muted'
            >
              <div
                className={cn(
                  'h-full rounded-full',
                  budget.level === 100
                    ? 'bg-destructive'
                    : budget.level === 80
                      ? 'bg-highlight'
                      : 'bg-primary',
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
            {budget.level ? (
              <p className='text-muted-foreground text-xs'>
                {LEVEL_COPY[budget.level]}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Daily cost as bars; each bar is also readable from its title. */
export function CostTrend({ report }: { report: WhatsAppCostReportDTO }) {
  const { trend } = report
  const max = Math.max(...trend.map((point) => point.cost), 0.000001)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tendência diária</CardTitle>
        <CardDescription>
          Custo variável da Meta por dia (as mensalidades não entram aqui).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {trend.length === 0 ? (
          <p className='py-6 text-center text-muted-foreground text-sm'>
            Sem envios entre {formatFullDay(report.from)} e{' '}
            {formatFullDay(report.to)}.
          </p>
        ) : (
          <div
            role='img'
            aria-label={`Custo diário de ${formatFullDay(report.from)} a ${formatFullDay(report.to)}`}
            className='flex h-40 items-end gap-1'
          >
            {trend.map((point) => (
              <div
                key={point.date}
                className='flex h-full min-w-0 flex-1 flex-col justify-end'
                title={`${formatFullDay(point.date)}: ${formatBrl(point.cost)} (${formatCount(point.messages)} msg)`}
              >
                <div
                  className='w-full rounded-t bg-primary'
                  style={{
                    height: `${Math.max(2, (point.cost / max) * 100)}%`,
                  }}
                />
              </div>
            ))}
          </div>
        )}
        {trend.length > 0 ? (
          <div className='mt-1 flex justify-between text-muted-foreground text-xs'>
            <span>{formatShortDay(trend[0].date)}</span>
            <span>{formatShortDay(trend[trend.length - 1].date)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
