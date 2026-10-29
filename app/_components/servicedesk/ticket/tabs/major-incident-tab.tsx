'use client'

import { FireIcon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import {
  useDeclareSdMajorIncident,
  useSdTicketMajorIncident,
} from '@/src/hooks/use-sd-major-incidents'
import { useSdTicketRealtime } from '@/src/hooks/use-sd-tickets'
import type { SdMajorIncidentSummaryDTO } from '@/types/sd-major-incident'
import { SdDeclareIncidentDialog } from '../../major-incident/sd-major-incident-dialogs'
import {
  formatIncidentDateTime,
  SdIncidentImpactBadge,
  SdIncidentStatusBadge,
} from '../../major-incident/sd-major-incident-meta'
import { EmptyState } from '../../settings/sd-settings-kit'
import { SdAgentOnlyNotice } from '../shared/sd-tab-bits'
import type { SdTicketTabProps } from './types'

function IncidentCard({
  slug,
  incident,
  relation,
}: {
  slug: string
  incident: SdMajorIncidentSummaryDTO
  relation: 'master' | 'child'
}) {
  return (
    <section className='flex flex-col gap-3 rounded-lg border border-border bg-card p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <SdIncidentStatusBadge status={incident.status} />
        <SdIncidentImpactBadge impact={incident.impact} />
        <span className='text-muted-foreground text-xs'>
          {relation === 'master'
            ? 'Este chamado é o principal do incidente'
            : `Chamado filho do incidente ${incident.ticketCode}`}
        </span>
      </div>
      <p className='font-medium text-sm'>{incident.title}</p>
      <div className='flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs'>
        <span>
          Declarado em {formatIncidentDateTime(incident.declaredAt)} ·{' '}
          {incident.childCount} chamado(s) filho(s) · {incident.pageCount}{' '}
          página(s) de status
        </span>
        <Button
          size='sm'
          variant='outline'
          render={
            <Link
              href={`/${slug}/servicedesk/major-incidents/${incident.id}`}
            />
          }
        >
          Abrir incidente
        </Button>
      </div>
    </section>
  )
}

/** Incidente maior do chamado: declarar, ou ver a qual ele pertence. */
export function SdTicketMajorIncidentTab({
  workspaceId,
  slug,
  ticket,
  mode,
}: SdTicketTabProps) {
  const isAgent = mode === 'agent'
  useSdTicketRealtime(isAgent ? workspaceId : undefined)
  const query = useSdTicketMajorIncident(isAgent ? workspaceId : '', ticket.id)
  const declare = useDeclareSdMajorIncident(workspaceId)
  const [open, setOpen] = useState(false)

  if (!isAgent) return <SdAgentOnlyNotice />
  const data = query.data

  return (
    <div className='flex flex-col gap-4 p-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex flex-col'>
          <h3 className='font-medium text-sm'>Incidente maior</h3>
          <p className='text-muted-foreground text-xs'>
            Agrupe os chamados do mesmo problema e avise os clientes numa página
            de status.
          </p>
        </div>
        {data?.canDeclare ? (
          <Button size='sm' onClick={() => setOpen(true)}>
            <SteelIcon icon={FireIcon} />
            Declarar incidente maior
          </Button>
        ) : null}
      </div>

      {query.error ? <EmptyState>{query.error.message}</EmptyState> : null}
      {data?.master ? (
        <IncidentCard slug={slug} incident={data.master} relation='master' />
      ) : null}
      {data?.child ? (
        <IncidentCard slug={slug} incident={data.child} relation='child' />
      ) : null}
      {data && !data.master && !data.child && !data.canDeclare ? (
        <EmptyState>
          Só chamados do tipo incidente podem virar incidente maior.
        </EmptyState>
      ) : null}
      {data && !data.master && !data.child && data.canDeclare ? (
        <EmptyState>
          Este chamado não faz parte de um incidente maior.
        </EmptyState>
      ) : null}

      <SdDeclareIncidentDialog
        workspaceId={workspaceId}
        open={open}
        ticketTitle={ticket.title}
        suggestedPageIds={data?.suggestedPageIds ?? []}
        pending={declare.isPending}
        onOpenChange={setOpen}
        onSubmit={async (form) => {
          try {
            const result = await declare.mutateAsync({
              ...form,
              ticketRef: ticket.id,
            })
            setOpen(false)
            notify.success('Incidente maior declarado')
            for (const warning of result.warnings) notify.error(warning)
          } catch (error) {
            notify.error(error)
          }
        }}
      />
    </div>
  )
}
