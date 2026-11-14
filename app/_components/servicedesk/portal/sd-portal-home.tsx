'use client'

import {
  Add01Icon,
  BookOpen01Icon,
  Ticket01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSdTicketRealtime, useSdTickets } from '@/src/hooks/use-sd-tickets'
import type { SdTicketDTO } from '@/types/sd-ticket'
import { SdPreServiceChat } from '../ai/pre-service-chat'
import { SdKbPortalBrowser } from '../knowledge'
import { SD_CLOSED_CATEGORIES } from '../ticket/sd-ticket-meta'
import { sdPortalTicketHref } from './sd-portal-ticket-row'
import {
  SdPortalKanban,
  SdPortalList,
  SdPortalTable,
  type SdPortalView,
  SdPortalViewSwitch,
} from './sd-portal-views'

const CLOSED = new Set<string>(SD_CLOSED_CATEGORIES)

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

function Section({
  title,
  description,
  icon,
  actions,
  children,
  ...rest
}: {
  title: string
  description?: string
  icon: typeof Ticket01Icon
  /** Controls on the right of the section title (the view switch). */
  actions?: React.ReactNode
  children: React.ReactNode
} & Omit<React.ComponentProps<'section'>, 'title' | 'children'>) {
  return (
    <section className='flex flex-col gap-3' {...rest}>
      <div className='flex items-center gap-2'>
        <SteelIcon
          icon={icon}
          strokeWidth={1.8}
          className='size-4 text-muted-foreground'
        />
        <h2 className='font-semibold text-sm'>{title}</h2>
        {actions ? <div className='ml-auto'>{actions}</div> : null}
      </div>
      {description ? (
        <p className='-mt-2 text-muted-foreground text-xs'>{description}</p>
      ) : null}
      {children}
    </section>
  )
}

/**
 * Início do portal do solicitante: boas-vindas, o botão grande de abrir
 * chamado, o pré-atendimento por IA (quando ligado), "Meus chamados" com o
 * progresso de cada um e a base de conhecimento para resolver sozinho.
 */
export function SdPortalHome({
  workspaceId,
  slug,
  userName,
  aiPreServiceEnabled,
}: {
  workspaceId: string
  slug: string
  userName: string
  aiPreServiceEnabled: boolean
}) {
  const router = useRouter()
  const [view, setView] = useState<SdPortalView>('list')
  useSdTicketRealtime(workspaceId)
  // 100 instead of 20: the kanban and the table show every ticket at once, so
  // a requester with more than twenty pedidos would silently lose the rest.
  const query = useSdTickets(workspaceId, {
    requesterId: 'me',
    includeClosed: true,
    pageSize: 100,
    sort: 'lastActivityAt',
    order: 'desc',
  })

  const tickets = query.data?.items ?? []
  const { open, done } = useMemo(() => {
    const result = { open: [] as SdTicketDTO[], done: [] as SdTicketDTO[] }
    for (const ticket of tickets) {
      if (CLOSED.has(ticket.phase.category)) result.done.push(ticket)
      else result.open.push(ticket)
    }
    return result
  }, [tickets])

  const greeting = firstName(userName)

  return (
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-8 p-6'>
      <header
        data-tour='sd-portal-welcome'
        className='flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between'
      >
        <div className='min-w-0'>
          <h1 className='font-semibold text-xl'>
            {greeting ? `Olá, ${greeting}!` : 'Olá!'}
          </h1>
          <p className='mt-1 text-muted-foreground text-sm'>
            Precisa de ajuda da equipe de TI? Abra um chamado — a gente cuida do
            resto e você acompanha tudo por aqui.
          </p>
        </div>
        <Link
          href={`/${slug}/servicedesk/portal/new`}
          data-tour='sd-portal-new'
          className={buttonVariants({
            size: 'lg',
            className: 'shrink-0 px-6 text-base',
          })}
        >
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Abrir chamado
        </Link>
      </header>

      {aiPreServiceEnabled ? (
        <SdPreServiceChat
          workspaceId={workspaceId}
          slug={slug}
          onTicketCreated={(ticket) =>
            router.push(sdPortalTicketHref(slug, ticket.number))
          }
        />
      ) : null}

      <Section
        data-tour='sd-portal-tickets'
        title='Meus chamados'
        description='Acompanhe o andamento de cada pedido; a barra mostra o quanto já avançou.'
        icon={Ticket01Icon}
        actions={<SdPortalViewSwitch value={view} onChange={setView} />}
      >
        {query.error ? (
          <p className='rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm'>
            {query.error.message}
          </p>
        ) : query.isLoading ? (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-24 rounded-xl' />
            <Skeleton className='h-24 rounded-xl' />
          </div>
        ) : tickets.length === 0 ? (
          <div className='flex flex-col items-center gap-2 rounded-xl border border-border border-dashed bg-card p-8 text-center'>
            <p className='font-medium text-sm'>
              Você ainda não abriu nenhum chamado
            </p>
            <p className='max-w-md text-muted-foreground text-xs'>
              Quando precisar de ajuda, clique em "Abrir chamado". Você recebe o
              número do pedido e acompanha cada passo por aqui.
            </p>
          </div>
        ) : view === 'kanban' ? (
          <SdPortalKanban slug={slug} tickets={tickets} />
        ) : view === 'table' ? (
          <SdPortalTable slug={slug} tickets={tickets} />
        ) : (
          <SdPortalList slug={slug} open={open} done={done} />
        )}
      </Section>

      <Section
        data-tour='sd-portal-help'
        title='Resolva sozinho'
        description='Passo a passo e respostas rápidas escritas pela equipe de TI.'
        icon={BookOpen01Icon}
      >
        <div className='rounded-2xl border border-border bg-card p-4'>
          <SdKbPortalBrowser workspaceId={workspaceId} />
        </div>
      </Section>
    </div>
  )
}
