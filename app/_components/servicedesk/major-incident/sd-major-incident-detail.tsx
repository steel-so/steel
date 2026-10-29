'use client'

import {
  ArrowLeft01Icon,
  Link01Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useAddSdMajorIncidentUpdate,
  useLinkSdMajorIncidentTickets,
  useResolveSdMajorIncident,
  useSdMajorIncident,
  useSdMajorIncidentSuggestions,
  useUnlinkSdMajorIncidentTicket,
  useUpdateSdMajorIncident,
} from '@/src/hooks/use-sd-major-incidents'
import type {
  SdMajorIncidentDTO,
  SdMajorIncidentImpactDTO,
  SdMajorIncidentStatusDTO,
  SdMajorIncidentUpdateDTO,
} from '@/types/sd-major-incident'
import {
  EmptyState,
  FieldBlock,
  SimpleSelect,
  ToggleRow,
} from '../settings/sd-settings-kit'
import { SdUserAvatar } from '../ticket/sd-ticket-badges'
import {
  SdLinkTicketsDialog,
  SdResolveIncidentDialog,
  StatusPagePicker,
} from './sd-major-incident-dialogs'
import {
  formatIncidentDateTime,
  SD_INCIDENT_IMPACT_OPTIONS,
  SD_INCIDENT_STATUS_OPTIONS,
  SdIncidentImpactBadge,
  SdIncidentStatusBadge,
} from './sd-major-incident-meta'

type ActiveStatus = Exclude<SdMajorIncidentStatusDTO, 'RESOLVED'>

