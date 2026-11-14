'use client'

import {
  Call02Icon,
  File01Icon,
  Task01Icon,
  Ticket01Icon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { HEALTH_TONE } from '@/app/_components/crm/health/health-tone'
import {
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentRelative,
  kindLabel,
  statusLabel,
} from '@/app/_components/documents/documents-tone'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { toDisplayPhone } from '@/src/lib/phone-br'
import type {
  DocumentKindDTO,
  DocumentStatusDTO,
} from '@/src/schemas/document.schema'
import type {
  Customer360CallDTO,
  Customer360ConversationDTO,
  Customer360DocumentDTO,
  Customer360HealthDTO,
  Customer360OpportunityDTO,
  Customer360TicketDTO,
} from '@/types/customer-360'

/**
 * Presentational blocks shared by the three faces of the Visão 360 (CRM tab,
 * ticket card, zap side panel). They only render what the API returned; dates
 * follow the workspace timezone through the documents formatters.
 */

const TICKET_TYPE_LABEL: Record<string, string> = {
  INCIDENT: 'Incidente',
  SERVICE_REQUEST: 'Requisição',
  CHANGE: 'Mudança',
  PROBLEM: 'Problema',
}

const STAGE_CATEGORY_LABEL: Record<string, string> = {
  OPEN: 'Em andamento',
  WON: 'Ganha',
  LOST: 'Perdida',
}

const CONVERSATION_STATUS_LABEL: Record<string, string> = {
  NEW: 'Nova',
  IN_PROGRESS: 'Em atendimento',
  CLOSED: 'Encerrada',
}

const CALL_STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Na fila',
  DIALING: 'Chamando',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  BUSY: 'Ocupado',
  NO_ANSWER: 'Sem resposta',
  CANCELED: 'Cancelada',
  EXTENSION_NO_ANSWER: 'Ramal não atendeu',
  FAILED: 'Falhou',
}

export const LEAD_STAGE_LABEL: Record<string, string> = {
  RECEIVED: 'Recebido',
  IN_CONTACT: 'Em contato',
  QUALIFIED: 'Qualificado',
  OPPORTUNITY: 'Oportunidade',
  PROPOSAL: 'Proposta',
  CLOSED: 'Fechado',
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes} min ${rest} s` : `${rest} s`
}

export function Customer360Block({
  title,
  count,
  children,
  empty,
}: {
  title: string
  count?: number
  children: ReactNode
  /** Text shown when there is nothing; omit to render `children` as is. */
  empty?: string
}) {
  return (
    <section className='flex flex-col gap-1.5'>
      <h4 className='flex items-center gap-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
        {title}
        {count !== undefined && count > 0 ? (
          <span className='rounded-full bg-muted px-1.5 text-[11px] text-foreground normal-case tabular-nums'>
            {count}
          </span>
        ) : null}
      </h4>
      {empty ? (
        <p className='text-muted-foreground text-xs'>{empty}</p>
      ) : (
        children
      )}
    </section>
  )
}

function Row({
  icon,
  href,
  title,
  meta,
  aside,
}: {
  icon: Parameters<typeof SteelIcon>[0]['icon']
  href?: string
  title: string
  meta: string
  aside?: ReactNode
}) {
  const body = (
    <>
      <SteelIcon
        icon={icon}
        strokeWidth={2}
        className='mt-0.5 size-3.5 shrink-0 text-muted-foreground'
      />
      <span className='min-w-0 flex-1'>
        <span className='block truncate font-medium text-sm'>{title}</span>
        <span className='block truncate text-muted-foreground text-xs'>
          {meta}
        </span>
      </span>
      {aside ? <span className='shrink-0 text-xs'>{aside}</span> : null}
    </>
  )
  const className = 'flex items-start gap-2 rounded-md px-1.5 py-1'
  return href ? (
    <Link href={href} className={cn(className, 'hover:bg-muted')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function Customer360HealthBadge({
  health,
}: {
  health: Customer360HealthDTO
}) {
  return (
    <span
      data-health-level={health.level}
      title={health.nextActionLabel}
      className={cn(
        'rounded-md border px-1.5 py-0.5 font-medium text-[11px]',
        HEALTH_TONE[health.level],
      )}
    >
      {health.levelLabel} · saúde {health.healthScore}/100
    </span>
  )
}

export function OpportunityRows({
  slug,
  items,
}: {
  slug: string
  items: Customer360OpportunityDTO[]
}) {
  return (
    <ul className='flex flex-col'>
      {items.map((deal) => (
        <li key={deal.id}>
          <Row
            icon={Task01Icon}
            href={`/${slug}/crm/opportunities`}
            title={deal.name}
            meta={`${deal.pipelineName} · ${deal.stageName} · ${
              STAGE_CATEGORY_LABEL[deal.stageCategory] ?? deal.stageCategory
            }`}
            aside={formatDocumentMoney(deal.amount)}
          />
        </li>
      ))}
    </ul>
  )
}

export function TicketRows({
  slug,
  items,
}: {
  slug: string
  items: Customer360TicketDTO[]
}) {
  return (
    <ul className='flex flex-col'>
      {items.map((ticket) => (
        <li key={ticket.id}>
          <Row
            icon={Ticket01Icon}
            href={`/${slug}/servicedesk/tickets/${ticket.number}`}
            title={`#${ticket.number} · ${ticket.title}`}
            meta={[
              TICKET_TYPE_LABEL[ticket.type] ?? ticket.type,
              ticket.phaseName,
              ticket.priorityName,
              ticket.csatScore !== null
                ? `satisfação ${ticket.csatScore}/5`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            aside={
              ticket.slaBreached ? (
                <span className='font-medium text-destructive'>
                  SLA estourado
                </span>
              ) : ticket.open && ticket.resolutionDueAt ? (
                <span className='text-muted-foreground'>
                  prazo {formatDocumentDate(ticket.resolutionDueAt)}
                </span>
              ) : null
            }
          />
        </li>
      ))}
    </ul>
  )
}

