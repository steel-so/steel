'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  usePublicSdStatusPage,
  useSubscribeSdStatusPage,
} from '@/src/hooks/use-sd-status-pages'
import {
  SD_MAJOR_INCIDENT_STATUS_LABEL,
  SD_STATUS_PAGE_OVERALL_LABEL,
} from '@/src/lib/servicedesk/major-incident'
import type {
  SdPublicStatusIncidentDTO,
  SdPublicStatusPageDTO,
} from '@/types/sd-status-page'
import {
  formatIncidentDateTime,
  SD_INCIDENT_IMPACT_TONE,
  SdIncidentImpactBadge,
  SdIncidentStatusBadge,
  SdOverallDot,
} from '../servicedesk/major-incident/sd-major-incident-meta'
import { SD_TONE_SOFT } from '../servicedesk/sd-tone'

function UpdateList({
  incident,
  timeZone,
}: {
  incident: SdPublicStatusIncidentDTO
  timeZone: string
}) {
  return (
    <ol className='flex flex-col gap-3 border-border border-l pl-4'>
      {incident.updates.map((update) => (
        <li
          key={`${update.at}-${update.status}`}
          className='flex flex-col gap-1'
        >
          <span className='text-sm'>
            <strong className='font-medium'>
              {SD_MAJOR_INCIDENT_STATUS_LABEL[update.status]}
            </strong>
            <span className='text-muted-foreground text-xs'>
              {' · '}
              {formatIncidentDateTime(update.at, timeZone)}
            </span>
          </span>
          <p className='whitespace-pre-wrap text-muted-foreground text-sm'>
            {update.message}
          </p>
        </li>
      ))}
    </ol>
  )
}

function ActiveIncident({
  incident,
  timeZone,
}: {
  incident: SdPublicStatusIncidentDTO
  timeZone: string
}) {
  return (
    <article className='flex flex-col gap-3 rounded-lg border border-border bg-card p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <SdIncidentStatusBadge status={incident.status} />
        <SdIncidentImpactBadge impact={incident.impact} />
      </div>
      <h3 className='font-semibold text-base'>{incident.title}</h3>
      {incident.summary ? (
        <p className='text-muted-foreground text-sm'>{incident.summary}</p>
      ) : null}
      <p className='text-muted-foreground text-xs'>
        Início: {formatIncidentDateTime(incident.startedAt, timeZone)}
      </p>
      <UpdateList incident={incident} timeZone={timeZone} />
    </article>
  )
}

function SubscribeForm({ slug }: { slug: string }) {
  const subscribe = useSubscribeSdStatusPage(slug)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await subscribe.mutateAsync({ email: email.trim() })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao fazer a inscrição')
    }
  }

  if (subscribe.isSuccess) {
    return (
      <p className='rounded-md bg-muted/50 p-3 text-sm'>
        Enviamos um e-mail para <strong>{email}</strong>. Confirme a inscrição
        pelo botão da mensagem para começar a receber os avisos.
      </p>
    )
  }
  return (
    <form onSubmit={submit} className='flex flex-col gap-2 sm:flex-row'>
      <Input
        type='email'
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder='seu@email.com.br'
        aria-label='Seu e-mail'
        className='sm:max-w-xs'
      />
      <Button type='submit' disabled={subscribe.isPending || !email.trim()}>
        Receber avisos por e-mail
      </Button>
      {error ? (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      ) : null}
    </form>
  )
}

/** Página de status do cliente (pública, sem login). */
export function SdPublicStatusPage({
  slug,
  initial,
}: {
  slug: string
  initial: SdPublicStatusPageDTO
}) {
  const query = usePublicSdStatusPage(slug, initial)
  const data = query.data ?? initial
  const tone = SD_INCIDENT_IMPACT_TONE[data.overall]

  return (
    <main className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12'>
      <header className='flex flex-col gap-1'>
        <p className='text-muted-foreground text-sm'>{data.workspaceName}</p>
        <h1 className='font-semibold text-2xl'>{data.name}</h1>
        {data.description ? (
          <p className='text-muted-foreground text-sm'>{data.description}</p>
        ) : null}
      </header>

      <section
        aria-live='polite'
        className={cn(
          'flex items-center gap-3 rounded-lg border px-4 py-3',
          SD_TONE_SOFT[tone],
        )}
      >
        <SdOverallDot overall={data.overall} />
        <span className='font-medium text-sm'>
          {SD_STATUS_PAGE_OVERALL_LABEL[data.overall]}
        </span>
      </section>

      {data.services.length > 0 ? (
        <section className='flex flex-col gap-2'>
          <h2 className='font-medium text-sm'>Serviços acompanhados</h2>
          <ul className='flex flex-wrap gap-1.5'>
            {data.services.map((service) => (
              <li key={service}>
                <Badge variant='secondary'>{service}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.active.length > 0 ? (
        <section className='flex flex-col gap-3'>
          <h2 className='font-medium text-sm'>Incidentes em andamento</h2>
          {data.active.map((incident) => (
            <ActiveIncident
              key={incident.id}
              incident={incident}
              timeZone={data.timeZone}
            />
          ))}
        </section>
      ) : null}

      <section className='flex flex-col gap-3'>
        <h2 className='font-medium text-sm'>Últimos 30 dias</h2>
        {data.recent.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nenhum incidente resolvido nos últimos 30 dias.
          </p>
        ) : (
          <ul className='flex flex-col gap-2'>
            {data.recent.map((incident) => (
              <li key={incident.id}>
                <details className='group rounded-lg border border-border bg-card p-3'>
                  <summary className='flex cursor-pointer flex-wrap items-center gap-2 text-sm'>
                    <span className='font-medium'>{incident.title}</span>
                    <span className='text-muted-foreground text-xs'>
                      resolvido em{' '}
                      {formatIncidentDateTime(
                        incident.resolvedAt,
                        data.timeZone,
                      )}
                    </span>
                  </summary>
                  <div className='mt-3'>
                    <UpdateList incident={incident} timeZone={data.timeZone} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.allowSubscriptions ? (
        <section className='flex flex-col gap-2 border-border border-t pt-6'>
          <h2 className='font-medium text-sm'>Receba os avisos</h2>
          <p className='text-muted-foreground text-xs'>
            Enviamos um e-mail a cada atualização de incidente. Você confirma a
            inscrição e pode cancelar quando quiser.
          </p>
          <SubscribeForm slug={slug} />
        </section>
      ) : null}
    </main>
  )
}
