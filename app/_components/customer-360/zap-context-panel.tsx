'use client'

import {
  Add01Icon,
  Cancel01Icon,
  Ticket01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { ApiError } from '@/src/hooks/_fetch'
import {
  useCustomer360,
  useCustomer360Actions,
} from '@/src/hooks/use-customer-360'
import { toDisplayPhone } from '@/src/lib/phone-br'
import type { Customer360DTO } from '@/types/customer-360'
import {
  Customer360Block,
  Customer360HealthBadge,
  LEAD_STAGE_LABEL,
  OpportunityRows,
  TicketRows,
} from './customer-360-parts'

type ActionKind = 'opportunity' | 'task'

const ACTION_COPY: Record<
  ActionKind,
  { button: string; label: string; placeholder: string; done: string }
> = {
  opportunity: {
    button: 'Criar oportunidade',
    label: 'Nome da oportunidade',
    placeholder: 'Ex.: Plano empresarial',
    done: 'Oportunidade criada.',
  },
  task: {
    button: 'Criar tarefa',
    label: 'O que precisa ser feito',
    placeholder: 'Ex.: Retornar a ligação',
    done: 'Tarefa criada.',
  },
}

function QuickActions({
  workspaceId,
  data,
  contactName,
  contactWaId,
}: {
  workspaceId: string
  data: Customer360DTO
  contactName: string | null
  contactWaId: string
}) {
  const actions = useCustomer360Actions(workspaceId)
  const [open, setOpen] = useState<ActionKind | null>(null)
  const [title, setTitle] = useState('')
  const displayName = contactName?.trim() || toDisplayPhone(contactWaId)
  const known = Boolean(data.person || data.company)
  const hasLead = data.leads.length > 0
  const pending =
    actions.createLead.isPending ||
    actions.createOpportunity.isPending ||
    actions.createTask.isPending

  function close() {
    setOpen(null)
    setTitle('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const text = title.trim()
    if (!open || !text) return
    const done = () => {
      notify.success(ACTION_COPY[open].done)
      close()
    }
    if (open === 'opportunity') {
      actions.createOpportunity.mutate(
        {
          name: text,
          companyId: data.company?.id,
          pointOfContactId: data.person?.id,
        },
        {
          onSuccess: done,
          onError: (error) =>
            notify.error(error, 'Não foi possível criar a oportunidade.'),
        },
      )
      return
    }
    actions.createTask.mutate(
      {
        title: text,
        personId: data.person?.id,
        companyId: data.company?.id,
      },
      {
        onSuccess: done,
        onError: (error) =>
          notify.error(error, 'Não foi possível criar a tarefa.'),
      },
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap gap-2'>
        {!known && !hasLead ? (
          <Button
            type='button'
            size='xs'
            variant='outline'
            disabled={pending}
            title='Cadastra este contato como lead no CRM'
            onClick={() =>
              actions.createLead.mutate(
                { name: displayName, phone: contactWaId },
                {
                  onSuccess: () => notify.success('Lead criado no CRM.'),
                  onError: (error) =>
                    notify.error(error, 'Não foi possível criar o lead.'),
                },
              )
            }
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Criar lead
          </Button>
        ) : null}
        {(['opportunity', 'task'] as const).map((kind) => (
          <Button
            key={kind}
            type='button'
            size='xs'
            variant='outline'
            disabled={pending}
            aria-pressed={open === kind}
            onClick={() => (open === kind ? close() : setOpen(kind))}
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            {ACTION_COPY[kind].button}
          </Button>
        ))}
      </div>
      {open ? (
        <form onSubmit={submit} className='flex items-center gap-1.5'>
          <Input
            autoFocus
            value={title}
            aria-label={ACTION_COPY[open].label}
            placeholder={ACTION_COPY[open].placeholder}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button
            type='submit'
            size='sm'
            disabled={pending || title.trim().length === 0}
            title={
              title.trim().length === 0
                ? 'Escreva um nome para continuar'
                : undefined
            }
          >
            Criar
          </Button>
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            aria-label='Cancelar'
            onClick={close}
          >
            <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
          </Button>
        </form>
      ) : null}
      {!known ? (
        <p className='text-muted-foreground text-xs'>
          {hasLead
            ? 'Este contato já é um lead aberto. Novas oportunidades e tarefas ficam sem empresa até a conversão.'
            : 'Este contato ainda não está no CRM. Crie um lead para acompanhar a conversa.'}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Context panel of a zap conversation: who the contact is in the CRM, open
 * deals and leads, open tickets, and the quick actions an agent needs without
 * leaving the chat. Quiet when the user has no CRM access.
 */
export function ZapContextPanel({
  workspaceId,
  slug,
  conversation,
}: {
  workspaceId: string
  slug: string
  conversation: {
    id: string
    contactName: string | null
    contactWaId: string
  }
}) {
  const query = useCustomer360(workspaceId, { conversationId: conversation.id })

  let body: React.ReactNode
  if (query.isLoading) {
    body = (
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-20 w-full' />
      </div>
    )
  } else if (query.isError) {
    const forbidden =
      query.error instanceof ApiError &&
      (query.error.status === 403 || query.error.status === 404)
    body = (
      <div className='flex flex-col items-start gap-2 text-sm'>
        <p className={forbidden ? 'text-muted-foreground' : 'text-destructive'}>
          {forbidden
            ? 'O contexto do CRM não está disponível para você neste workspace.'
            : query.error instanceof Error
              ? query.error.message
              : 'Não foi possível carregar o contexto do cliente.'}
        </p>
        {forbidden ? null : (
          <Button size='sm' variant='outline' onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        )}
      </div>
    )
  } else if (query.data) {
    const data = query.data
    const { company, person, health } = data
    body = (
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-1.5'>
          <p className='font-medium text-sm'>
            {person?.name ??
              conversation.contactName ??
              toDisplayPhone(conversation.contactWaId)}
          </p>
          {company ? (
            <p className='text-muted-foreground text-xs'>
              {company.name}
              {company.accountOwnerName
                ? ` · conta de ${company.accountOwnerName}`
                : ''}
            </p>
          ) : null}
          {person?.jobTitle ? (
            <p className='text-muted-foreground text-xs'>{person.jobTitle}</p>
          ) : null}
          {health ? (
            <div>
              <Customer360HealthBadge health={health} />
            </div>
          ) : null}
        </div>

        <QuickActions
          workspaceId={workspaceId}
          data={data}
          contactName={conversation.contactName}
          contactWaId={conversation.contactWaId}
        />

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

        <Customer360Block
          title='Oportunidades'
          count={data.opportunities.length}
          empty={
            data.opportunities.length === 0
              ? 'Nenhuma oportunidade ligada a este contato.'
              : undefined
          }
        >
          <OpportunityRows slug={slug} items={data.opportunities.slice(0, 5)} />
        </Customer360Block>

        {data.available.servicedesk ? (
          <Customer360Block
            title='Chamados'
            count={data.openTickets}
            empty={
              data.tickets.length === 0
                ? 'Nenhum chamado para este cliente.'
                : undefined
            }
          >
            <TicketRows slug={slug} items={data.tickets.slice(0, 5)} />
            <Link
              href={`/${slug}/servicedesk/requests`}
              className='mt-1 inline-flex items-center gap-1 text-primary text-xs hover:underline'
            >
              <SteelIcon icon={Ticket01Icon} strokeWidth={2} className='size-3' />
              Ir para os chamados
            </Link>
          </Customer360Block>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className='flex flex-col gap-3 p-4'
      data-testid='zap-context-panel'
      aria-label='Contexto do cliente'
    >
      <h3 className='font-semibold text-sm'>Contexto do cliente</h3>
      {body}
    </div>
  )
}
