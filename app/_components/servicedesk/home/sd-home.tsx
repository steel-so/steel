'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  InboxIcon,
  PlusSignIcon,
  Timer02Icon,
  UserIcon,
  UserQuestion01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  useSdTicketRealtime,
  useSdTicketSummary,
  useSdTickets,
} from '@/src/hooks/use-sd-tickets'
import type { SdTicketDTO, SdTicketSummaryDTO } from '@/types/sd-ticket'
import { sdTodayLocal } from '../board/sd-board-state'
import { SdTicketRow } from '../board/sd-list-view'
import { SdCreateTicketSheet } from '../ticket/sd-create-ticket-sheet'
import { useSdNow } from '../ticket/sd-ticket-badges'
import { SD_TONE_TEXT, sdSlaSortKey } from '../ticket/sd-ticket-meta'

/** "Bom dia", "Boa tarde", "Boa noite" — by the hour in `timeZone`, so the
 * server render (UTC) and the browser agree (hydration error #418 otherwise). */
export function sdGreeting(
  now: Date = new Date(),
  timeZone = 'America/Sao_Paulo',
): string {
  const hourIn = (zone: string) =>
    Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: zone,
      }).format(now),
    )
  let hour: number
  try {
    hour = hourIn(timeZone)
  } catch {
    // A malformed cookie value must not break the page.
    hour = hourIn('America/Sao_Paulo')
  }
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export interface SdKpi {
  id: string
  label: string
  value: number
  /** Filtros do quadro `/tickets` ao clicar. */
  query: string
  tone: 'default' | 'warning' | 'danger' | 'success'
  icon: IconSvgElement
}

/** Indicadores da página inicial a partir do resumo da API. */
export function sdHomeKpis(
  summary: SdTicketSummaryDTO,
  now: Date = new Date(),
): SdKpi[] {
  const open =
    summary.byPhaseCategory.NEW +
    summary.byPhaseCategory.IN_PROGRESS +
    summary.byPhaseCategory.WAITING
  return [
    {
      id: 'open',
      label: 'Abertos',
      value: open,
      query: 'mode=list',
      tone: 'default',
      icon: InboxIcon,
    },
    {
      id: 'mine',
      label: 'Meus abertos',
      value: summary.myOpen,
      query: 'mode=list&assigneeIds=me',
      tone: 'default',
      icon: UserIcon,
    },
    {
      id: 'unassigned',
      label: 'Não atribuídos',
      value: summary.unassigned,
      query: 'mode=list&assigneeIds=unassigned',
      tone: summary.unassigned > 0 ? 'warning' : 'default',
      icon: UserQuestion01Icon,
    },
    {
      id: 'at_risk',
      label: 'SLA em risco',
      value: summary.atRisk,
      query: 'mode=list&sla=at_risk',
      tone: summary.atRisk > 0 ? 'warning' : 'success',
      icon: Timer02Icon,
    },
    {
      id: 'breached',
      label: 'SLA violado',
      value: summary.breached,
      query: 'mode=list&sla=breached',
      tone: summary.breached > 0 ? 'danger' : 'success',
      icon: Alert02Icon,
    },
    {
      id: 'today',
      label: 'Criados hoje',
      value: summary.createdToday,
      query: `mode=list&includeClosed=true&createdFrom=${sdTodayLocal(now)}`,
      tone: 'default',
      icon: CheckmarkCircle02Icon,
    },
  ]
}

const TONE: Record<SdKpi['tone'], string> = {
  default: 'text-foreground',
  warning: SD_TONE_TEXT.amber,
  danger: SD_TONE_TEXT.red,
  success: SD_TONE_TEXT.emerald,
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card/40',
        className,
      )}
    >
      <header className='flex items-center gap-2 border-b px-4 py-2.5'>
        <h2 className='font-semibold text-sm'>{title}</h2>
        <div className='ml-auto'>{action}</div>
      </header>
      {children}
    </section>
  )
}

function TicketList({
  tickets,
  slug,
  now,
  loading,
  empty,
}: {
  tickets: SdTicketDTO[]
  slug: string
  now: Date
  loading: boolean
  empty: string
}) {
  if (loading) {
    return (
      <div className='flex flex-col gap-2 p-3'>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={`sk-${i}`} className='h-8 w-full' />
        ))}
      </div>
    )
  }
  if (tickets.length === 0) {
    return (
      <p className='px-4 py-8 text-center text-muted-foreground text-sm'>
        {empty}
      </p>
    )
  }
  return (
    <div>
      {tickets.map((t) => (
        <SdTicketRow key={t.id} ticket={t} slug={slug} now={now} showType />
      ))}
    </div>
  )
}

/**
 * Início do ServiceDesk (agentes): saudação, indicadores, minha fila por
 * urgência de SLA, SLA em risco/violado e atividade recente.
 */