function UpdateComposer({
  workspaceId,
  incident,
}: {
  workspaceId: string
  incident: SdMajorIncidentDTO
}) {
  const add = useAddSdMajorIncidentUpdate(workspaceId, incident.id)
  const [status, setStatus] = useState<ActiveStatus>(
    incident.status === 'RESOLVED' ? 'INVESTIGATING' : incident.status,
  )
  const [impact, setImpact] = useState<SdMajorIncidentImpactDTO | null>(null)
  const [message, setMessage] = useState('')
  const [publish, setPublish] = useState(true)
  const hasPages = incident.pages.length > 0

  async function submit() {
    try {
      await add.mutateAsync({
        status,
        message: message.trim(),
        publish: publish && hasPages,
        impact: impact ?? undefined,
      })
      setMessage('')
      notify.success(
        publish && hasPages
          ? 'Atualização publicada'
          : 'Atualização registrada',
      )
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <section className='flex flex-col gap-3 rounded-lg border border-border bg-card p-4'>
      <h2 className='font-medium text-sm'>Nova atualização</h2>
      <div className='grid gap-3 sm:grid-cols-2'>
        <FieldBlock label='Situação'>
          <SimpleSelect
            value={status}
            onChange={(value) => value && setStatus(value)}
            options={SD_INCIDENT_STATUS_OPTIONS}
          />
        </FieldBlock>
        <FieldBlock label='Impacto'>
          <SimpleSelect
            value={impact}
            onChange={setImpact}
            allowEmpty
            emptyLabel='Manter o atual'
            options={SD_INCIDENT_IMPACT_OPTIONS}
          />
        </FieldBlock>
      </div>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder='O que o cliente precisa saber agora?'
        aria-label='Mensagem da atualização'
      />
      {hasPages ? (
        <ToggleRow
          label='Publicar nas páginas e avisar os assinantes'
          description='Desligado, a atualização fica só no histórico interno.'
          checked={publish}
          onCheckedChange={setPublish}
        />
      ) : (
        <p className='text-muted-foreground text-xs'>
          Nenhuma página de status vinculada: a atualização fica só no histórico
          interno.
        </p>
      )}
      <div className='flex justify-end'>
        <Button
          disabled={message.trim().length < 3 || add.isPending}
          onClick={submit}
        >
          Publicar atualização
        </Button>
      </div>
    </section>
  )
}

function notifyLabel(update: SdMajorIncidentUpdateDTO): string | null {
  if (!update.publish) return null
  if (!update.notify.done) return 'Aviso aos assinantes na fila'
  if (update.notify.total === 0) return 'Sem assinantes para avisar'
  return `${update.notify.sent} de ${update.notify.total} assinantes avisados${
    update.notify.failed > 0 ? ` · ${update.notify.failed} falha(s)` : ''
  }`
}

function Timeline({ updates }: { updates: SdMajorIncidentUpdateDTO[] }) {
  return (
    <ol className='flex flex-col gap-3'>
      {updates.map((update) => (
        <li
          key={update.id}
          className='flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3'
        >
          <div className='flex flex-wrap items-center gap-2'>
            <SdIncidentStatusBadge status={update.status} />
            <Badge variant={update.publish ? 'default' : 'secondary'}>
              {update.publish ? 'Pública' : 'Interna'}
            </Badge>
            <span className='text-muted-foreground text-xs'>
              {formatIncidentDateTime(update.createdAt)}
            </span>
          </div>
          <p className='whitespace-pre-wrap text-sm'>{update.message}</p>
          <div className='flex flex-wrap items-center gap-2 text-muted-foreground text-xs'>
            {update.author ? (
              <span className='flex items-center gap-1.5'>
                <SdUserAvatar user={update.author} className='size-5' />
                {update.author.name}
              </span>
            ) : null}
            {notifyLabel(update) ? <span>· {notifyLabel(update)}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

function ChildrenPanel({
  workspaceId,
  slug,
  incident,
}: {
  workspaceId: string
  slug: string
  incident: SdMajorIncidentDTO
}) {
  const active = incident.status !== 'RESOLVED'
  const link = useLinkSdMajorIncidentTickets(workspaceId, incident.id)
  const unlink = useUnlinkSdMajorIncidentTicket(workspaceId, incident.id)
  const suggestions = useSdMajorIncidentSuggestions(
    workspaceId,
    incident.id,
    active,
  )
  const [dialog, setDialog] = useState(false)
  const [picked, setPicked] = useState<string[]>([])

  async function attach(refs: string[]) {
    try {
      const result = await link.mutateAsync({ ticketRefs: refs })
      setDialog(false)
      setPicked([])
      notify.success(`${result.linked} chamado(s) vinculado(s)`)
      for (const skip of result.skipped) {
        notify.error(`${skip.ref}: ${skip.reason}`)
      }
    } catch (error) {
      notify.error(error)
    }
  }

  const suggested = suggestions.data?.items ?? []

  return (
    <section className='flex flex-col gap-3 rounded-lg border border-border bg-card p-4'>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='font-medium text-sm'>
          Chamados filhos ({incident.children.length})
        </h2>
        {active ? (
          <Button size='sm' variant='outline' onClick={() => setDialog(true)}>
            <SteelIcon icon={PlusSignIcon} />
            Vincular
          </Button>
        ) : null}
      </div>
      {incident.children.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Nenhum chamado vinculado ainda.
        </p>
      ) : (
        <ul className='flex flex-col divide-y divide-border'>
          {incident.children.map((child) => (
            <li
              key={child.ticketId}
              className='flex items-center gap-2 py-2 text-sm'
            >
              <Link
                href={`/${slug}/servicedesk/tickets/${child.number}`}
                className='flex min-w-0 flex-1 flex-col hover:underline'
              >
                <span className='truncate'>
                  <span className='font-mono text-xs'>{child.code}</span>{' '}
                  {child.title}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {child.phase}
                </span>
              </Link>
              {active ? (
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={unlink.isPending}
                  onClick={() =>
                    unlink
                      .mutateAsync(child.ticketId)
                      .then(() => notify.success('Chamado desvinculado'))
                      .catch((error) => notify.error(error))
                  }
                >
                  Remover
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {active && suggested.length > 0 ? (
        <div className='flex flex-col gap-2 rounded-md bg-muted/40 p-3'>
          <p className='font-medium text-xs'>
            Parecem fazer parte deste incidente
          </p>
          <ul className='flex flex-col gap-1.5'>
            {suggested.map((item) => (
              <li key={item.ticketId}>
                <label
                  htmlFor={`suggest-${item.ticketId}`}
                  className='flex cursor-pointer items-center gap-2 text-sm'
                >
                  <Checkbox
                    id={`suggest-${item.ticketId}`}
                    checked={picked.includes(item.code)}
                    onCheckedChange={(value) =>
                      setPicked(
                        value
                          ? [...picked, item.code]
                          : picked.filter((c) => c !== item.code),
                      )
                    }
                  />
                  <span className='min-w-0 flex-1 truncate'>
                    <span className='font-mono text-xs'>{item.code}</span>{' '}
                    {item.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button
            size='sm'
            className='self-end'
            disabled={picked.length === 0 || link.isPending}
            onClick={() => attach(picked)}
          >
            Vincular selecionados
          </Button>
        </div>
      ) : null}

      <SdLinkTicketsDialog
        open={dialog}
        pending={link.isPending}
        onOpenChange={setDialog}
        onSubmit={attach}
      />
    </section>
  )
}

function PagesPanel({
  workspaceId,
  incident,
}: {
  workspaceId: string
  incident: SdMajorIncidentDTO
}) {
  const active = incident.status !== 'RESOLVED'
  const update = useUpdateSdMajorIncident(workspaceId, incident.id)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  async function save() {
    try {
      await update.mutateAsync({ pageIds: selected })
      setEditing(false)
      notify.success('Páginas atualizadas')
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <section className='flex flex-col gap-3 rounded-lg border border-border bg-card p-4'>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='font-medium text-sm'>Páginas de status</h2>
        {active && !editing ? (
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              setSelected(incident.pages.map((p) => p.id))
              setEditing(true)
            }}
          >
            Editar
          </Button>
        ) : null}
      </div>
      {editing ? (
        <>
          <StatusPagePicker
            workspaceId={workspaceId}
            selected={selected}
            onChange={setSelected}
          />
          <div className='flex justify-end gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setEditing(false)}
            >
              Cancelar
            </Button>
            <Button size='sm' disabled={update.isPending} onClick={save}>
              Salvar
            </Button>
          </div>
        </>
      ) : incident.pages.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          O incidente não aparece em nenhuma página de status.
        </p>
      ) : (
        <ul className='flex flex-col gap-1.5'>
          {incident.pages.map((page) => (
            <li key={page.id} className='flex items-center gap-2 text-sm'>
              <SteelIcon icon={Link01Icon} className='size-4' />
              <a
                href={`/status-page/${page.slug}`}
                target='_blank'
                rel='noreferrer'
                className='truncate hover:underline'
              >
                {page.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Tela do incidente maior: linha do tempo, filhos, páginas e sala de guerra. */
export function SdMajorIncidentDetail({
  workspaceId,
  slug,
  incidentId,
}: {
  workspaceId: string
  slug: string
  incidentId: string
}) {
  const query = useSdMajorIncident(workspaceId, incidentId)
  const resolve = useResolveSdMajorIncident(workspaceId, incidentId)
  const [resolving, setResolving] = useState(false)
  const incident = query.data

  if (query.error) {
    return (
      <div className='p-6'>
        <EmptyState>{query.error.message}</EmptyState>
      </div>
    )
  }
  if (!incident) {
    return (
      <div className='p-6'>
        <EmptyState>Carregando…</EmptyState>
      </div>
    )
  }
  const active = incident.status !== 'RESOLVED'

  return (
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6'>
      <Link
        href={`/${slug}/servicedesk/major-incidents`}
        className='flex w-fit items-center gap-1 text-muted-foreground text-xs hover:text-foreground'
      >
        <SteelIcon icon={ArrowLeft01Icon} className='size-3.5' />
        Incidentes maiores
      </Link>

      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <SdIncidentStatusBadge status={incident.status} />
            <SdIncidentImpactBadge impact={incident.impact} />
          </div>
          <h1 className='font-semibold text-lg'>{incident.title}</h1>
          {incident.summary ? (
            <p className='text-muted-foreground text-sm'>{incident.summary}</p>
          ) : null}
          <p className='text-muted-foreground text-xs'>
            Chamado principal{' '}
            <Link
              className='font-mono hover:underline'
              href={`/${slug}/servicedesk/tickets/${incident.ticketNumber}`}
            >
              {incident.ticketCode}
            </Link>{' '}
            · declarado em {formatIncidentDateTime(incident.declaredAt)}
            {incident.commander
              ? ` · comandante ${incident.commander.name}`
              : ''}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {incident.swarmId ? (
            <Button
              variant='outline'
              render={
                <Link
                  href={`/${slug}/servicedesk/tickets/${incident.ticketNumber}?tab=swarm`}
                />
              }
            >
              Sala de guerra
            </Button>
          ) : (
            <Button
              variant='outline'
              render={
                <Link
                  href={`/${slug}/servicedesk/tickets/${incident.ticketNumber}?tab=swarm`}
                />
              }
            >
              Chamar especialistas
            </Button>
          )}
          {active ? (
            <Button onClick={() => setResolving(true)}>Resolver</Button>
          ) : null}
        </div>
      </header>

      {!active && incident.resolution ? (
        <section className='rounded-lg border border-border bg-card p-4'>
          <h2 className='font-medium text-sm'>O que resolveu</h2>
          <p className='mt-1 whitespace-pre-wrap text-sm'>
            {incident.resolution}
          </p>
          <p className='mt-2 text-muted-foreground text-xs'>
            Resolvido em {formatIncidentDateTime(incident.resolvedAt)}
            {incident.resolvedBy ? ` por ${incident.resolvedBy.name}` : ''}
          </p>
        </section>
      ) : null}

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'>
        <div className='flex min-w-0 flex-col gap-4'>
          {active ? (
            <UpdateComposer
              key={incident.updates[0]?.id ?? 'new'}
              workspaceId={workspaceId}
              incident={incident}
            />
          ) : null}
          <Timeline updates={incident.updates} />
        </div>
        <div className='flex min-w-0 flex-col gap-4'>
          <PagesPanel workspaceId={workspaceId} incident={incident} />
          <ChildrenPanel
            workspaceId={workspaceId}
            slug={slug}
            incident={incident}
          />
        </div>
      </div>

      <SdResolveIncidentDialog
        open={resolving}
        hasPages={incident.pages.length > 0}
        pending={resolve.isPending}
        onOpenChange={setResolving}
        onSubmit={async (data) => {
          try {
            await resolve.mutateAsync(data)
            setResolving(false)
            notify.success('Incidente maior resolvido')
          } catch (error) {
            notify.error(error)
          }
        }}
      />
    </div>
  )
}
