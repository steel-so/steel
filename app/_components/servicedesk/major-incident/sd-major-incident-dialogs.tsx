'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSdAgents } from '@/src/hooks/use-sd-config'
import { useSdStatusPages } from '@/src/hooks/use-sd-status-pages'
import { SD_SWARM_MAX_MEMBERS } from '@/src/lib/servicedesk/swarm'
import type { SdMajorIncidentImpactDTO } from '@/types/sd-major-incident'
import {
  FieldBlock,
  SimpleSelect,
  ToggleRow,
} from '../settings/sd-settings-kit'
import { SpecialistPicker } from '../ticket/swarm/sd-swarm-dialogs'
import {
  parseTicketRefs,
  SD_INCIDENT_IMPACT_OPTIONS,
} from './sd-major-incident-meta'

export interface DeclareIncidentForm {
  title: string
  summary?: string
  impact: SdMajorIncidentImpactDTO
  commanderId?: string
  pageIds: string[]
  childTicketRefs?: string[]
  initialMessage?: string
  publishInitial: boolean
  warRoom?: { userIds: string[]; openSlackChannel: boolean }
}

/** Page checklist shared by the declare dialog and the incident editor. */
export function StatusPagePicker({
  workspaceId,
  selected,
  onChange,
}: {
  workspaceId: string
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const pages = useSdStatusPages(workspaceId)
  const items = pages.data?.items ?? []
  if (items.length === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        {pages.isLoading
          ? 'Carregando…'
          : 'Nenhuma página de status criada ainda. Crie uma em Páginas de status para publicar atualizações aos clientes.'}
      </p>
    )
  }
  return (
    <ul className='flex max-h-44 flex-col overflow-y-auto rounded-md border border-border'>
      {items.map((page) => {
        const checked = selected.includes(page.id)
        return (
          <li key={page.id}>
            <label
              htmlFor={`incident-page-${page.id}`}
              className='flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50'
            >
              <Checkbox
                id={`incident-page-${page.id}`}
                checked={checked}
                onCheckedChange={(value) =>
                  onChange(
                    value
                      ? [...selected, page.id]
                      : selected.filter((id) => id !== page.id),
                  )
                }
              />
              <span className='flex min-w-0 flex-col'>
                <span className='truncate'>{page.name}</span>
                <span className='truncate text-muted-foreground text-xs'>
                  {page.customer?.name ?? 'Todos os clientes'}
                  {page.published ? '' : ' · despublicada'}
                </span>
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

export function SdDeclareIncidentDialog({
  workspaceId,
  open,
  ticketTitle,
  suggestedPageIds,
  pending,
  onOpenChange,
  onSubmit,
}: {
  workspaceId: string
  open: boolean
  ticketTitle: string
  suggestedPageIds: string[]
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: DeclareIncidentForm) => void
}) {
  const agents = useSdAgents(workspaceId)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [impact, setImpact] =
    useState<SdMajorIncidentImpactDTO>('PARTIAL_OUTAGE')
  const [commanderId, setCommanderId] = useState<string | null>(null)
  const [pageIds, setPageIds] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [publish, setPublish] = useState(true)
  const [children, setChildren] = useState('')
  const [warRoom, setWarRoom] = useState(false)
  const [specialists, setSpecialists] = useState<string[]>([])
  // A string key keeps the form from resetting when the query refetches.
  const suggestedKey = suggestedPageIds.join(',')

  useEffect(() => {
    if (!open) return
    setTitle(ticketTitle)
    setSummary('')
    setImpact('PARTIAL_OUTAGE')
    setCommanderId(null)
    setPageIds(suggestedKey ? suggestedKey.split(',') : [])
    setMessage('')
    setPublish(true)
    setChildren('')
    setWarRoom(false)
    setSpecialists([])
  }, [open, ticketTitle, suggestedKey])

  const valid = title.trim().length >= 3 && (!warRoom || specialists.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Declarar incidente maior</DialogTitle>
          <DialogDescription>
            Agrupa os chamados do mesmo problema e publica as atualizações nas
            páginas de status dos clientes. O título e as mensagens publicadas
            aparecem para o cliente.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <FieldBlock label='Título (público)'>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              placeholder='Ex.: Instabilidade na telefonia'
            />
          </FieldBlock>
          <FieldBlock label='Resumo (público, opcional)'>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </FieldBlock>
          <div className='grid gap-4 sm:grid-cols-2'>
            <FieldBlock label='Impacto'>
              <SimpleSelect
                value={impact}
                onChange={(value) => value && setImpact(value)}
                options={SD_INCIDENT_IMPACT_OPTIONS}
              />
            </FieldBlock>
            <FieldBlock label='Comandante' hint='Padrão: você.'>
              <SimpleSelect
                value={commanderId}
                onChange={setCommanderId}
                allowEmpty
                emptyLabel='Eu'
                options={(agents.data ?? [])
                  .filter((agent) => agent.isAgent)
                  .map((agent) => ({ value: agent.id, label: agent.name }))}
              />
            </FieldBlock>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label>Páginas de status</Label>
            <StatusPagePicker
              workspaceId={workspaceId}
              selected={pageIds}
              onChange={setPageIds}
            />
          </div>
          <FieldBlock label='Primeira mensagem (opcional)'>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder='Identificamos um problema e já estamos investigando.'
            />
          </FieldBlock>
          {pageIds.length > 0 ? (
            <ToggleRow
              label='Publicar e avisar os assinantes agora'
              description='Mostra a mensagem nas páginas e envia por e-mail e WhatsApp.'
              checked={publish}
              onCheckedChange={setPublish}
            />
          ) : null}
          <FieldBlock
            label='Chamados filhos (opcional)'
            hint='Códigos ou números separados por vírgula ou espaço. Você também pode vincular depois.'
          >
            <Input
              value={children}
              onChange={(e) => setChildren(e.target.value)}
              placeholder='INC-000123, INC-000124'
            />
          </FieldBlock>
          <ToggleRow
            label='Abrir sala de guerra'
            description='Chama especialistas para o chamado principal (swarming).'
            checked={warRoom}
            onCheckedChange={setWarRoom}
          />
          {warRoom ? (
            <SpecialistPicker
              workspaceId={workspaceId}
              excludeIds={[]}
              selected={specialists}
              max={SD_SWARM_MAX_MEMBERS}
              onChange={setSpecialists}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onSubmit({
                title: title.trim(),
                summary: summary.trim() || undefined,
                impact,
                commanderId: commanderId ?? undefined,
                pageIds,
                childTicketRefs: parseTicketRefs(children),
                initialMessage: message.trim() || undefined,
                publishInitial: publish,
                warRoom: warRoom
                  ? { userIds: specialists, openSlackChannel: false }
                  : undefined,
              })
            }
          >
            Declarar incidente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SdResolveIncidentDialog({
  open,
  hasPages,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  hasPages: boolean
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: {
    message: string
    resolution?: string
    publish: boolean
  }) => void
}) {
  const [message, setMessage] = useState('')
  const [resolution, setResolution] = useState('')
  const [publish, setPublish] = useState(true)

  useEffect(() => {
    if (!open) return
    setMessage('O problema foi resolvido e os serviços voltaram ao normal.')
    setResolution('')
    setPublish(true)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Resolver incidente maior</DialogTitle>
          <DialogDescription>
            Encerra o incidente. Os chamados filhos continuam abertos: resolva
            cada um pelo fluxo normal.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <FieldBlock label='Mensagem de encerramento (pública)'>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </FieldBlock>
          <FieldBlock label='O que resolveu (interno, opcional)'>
            <Textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </FieldBlock>
          {hasPages ? (
            <ToggleRow
              label='Publicar e avisar os assinantes'
              checked={publish}
              onCheckedChange={setPublish}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={message.trim().length < 3 || pending}
            onClick={() =>
              onSubmit({
                message: message.trim(),
                resolution: resolution.trim() || undefined,
                publish,
              })
            }
          >
            Resolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SdLinkTicketsDialog({
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (refs: string[]) => void
}) {
  const [text, setText] = useState('')

  useEffect(() => {
    if (open) setText('')
  }, [open])

  const refs = parseTicketRefs(text)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Vincular chamados</DialogTitle>
          <DialogDescription>
            Informe os códigos ou números dos chamados que fazem parte deste
            incidente.
          </DialogDescription>
        </DialogHeader>
        <FieldBlock label='Chamados' hint={`${refs.length} informados.`}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder='INC-000123, INC-000124'
          />
        </FieldBlock>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={refs.length === 0 || pending}
            onClick={() => onSubmit(refs)}
          >
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
