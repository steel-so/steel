'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/src/hooks/_fetch'
import { useCustomer360 } from '@/src/hooks/use-customer-360'
import { toDisplayPhone } from '@/src/lib/phone-br'
import type { Customer360DTO, Customer360MatchDTO } from '@/types/customer-360'
import {
  CallRows,
  ConversationRows,
  Customer360Block,
  Customer360HealthBadge,
  DocumentRows,
  LEAD_STAGE_LABEL,
  OpportunityRows,
  TicketRows,
} from './customer-360-parts'

const MATCH_HINT: Record<Customer360MatchDTO, string | null> = {
  person: null,
  company: null,
  phone: 'Cadastro encontrado pelo telefone',
  email: 'Cadastro encontrado pelo e-mail',
  cnpj: 'Empresa encontrada pelo CNPJ',
  name: 'Empresa encontrada pelo nome. Confira se é a mesma.',
  none: 'Nenhum cadastro do CRM encontrado',
}

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** 403/404 here mean "not for you" (module off, no permission): stay quiet. */
function isNotForViewer(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404)
}

function Summary({ data }: { data: Customer360DTO }) {
  const { company, person, health } = data
  const hint = MATCH_HINT[data.match]
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        {company ? (
          <span className='font-medium text-sm'>{company.name}</span>
        ) : null}
        {health ? <Customer360HealthBadge health={health} /> : null}
      </div>
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs'>
        {company?.arr !== null && company?.arr !== undefined ? (
          <>
            <dt className='text-muted-foreground'>Receita anual (ARR)</dt>
            <dd>{brl.format(company.arr)}</dd>
          </>
        ) : null}
        {company?.accountOwnerName ? (
          <>
            <dt className='text-muted-foreground'>Responsável pela conta</dt>
            <dd>{company.accountOwnerName}</dd>
          </>
        ) : null}
        {person && person.phones.length > 0 ? (
          <>
            <dt className='text-muted-foreground'>Telefone</dt>
            <dd>{person.phones.map((phone) => toDisplayPhone(phone)).join(', ')}</dd>
          </>
        ) : null}
      </dl>
      {health && health.level !== 'LOW' ? (
        <p className='text-muted-foreground text-xs'>
          Próxima ação sugerida: {health.nextActionLabel}
        </p>
      ) : null}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

/**
 * "Visão 360" section of a CRM person or company record: tickets (with SLA and
 * satisfaction), WhatsApp conversations, calls, documents, deals and health in
 * one place. Blocks the user cannot see (module off, no permission) are left
 * out instead of showing an error.
 */
export function Customer360Panel({
  workspaceId,
  slug,
  personId,
  companyId,
}: {
  workspaceId: string
  slug: string
  personId?: string
  companyId?: string
}) {
  const query = useCustomer360(workspaceId, { personId, companyId })
  // Stable "now" for the relative dates of one render pass.
  const [now] = useState(() => Date.now())

  if (query.isLoading) {
    return (
      <section aria-label='Visão 360' className='flex flex-col gap-2'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-16 w-full' />
      </section>
    )
  }
  if (query.isError) {
    if (isNotForViewer(query.error)) return null
    return (
      <section aria-label='Visão 360' className='flex flex-col items-start gap-2'>
        <p className='text-destructive text-sm'>
          {query.error instanceof Error
            ? query.error.message
            : 'Não foi possível carregar a visão 360.'}
        </p>
        <Button size='sm' variant='outline' onClick={() => query.refetch()}>
          Tentar novamente
        </Button>
      </section>
    )
  }
  const data = query.data
  if (!data) return null

  return (
    <section
      aria-label='Visão 360'
      data-testid='customer-360'
      className='flex flex-col gap-4 rounded-lg border bg-card p-3'
    >
      <h3 className='font-semibold text-sm'>Visão 360</h3>
      <Summary data={data} />

      <Customer360Block
        title='Oportunidades'
        count={data.opportunities.length}
        empty={
          data.opportunities.length === 0
            ? 'Nenhuma oportunidade para este cliente.'
            : undefined
        }
      >
        <OpportunityRows slug={slug} items={data.opportunities} />
      </Customer360Block>

      {data.leads.length > 0 ? (
        <Customer360Block title='Leads abertos' count={data.leads.length}>
          <ul className='flex flex-col text-sm'>
            {data.leads.map((lead) => (
              <li key={lead.id} className='px-1.5 py-1'>
                {lead.name}
                <span className='text-muted-foreground text-xs'>
                  {' '}
                  · {LEAD_STAGE_LABEL[lead.stage] ?? lead.stage}
                </span>
              </li>
            ))}
          </ul>
        </Customer360Block>
      ) : null}

      {data.available.servicedesk ? (
        <Customer360Block
          title='Chamados'
          count={data.openTickets}
          empty={
            data.tickets.length === 0
              ? 'Nenhum chamado encontrado para este cliente.'
              : undefined
          }
        >
          <TicketRows slug={slug} items={data.tickets} />
        </Customer360Block>
      ) : null}

      {data.available.whatsapp ? (
        <>
          <Customer360Block
            title='Conversas no WhatsApp'
            count={data.conversations.length}
            empty={
              data.conversations.length === 0
                ? 'Nenhuma conversa com os telefones deste cliente.'
                : undefined
            }
          >
            <ConversationRows slug={slug} items={data.conversations} now={now} />
          </Customer360Block>
          {data.calls.length > 0 ? (
            <Customer360Block title='Ligações' count={data.calls.length}>
              <CallRows slug={slug} items={data.calls} now={now} />
            </Customer360Block>
          ) : null}
        </>
      ) : null}

      {data.documents.length > 0 ? (
        <Customer360Block title='Documentos' count={data.documents.length}>
          <DocumentRows slug={slug} items={data.documents} />
        </Customer360Block>
      ) : null}
    </section>
  )
}
