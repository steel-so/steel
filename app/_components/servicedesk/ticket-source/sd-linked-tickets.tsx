'use client'

import { Ticket01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useSdTicketsBySource } from '@/src/hooks/use-sd-ticket-source'
import type {
  SdTicketSourceKindDTO,
  SdTicketSourceLinkDTO,
} from '@/types/sd-ticket-source'
import {
  CreateTicketFromSourceButton,
  useHasServiceDesk,
} from './create-ticket-from-source-button'

function TicketRow({ ticket }: { ticket: SdTicketSourceLinkDTO }) {
  return (
    <li className='flex items-center gap-2 text-sm'>
      <Link
        href={ticket.href}
        className='shrink-0 font-medium text-primary underline-offset-4 hover:underline'
      >
        {ticket.code}
      </Link>
      <span className='min-w-0 flex-1 truncate text-muted-foreground'>
        {ticket.title}
      </span>
      <Badge variant={ticket.open ? 'secondary' : 'outline'}>
        {ticket.phaseName}
      </Badge>
    </li>
  )
}

/**
 * Chamados ligados a um registro do CRM (lead, pessoa ou oportunidade), com o
 * botão para abrir um novo. Aparece na linha do tempo do registro.
 */
export function SdLinkedTicketsSection({
  workspaceId,
  source,
  sourceId,
}: {
  workspaceId: string
  source: Exclude<SdTicketSourceKindDTO, 'conversation'>
  sourceId: string
}) {
  const hasServiceDesk = useHasServiceDesk(workspaceId)
  const tickets = useSdTicketsBySource(
    workspaceId,
    source,
    sourceId,
    hasServiceDesk,
  )

  if (!hasServiceDesk) return null
  // 403 (not a ServiceDesk agent): nothing to show, and no button to offer.
  if (tickets.isError) return null

  const list = tickets.data ?? []
  return (
    <section className='flex flex-col gap-2'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <SteelIcon
            icon={Ticket01Icon}
            strokeWidth={2}
            className='size-4 text-muted-foreground'
          />
          <span className='font-medium text-sm'>Chamados</span>
        </div>
        <CreateTicketFromSourceButton
          workspaceId={workspaceId}
          source={source}
          sourceId={sourceId}
        />
      </div>
      {tickets.isLoading ? (
        <p className='text-muted-foreground text-sm'>Carregando…</p>
      ) : list.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Nenhum chamado aberto a partir daqui.
        </p>
      ) : (
        <ul className='flex flex-col gap-1.5'>
          {list.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Faixa discreta sob o cabeçalho da conversa do zap: só aparece quando já
 * existe chamado ligado a ela, com o código, a fase e o link.
 */
export function SdConversationTicketsBar({
  workspaceId,
  conversationId,
  className,
}: {
  workspaceId: string
  conversationId: string
  className?: string
}) {
  const hasServiceDesk = useHasServiceDesk(workspaceId)
  const tickets = useSdTicketsBySource(
    workspaceId,
    'conversation',
    conversationId,
    hasServiceDesk,
  )

  const list = tickets.data ?? []
  if (!hasServiceDesk || tickets.isError || list.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-1.5 text-xs',
        className,
      )}
    >
      <span className='flex items-center gap-1.5 font-medium'>
        <SteelIcon icon={Ticket01Icon} size={14} />
        {list.length === 1 ? 'Chamado' : 'Chamados'}
      </span>
      {list.slice(0, 3).map((ticket) => (
        <Link
          key={ticket.id}
          href={ticket.href}
          title={ticket.title}
          className='flex items-center gap-1.5 hover:underline'
        >
          <span className='font-medium text-primary'>{ticket.code}</span>
          <span className='text-muted-foreground'>{ticket.phaseName}</span>
        </Link>
      ))}
      {list.length > 3 ? (
        <span className='text-muted-foreground'>+{list.length - 3}</span>
      ) : null}
    </div>
  )
}
