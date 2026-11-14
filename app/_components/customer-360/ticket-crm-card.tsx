'use client'

import Link from 'next/link'
import { toDisplayPhone } from '@/src/lib/phone-br'
import type { Customer360DTO } from '@/types/customer-360'
import { Customer360HealthBadge, OpportunityRows } from './customer-360-parts'

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** Open deals shown in the ticket card; the CRM tab lists them all. */
const OPEN_DEALS_SHOWN = 3

/**
 * Body of the "Cliente no CRM" card inside a ServiceDesk ticket: who owns the
 * account, how much it is worth, how healthy it is and which deals are open,
 * so the agent does not treat a key customer like any other. The caller owns
 * the collapsible frame and decides when there is something to show.
 */
export function TicketCrmCardBody({
  data,
  slug,
}: {
  data: Customer360DTO
  slug: string
}) {
  const { company, person, health } = data
  const openDeals = data.opportunities.filter(
    (deal) => deal.stageCategory === 'OPEN',
  )
  const shown = openDeals.slice(0, OPEN_DEALS_SHOWN)

  return (
    <div className='flex flex-col gap-2' data-testid='ticket-crm-card'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium text-sm'>
          {company?.name ?? person?.name}
        </span>
        {health ? <Customer360HealthBadge health={health} /> : null}
      </div>
      <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs'>
        {company?.arr !== null && company?.arr !== undefined ? (
          <>
            <dt className='text-muted-foreground'>ARR</dt>
            <dd>{brl.format(company.arr)}</dd>
          </>
        ) : null}
        {company?.accountOwnerName ? (
          <>
            <dt className='text-muted-foreground'>Dono da conta</dt>
            <dd>{company.accountOwnerName}</dd>
          </>
        ) : null}
        {person ? (
          <>
            <dt className='text-muted-foreground'>Contato</dt>
            <dd>
              {person.name}
              {person.phones[0] ? ` · ${toDisplayPhone(person.phones[0])}` : ''}
            </dd>
          </>
        ) : null}
      </dl>
      {health && health.level !== 'LOW' ? (
        <p className='text-muted-foreground text-xs'>
          Atenção: {health.nextActionLabel}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <div className='flex flex-col gap-1'>
          <p className='text-muted-foreground text-xs'>
            {openDeals.length === 1
              ? '1 oportunidade aberta'
              : `${openDeals.length} oportunidades abertas`}
          </p>
          <OpportunityRows slug={slug} items={shown} />
        </div>
      ) : null}
      <Link
        href={company ? `/${slug}/crm/companies` : `/${slug}/crm/people`}
        className='text-primary text-xs hover:underline'
      >
        Abrir no CRM
      </Link>
    </div>
  )
}