export function ConversationRows({
  slug,
  items,
  now,
}: {
  slug: string
  items: Customer360ConversationDTO[]
  now: number
}) {
  return (
    <ul className='flex flex-col'>
      {items.map((conversation) => (
        <li key={conversation.id}>
          <Row
            icon={WhatsappIcon}
            href={`/${slug}/zap?conversa=${conversation.id}`}
            title={
              conversation.contactName ??
              toDisplayPhone(conversation.contactPhone)
            }
            meta={`${conversation.connectionLabel} · ${
              CONVERSATION_STATUS_LABEL[conversation.status] ??
              conversation.status
            }`}
            aside={
              <span className='text-muted-foreground'>
                {formatDocumentRelative(conversation.lastMessageAt, now)}
              </span>
            }
          />
        </li>
      ))}
    </ul>
  )
}

export function CallRows({
  slug,
  items,
  now,
}: {
  slug: string
  items: Customer360CallDTO[]
  now: number
}) {
  return (
    <ul className='flex flex-col'>
      {items.map((call) => (
        <li key={call.id}>
          <Row
            icon={Call02Icon}
            href={
              call.conversationId
                ? `/${slug}/zap?conversa=${call.conversationId}`
                : undefined
            }
            title={`${call.direction === 'INBOUND' ? 'Recebida' : 'Feita'} · ${
              CALL_STATUS_LABEL[call.status] ?? call.status
            }`}
            meta={call.summary ?? formatDuration(call.durationSeconds)}
            aside={
              <span className='text-muted-foreground'>
                {formatDocumentRelative(call.createdAt, now)}
              </span>
            }
          />
        </li>
      ))}
    </ul>
  )
}

export function DocumentRows({
  slug,
  items,
}: {
  slug: string
  items: Customer360DocumentDTO[]
}) {
  return (
    <ul className='flex flex-col'>
      {items.map((doc) => (
        <li key={doc.id}>
          <Row
            icon={File01Icon}
            href={`/${slug}/crm/documents/${doc.id}`}
            title={doc.title}
            meta={`${kindLabel(doc.kind as DocumentKindDTO)} · ${statusLabel(
              doc.status as DocumentStatusDTO,
            )}`}
            aside={
              doc.totalValue !== null
                ? formatDocumentMoney(doc.totalValue)
                : null
            }
          />
        </li>
      ))}
    </ul>
  )
}