export function SdHome({
  workspaceId,
  slug,
  userName,
  timeZone = 'America/Sao_Paulo',
}: {
  workspaceId: string
  slug: string
  userName: string
  /** The user's preference timezone (cookie `steel.tz`). */
  timeZone?: string
}) {
  const now = useSdNow(60_000)
  const [creating, setCreating] = useState(false)
  useSdTicketRealtime(workspaceId)
  const summary = useSdTicketSummary(workspaceId)
  const mine = useSdTickets(workspaceId, {
    assigneeIds: ['me'],
    pageSize: 50,
    sort: 'resolutionDueAt',
    order: 'asc',
  })
  const risk = useSdTickets(workspaceId, {
    sla: 'at_risk',
    pageSize: 8,
    sort: 'resolutionDueAt',
    order: 'asc',
  })
  const breached = useSdTickets(workspaceId, {
    sla: 'breached',
    pageSize: 8,
    sort: 'resolutionDueAt',
    order: 'asc',
  })
  const recent = useSdTickets(workspaceId, {
    pageSize: 8,
    sort: 'lastActivityAt',
    order: 'desc',
    includeClosed: true,
  })

  const queue = [...(mine.data?.items ?? [])]
    .sort((a, b) => sdSlaSortKey(a, now) - sdSlaSortKey(b, now))
    .slice(0, 10)
  const slaList = [...(breached.data?.items ?? []), ...(risk.data?.items ?? [])]
  const firstName = userName.trim().split(/\s+/)[0] ?? ''
  const base = `/${slug}/servicedesk`

  return (
    <div className='flex h-full flex-col gap-5 overflow-y-auto p-5'>
      <div className='flex flex-wrap items-end gap-3'>
        <div>
          <h1 className='font-semibold text-2xl tracking-tight'>
            {sdGreeting(now, timeZone)}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className='text-muted-foreground text-sm'>
            {summary.data
              ? `Você tem ${summary.data.myOpen} chamado${summary.data.myOpen === 1 ? '' : 's'} aberto${summary.data.myOpen === 1 ? '' : 's'} e ${summary.data.unassigned} aguardando responsável.`
              : 'Carregando sua fila…'}
          </p>
        </div>
        <div className='ml-auto flex gap-2'>
          <Link
            href={`${base}/tickets`}
            className='inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted'
          >
            Ver quadro
            <SteelIcon
              icon={ArrowRight01Icon}
              strokeWidth={2}
              className='size-4'
            />
          </Link>
          <Button size='sm' onClick={() => setCreating(true)}>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Novo chamado
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
        {summary.isLoading || !summary.data
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={`kpi-${i}`} className='h-20 rounded-xl' />
            ))
          : sdHomeKpis(summary.data, now).map((kpi) => (
              <Link
                key={kpi.id}
                href={`${base}/tickets?${kpi.query}`}
                className='group flex flex-col gap-1 rounded-xl border bg-card/60 p-3 transition-colors hover:border-primary/40'
              >
                <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                  <SteelIcon
                    icon={kpi.icon}
                    strokeWidth={2}
                    className='size-3.5'
                  />
                  {kpi.label}
                </span>
                <span
                  data-kpi={kpi.id}
                  className={cn(
                    'font-semibold text-2xl tabular-nums',
                    TONE[kpi.tone],
                  )}
                >
                  {kpi.value}
                </span>
              </Link>
            ))}
      </div>

      <div className='grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
        <Panel
          title='Minha fila'
          action={
            <Link
              href={`${base}/tickets?mode=list&assigneeIds=me`}
              className='text-muted-foreground text-xs hover:text-foreground'
            >
              Ver todos
            </Link>
          }
        >
          <TicketList
            tickets={queue}
            slug={slug}
            now={now}
            loading={mine.isLoading}
            empty='Nada na sua fila. Bom trabalho!'
          />
        </Panel>
        <Panel
          title='SLA em risco e violado'
          action={
            <Link
              href={`${base}/tickets?mode=list&group=sla`}
              className='text-muted-foreground text-xs hover:text-foreground'
            >
              Ver todos
            </Link>
          }
        >
          <TicketList
            tickets={slaList}
            slug={slug}
            now={now}
            loading={risk.isLoading || breached.isLoading}
            empty='Nenhum chamado com SLA em risco.'
          />
        </Panel>
      </div>

      <Panel title='Atividade recente'>
        <TicketList
          tickets={recent.data?.items ?? []}
          slug={slug}
          now={now}
          loading={recent.isLoading}
          empty='Sem atividade ainda.'
        />
      </Panel>

      <SdCreateTicketSheet
        workspaceId={workspaceId}
        slug={slug}
        open={creating}
        onOpenChange={setCreating}
        defaultType='INCIDENT'
      />
    </div>
  )
}
