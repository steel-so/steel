'use client'

import { ThumbsDownIcon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useOptionalSteelAiWorkspace } from '@/app/_components/steel-ai/steel-ai-context'
import {
  EmptyState,
  StatTile,
  VIZ,
} from '@/app/_components/steel-ai-usage/usage-charts'
import {
  formatDayMonth,
  formatInteger,
  formatLongDay,
  formatRange,
  formatShare,
  formatUsd,
} from '@/app/_components/steel-ai-usage/usage-format'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type {
  AiQualityBreakdownItemDTO,
  AiQualityDTO,
  AiQualityLinkDTO,
  AiQualityResolutionItemDTO,
} from '@/types/ai-quality'

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
})

function rate(value: number | null): string {
  return value === null ? '—' : formatShare(value)
}

/** In-app path of a rated answer, or `null` when it cannot be opened. */
export function qualityHref(
  slug: string,
  link: AiQualityLinkDTO | null,
): string | null {
  if (!link) return null
  switch (link.kind) {
    case 'chat':
      return `/${slug}/ai/${link.conversationId}`
    case 'agent_run':
      return `/${slug}/ai/agents/${link.agentId}/runs/${link.runId}`
    case 'ticket':
      return `/${slug}/servicedesk/tickets/${link.ticketNumber}`
    case 'kb_article':
      return `/${slug}/servicedesk/knowledge/${link.articleId}`
    default:
      return `/${slug}/zap?conversa=${link.conversationId}`
  }
}

