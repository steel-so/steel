'use client'

import { Megaphone01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { useSdMajorIncidents } from '@/src/hooks/use-sd-major-incidents'
import type { SdMajorIncidentSummaryDTO } from '@/types/sd-major-incident'
import { EmptyState, SimpleSelect } from '../settings/sd-settings-kit'
import {
  formatIncidentDateTime,
  SdIncidentImpactBadge,
  SdIncidentStatusBadge,
} from './sd-major-incident-meta'

type Filter = 'ACTIVE' | 'RESOLVED' | 'ALL'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'RESOLVED', label: 'Resolvidos' },
  { value: 'ALL', label: 'Todos' },
]

function IncidentRow({
  slug,
  incident,
}: {
  slug: string
  incident: SdMajorIncidentSummaryDTO
}) {
  return (
    <li>
      <Link
        href={`/${slug}/servicedesk/major-incidents/${incident.id}`}
        className='flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40'
      >
        <div className='flex flex-wrap items-center gap-2'>
          <SdIncidentStatusBadge status={incident.status} />
          <SdIncidentImpactBadge impact={incident.impact} />
          <span className='font-mono text-muted-foreground text-xs'>
            {incident.ticketCode}
          </span>
        </div>
        <p className='font-medium text-sm'>{incident.title}</p>
        <p className='text-muted-foreground text-xs'>
          Declarado em {formatIncidentDateTime(incident.declaredAt)}
          {incident.commander ? ` · comandante ${incident.commander.name}` : ''}{' '}
          · {incident.childCount} chamado(s) filho(s) · {incident.pageCount}{' '}
          página(s) de status
          {incident.resolvedAt
            ? ` · resolvido em ${formatIncidentDateTime(incident.resolvedAt)}`
            : ''}
        </p>
      </Link>
    </li>
  )
}

/** Lista de incidentes maiores do workspace. */
export function SdMajorIncidentsView({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const [filter, setFilter] = useState<Filter>('ACTIVE')
  const query = useSdMajorIncidents(workspaceId, filter)
  const items = query.data?.items ?? []

  return (
    <div className='mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-col'>
          <h1 className='font-semibold text-lg'>Incidentes maiores</h1>
          <p className='text-muted-foreground text-sm'>
            Para declarar um, abra o chamado do incidente e use a aba "Incidente
            maior".
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <SimpleSelect
            value={filter}
            onChange={(value) => value && setFilter(value)}
            options={FILTERS}
            className='w-36'
          />
          <Button
            variant='outline'
            render={<Link href={`/${slug}/servicedesk/status-pages`} />}
          >
            <SteelIcon icon={Megaphone01Icon} />
            Páginas de status
          </Button>
        </div>
      </div>

      {query.error ? (
        <EmptyState>{query.error.message}</EmptyState>
      ) : query.isLoading ? (
        <EmptyState>Carregando…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>
          {filter === 'ACTIVE'
            ? 'Nenhum incidente maior ativo. Tudo calmo por aqui.'
            : 'Nenhum incidente maior encontrado.'}
        </EmptyState>
      ) : (
        <ul className='flex flex-col gap-3'>
          {items.map((incident) => (
            <IncidentRow key={incident.id} slug={slug} incident={incident} />
          ))}
        </ul>
      )}
    </div>
  )
}
