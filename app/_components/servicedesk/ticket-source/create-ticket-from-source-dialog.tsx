'use client'

import Link from 'next/link'
import { useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateSdTicketFromSource,
  useSdTicketSourcePrefill,
} from '@/src/hooks/use-sd-ticket-source'
import type { SdTicketSourceKindDTO } from '@/types/sd-ticket-source'

const TYPE_OPTIONS = [
  { value: 'SERVICE_REQUEST', label: 'Requisição de serviço' },
  { value: 'INCIDENT', label: 'Incidente' },
  { value: 'CHANGE', label: 'Mudança' },
  { value: 'PROBLEM', label: 'Problema' },
] as const

type TicketType = (typeof TYPE_OPTIONS)[number]['value']

const SOURCE_COPY: Record<SdTicketSourceKindDTO, string> = {
  conversation: 'desta conversa do WhatsApp',
  lead: 'deste lead',
  person: 'desta pessoa',
  opportunity: 'desta oportunidade',
}

/**
 * "Criar chamado" a partir de uma conversa do zap ou de um lead, pessoa ou
 * oportunidade do CRM. O texto já vem pronto (título, descrição com as
 * últimas mensagens, solicitante); a pessoa só confere e confirma.
 */
export function CreateTicketFromSourceDialog({
  workspaceId,
  source,
  sourceId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  source: SdTicketSourceKindDTO
  sourceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const prefill = useSdTicketSourcePrefill(workspaceId, source, sourceId, open)
  const create = useCreateSdTicketFromSource(workspaceId)

  const [title, setTitle] = useState<string | null>(null)
  const [type, setType] = useState<TicketType>('SERVICE_REQUEST')
  const [note, setNote] = useState('')
  const [includeMessages, setIncludeMessages] = useState(true)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)

  const data = prefill.data
  const openTickets = data?.openTickets ?? []
  const needsConfirm = openTickets.length > 0
  const hasMessages = source === 'conversation' && (data?.messageCount ?? 0) > 0
  const titleValue = title ?? data?.title ?? ''
  const blockedReason = !data
    ? 'Aguarde o carregamento dos dados.'
    : !titleValue.trim()
      ? 'Escreva um título para o chamado.'
      : needsConfirm && !confirmDuplicate
        ? 'Já existe um chamado em aberto: confirme que quer criar outro.'
        : null

  function reset() {
    setTitle(null)
    setType('SERVICE_REQUEST')
    setNote('')
    setIncludeMessages(true)
    setConfirmDuplicate(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function handleSubmit() {
    if (blockedReason) return
    create.mutate(
      {
        source,
        sourceId,
        type,
        title: titleValue.trim(),
        note: note.trim() || undefined,
        includeMessages: hasMessages ? includeMessages : false,
        allowDuplicate: needsConfirm && confirmDuplicate,
      },
      {
        onSuccess: ({ ticket }) => {
          notify.success(`Chamado ${ticket.code} criado.`)
          handleOpenChange(false)
        },
        onError: (error) => notify.error(error, 'Erro ao criar o chamado'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[90dvh] w-full overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Criar chamado</DialogTitle>
          <DialogDescription>
            Abre um chamado no ServiceDesk a partir {SOURCE_COPY[source]}. Os
            dois ficam ligados, e o cliente recebe a confirmação com o número
            quando o ServiceDesk está configurado para avisar.
          </DialogDescription>
        </DialogHeader>

        {prefill.isLoading ? (
          <div className='flex flex-col gap-3'>
            <Skeleton className='h-9 w-full' />
            <Skeleton className='h-24 w-full' />
          </div>
        ) : prefill.isError || !data ? (
          <p className='text-destructive text-sm'>
            {prefill.error instanceof Error
              ? prefill.error.message
              : 'Não foi possível preparar o chamado. Tente de novo.'}
          </p>
        ) : (
          <div className='flex flex-col gap-4'>
            {needsConfirm ? (
              <div className='flex flex-col gap-2 rounded-lg border bg-muted/50 p-3 text-sm'>
                <p className='font-medium'>
                  Já existe chamado em aberto para esta origem
                </p>
                <ul className='flex flex-col gap-1'>
                  {openTickets.map((ticket) => (
                    <li key={ticket.id}>
                      <Link
                        href={ticket.href}
                        className='text-primary underline-offset-4 hover:underline'
                      >
                        {ticket.code}
                      </Link>{' '}
                      <span className='text-muted-foreground'>
                        {ticket.title} · {ticket.phaseName}
                      </span>
                    </li>
                  ))}
                </ul>
                <Label className='flex items-center gap-2 font-normal'>
                  <Checkbox
                    checked={confirmDuplicate}
                    onCheckedChange={(next) => setConfirmDuplicate(next)}
                  />
                  Criar outro chamado mesmo assim
                </Label>
              </div>
            ) : null}

            <div className='grid gap-1.5'>
              <Label htmlFor='sd-source-title' className='text-xs'>
                Título *
              </Label>
              <Input
                id='sd-source-title'
                value={titleValue}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className='grid gap-1.5'>
              <Label htmlFor='sd-source-type' className='text-xs'>
                Tipo
              </Label>
              <select
                id='sd-source-type'
                value={type}
                onChange={(e) => setType(e.target.value as TicketType)}
                className='h-9 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className='grid gap-1.5 text-sm'>
              <span className='font-medium text-xs'>Solicitante</span>
              <p>
                {data.requester.name}
                {data.requester.phone ? ` · ${data.requester.phone}` : ''}
                {data.requester.email ? ` · ${data.requester.email}` : ''}
              </p>
              <p className='text-muted-foreground text-xs'>
                {data.contact
                  ? `Contato do ServiceDesk: ${data.contact.name}.`
                  : 'Sem contato correspondente no ServiceDesk: os dados vão na descrição.'}{' '}
                {data.customer
                  ? `Cliente: ${data.customer.name}.`
                  : 'Sem cliente vinculado.'}
              </p>
            </div>

            <div className='grid gap-1.5'>
              <Label htmlFor='sd-source-note' className='text-xs'>
                Observação (opcional)
              </Label>
              <Textarea
                id='sd-source-note'
                value={note}
                rows={2}
                maxLength={5000}
                placeholder='Algo que o atendente precisa saber além da conversa'
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {hasMessages ? (
              <Label className='flex items-center gap-2 font-normal'>
                <Checkbox
                  checked={includeMessages}
                  onCheckedChange={(next) => setIncludeMessages(next)}
                />
                Incluir as últimas {data.messageCount} mensagens na descrição
              </Label>
            ) : null}

            <details className='rounded-lg border p-3 text-sm'>
              <summary className='cursor-pointer font-medium'>
                Ver a descrição que será gravada
              </summary>
              <pre className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground text-xs'>
                {data.descriptionPreview}
              </pre>
            </details>

            {data.connectionNote ? (
              <p className='text-muted-foreground text-xs'>
                {data.connectionNote}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className='items-center gap-2 sm:justify-between'>
          <span className='text-muted-foreground text-xs'>
            {blockedReason && data ? blockedReason : ''}
          </span>
          <div className='flex gap-2'>
            <Button
              variant='ghost'
              onClick={() => handleOpenChange(false)}
              disabled={create.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={Boolean(blockedReason) || create.isPending}
            >
              {create.isPending ? 'Criando…' : 'Criar chamado'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