/** One horizontal bar per surface/model: approval share and volume. */
function ApprovalBars({
  items,
  label,
}: {
  items: AiQualityBreakdownItemDTO[]
  label: string
}) {
  if (items.length === 0) {
    return <EmptyState>Nenhuma avaliação no período.</EmptyState>
  }
  return (
    <ul aria-label={label} className='space-y-2.5'>
      {items.map((item) => (
        <li key={item.key || 'none'} className='space-y-1'>
          <div className='flex min-w-0 items-baseline gap-2 text-sm'>
            <span className='min-w-0 flex-1 truncate' title={item.label}>
              {item.label}
            </span>
            <span className='shrink-0 font-medium tabular-nums'>
              {rate(item.approvalRate)}
            </span>
            <span className='w-20 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
              {formatInteger(item.total)}{' '}
              {item.total === 1 ? 'avaliação' : 'avaliações'}
            </span>
          </div>
          <div className='h-2 w-full rounded-sm bg-muted' aria-hidden>
            <div
              className='h-full rounded-r-sm'
              style={{
                width: `${Math.max(1, (item.approvalRate ?? 0) * 100)}%`,
                backgroundColor: VIZ.mine,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Approval per UTC day as columns; days without ratings stay empty. */
function DailyApproval({ daily }: { daily: AiQualityDTO['daily'] }) {
  const every = Math.max(1, Math.ceil(daily.length / 8))
  return (
    <div className='space-y-1'>
      <ol className='flex h-32 items-end gap-px' aria-label='Aprovação por dia'>
        {daily.map((day) => {
          const total = day.up + day.down
          return (
            <li
              key={day.date}
              className='flex h-full min-w-0 flex-1 items-end'
              title={`${formatLongDay(day.date)}: ${
                total === 0
                  ? 'sem avaliações'
                  : `${rate(day.approvalRate)} de ${total}`
              }`}
            >
              <span className='sr-only'>
                {formatLongDay(day.date)}:{' '}
                {total === 0
                  ? 'sem avaliações'
                  : `${rate(day.approvalRate)} de aprovação em ${total}`}
              </span>
              <span
                aria-hidden
                className='w-full rounded-t-sm'
                style={{
                  height:
                    total === 0
                      ? '2px'
                      : `${Math.max(4, (day.approvalRate ?? 0) * 100)}%`,
                  backgroundColor: total === 0 ? VIZ.workspace : VIZ.mine,
                  opacity: total === 0 ? 0.3 : 1,
                }}
              />
            </li>
          )
        })}
      </ol>
      <div className='flex text-[11px] text-muted-foreground' aria-hidden>
        {daily.map((day, index) => (
          <span key={day.date} className='min-w-0 flex-1 overflow-visible'>
            {index % every === 0 ? formatDayMonth(day.date) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function ResolutionRow({
  label,
  item,
  unit,
}: {
  label: string
  item: AiQualityResolutionItemDTO
  unit: string
}) {
  return (
    <div className='grid grid-cols-2 gap-x-4 gap-y-1 border-b py-2.5 text-sm last:border-b-0 sm:grid-cols-4'>
      <span className='col-span-2 font-medium sm:col-span-1'>{label}</span>
      <span className='text-muted-foreground'>
        <span className='font-medium text-foreground tabular-nums'>
          {formatInteger(item.resolved)}
        </span>{' '}
        de {formatInteger(item.handled)} {unit}
      </span>
      <span className='tabular-nums'>{rate(item.rate)} sem humano</span>
      <span className='text-muted-foreground tabular-nums'>
        {item.costPerResolutionUsd === null
          ? 'sem resolução'
          : `${formatUsd(item.costPerResolutionUsd)} por resolução`}
      </span>
    </div>
  )
}

export function AiQualityBody({ data }: { data: AiQualityDTO }) {
  const slug = useOptionalSteelAiWorkspace()?.slug ?? ''
  const workspace = data.scope === 'workspace'
  const hasFeedback = data.totals.total > 0
  return (
    <div className='space-y-5'>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <StatTile
          label='Aprovação'
          value={rate(data.totals.approvalRate)}
          detail={formatRange(data.from, data.to)}
        />
        <StatTile
          label='Avaliações'
          value={formatInteger(data.totals.total)}
          detail={`${formatInteger(data.totals.up)} úteis · ${formatInteger(data.totals.down)} não ajudaram`}
        />
        {data.resolution ? (
          <>
            <StatTile
              label='Resolvidas sem humano'
              value={rate(data.resolution.total.rate)}
              detail={`${formatInteger(data.resolution.total.resolved)} de ${formatInteger(data.resolution.total.handled)} atendimentos da IA`}
            />
            <StatTile
              label='Custo por resolução'
              value={
                data.resolution.total.costPerResolutionUsd === null
                  ? '—'
                  : formatUsd(data.resolution.total.costPerResolutionUsd)
              }
              detail={`${formatUsd(data.resolution.total.costUsd)} no período`}
            />
          </>
        ) : null}
      </div>

      {hasFeedback ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Aprovação por dia</CardTitle>
              <CardDescription>
                Parcela de 👍 entre as avaliações de cada dia
                {workspace
                  ? ' em todo o espaço de trabalho'
                  : ' feitas por você'}
                . Dias em UTC.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DailyApproval daily={data.daily} />
            </CardContent>
          </Card>
          <div className='grid gap-5 md:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>Por superfície</CardTitle>
                <CardDescription>
                  Chat, agentes, ServiceDesk e WhatsApp.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ApprovalBars items={data.bySurface} label='Por superfície' />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Por modelo</CardTitle>
                <CardDescription>O modelo que deu a resposta.</CardDescription>
              </CardHeader>
              <CardContent>
                <ApprovalBars items={data.byModel} label='Por modelo' />
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <EmptyState>
          {workspace
            ? 'Ninguém avaliou respostas da IA neste período. Use 👍/👎 abaixo das respostas.'
            : 'Você não avaliou respostas da IA neste período. Use 👍/👎 abaixo das respostas.'}
        </EmptyState>
      )}

      {data.resolution ? (
        <Card>
          <CardHeader>
            <CardTitle>Resolução sem humano</CardTitle>
            <CardDescription>
              WhatsApp: conversas fechadas em que só a IA respondeu.
              ServiceDesk: pré-atendimentos resolvidos pela base de
              conhecimento. Custo = gasto da funcionalidade no período.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResolutionRow
              label='WhatsApp'
              item={data.resolution.whatsapp}
              unit='conversas'
            />
            <ResolutionRow
              label='ServiceDesk'
              item={data.resolution.servicedesk}
              unit='pré-atendimentos'
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Piores respostas</CardTitle>
          <CardDescription>
            Os 👎 mais recentes do período, com o motivo informado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.worst.length === 0 ? (
            <EmptyState>Nenhuma resposta mal avaliada no período.</EmptyState>
          ) : (
            <ul className='divide-y'>
              {data.worst.map((item) => {
                const href = qualityHref(slug, item.link)
                return (
                  <li key={item.id} className='space-y-1 py-3 first:pt-0'>
                    <div className='flex flex-wrap items-center gap-1.5 text-xs'>
                      <SteelIcon
                        icon={ThumbsDownIcon}
                        strokeWidth={2}
                        className='size-3.5 text-muted-foreground'
                      />
                      <Badge variant='secondary'>{item.surfaceLabel}</Badge>
                      {item.reasonLabel ? (
                        <Badge variant='outline'>{item.reasonLabel}</Badge>
                      ) : null}
                      {item.modelLabel ? (
                        <span className='text-muted-foreground'>
                          {item.modelLabel}
                        </span>
                      ) : null}
                      <span className='ml-auto text-muted-foreground tabular-nums'>
                        {item.userName ? `${item.userName} · ` : ''}
                        {dateTime.format(new Date(item.createdAt))} UTC
                      </span>
                    </div>
                    {item.comment ? (
                      <p className='whitespace-pre-wrap break-words text-sm'>
                        {item.comment}
                      </p>
                    ) : null}
                    {href ? (
                      <Link
                        href={href}
                        className='text-primary text-xs underline-offset-4 hover:underline'
                      >
                        Abrir resposta
                      </Link>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
