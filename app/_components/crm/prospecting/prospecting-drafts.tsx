'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCrmProspectDrafts,
  useDecideCrmProspectDraft,
  useUpdateCrmProspectDraft,
} from '@/src/hooks/use-crm-prospecting'
import type {
  CrmProspectDraftDTO,
  CrmProspectDraftStatusDTO,
} from '@/types/crm-prospecting'
import {
  CHANNEL_LABEL,
  DRAFT_STATUS_FILTERS,
  DRAFT_STATUS_LABEL,
  formatDraftDate,
  mailtoHref,
  whatsappHref,
} from './prospecting-labels'

/** Inbox of the first-contact drafts written by the prospecting agent. */
export function ProspectingDrafts({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<CrmProspectDraftStatusDTO | 'ALL'>(
    'PENDING',
  )
  const drafts = useCrmProspectDrafts(workspaceId, status)

  return (
    <div className='flex flex-col gap-4'>
      <p className='max-w-2xl text-muted-foreground text-sm'>
        O agente pesquisa a conta e escreve o primeiro contato, mas nunca envia.
        Revise o texto e as evidências, ajuste o que quiser e aprove. O envio é
        sempre feito por uma pessoa.
      </p>

      <div className='flex flex-wrap gap-1' role='tablist'>
        {DRAFT_STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size='xs'
            variant={status === filter.value ? 'default' : 'outline'}
            role='tab'
            aria-selected={status === filter.value}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {drafts.isLoading ? (
        <div className='grid gap-3 xl:grid-cols-2'>
          <Skeleton className='h-56' />
          <Skeleton className='h-56' />
        </div>
      ) : drafts.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar os rascunhos.
        </p>
      ) : (drafts.data ?? []).length === 0 ? (
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center'>
          <p className='font-medium'>Nenhum rascunho aqui</p>
          <p className='max-w-md text-muted-foreground text-sm'>
            Ligue a prospecção, crie o agente na aba Configurações e atribua um
            lead a ele. Os rascunhos aparecem nesta fila.
          </p>
        </div>
      ) : (
        <ul className='grid gap-3 xl:grid-cols-2'>
          {drafts.data?.map((draft) => (
            <li key={draft.id} className='min-w-0'>
              <DraftCard workspaceId={workspaceId} draft={draft} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DraftCard({
  workspaceId,
  draft,
}: {
  workspaceId: string
  draft: CrmProspectDraftDTO
}) {
  const update = useUpdateCrmProspectDraft(workspaceId)
  const decide = useDecideCrmProspectDraft(workspaceId)
  const [editing, setEditing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.body)
  const [reason, setReason] = useState('')
  const busy = update.isPending || decide.isPending
  const mailto = mailtoHref(draft)
  const whatsapp = whatsappHref(draft)
  const outLink = mailto ?? whatsapp

  function save() {
    update.mutate(
      {
        draftId: draft.id,
        body,
        ...(draft.channel === 'EMAIL' && { subject }),
      },
      {
        onSuccess: () => {
          notify.success('Rascunho salvo')
          setEditing(false)
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  function approve() {
    decide.mutate(
      { draftId: draft.id, decision: 'APPROVE' },
      {
        onSuccess: () => notify.success('Rascunho aprovado'),
        onError: (error) => notify.error(error),
      },
    )
  }

  function reject() {
    decide.mutate(
      { draftId: draft.id, decision: 'REJECT', reason },
      {
        onSuccess: () => {
          notify.success('Rascunho recusado')
          setRejecting(false)
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  function markSent() {
    decide.mutate(
      { draftId: draft.id, decision: 'MARK_SENT' },
      {
        onSuccess: () => notify.success('Marcado como enviado'),
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <article className='flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4'>
      <header className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <h3 className='truncate font-medium'>{draft.targetName}</h3>
          <p className='text-muted-foreground text-xs'>
            {CHANNEL_LABEL[draft.channel]} ·{' '}
            {draft.toEmail ?? draft.toPhone ?? 'sem destinatário'} ·{' '}
            {formatDraftDate(draft.createdAt)}
          </p>
        </div>
        <Badge variant={draft.status === 'PENDING' ? 'secondary' : 'outline'}>
          {DRAFT_STATUS_LABEL[draft.status]}
        </Badge>
      </header>

      {draft.summary ? (
        <p className='text-muted-foreground text-sm'>{draft.summary}</p>
      ) : null}

      {draft.signals.length > 0 ? (
        <section className='flex flex-col gap-1'>
          <h4 className='font-medium text-xs uppercase tracking-wide'>
            Sinais de compra
          </h4>
          <ul className='flex flex-col gap-1 text-sm'>
            {draft.signals.map((signal) => (
              <li key={`${signal.type}-${signal.evidence}`} className='min-w-0'>
                <Badge variant='outline' className='mr-1'>
                  {signal.label}
                </Badge>
                <span className='break-words'>{signal.evidence}</span>
                {signal.sourceUrl ? (
                  <a
                    href={signal.sourceUrl}
                    target='_blank'
                    rel='noreferrer noopener'
                    className='ml-1 text-primary text-xs underline-offset-4 hover:underline'
                  >
                    fonte
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editing ? (
        <div className='flex flex-col gap-2'>
          {draft.channel === 'EMAIL' ? (
            <Input
              aria-label='Assunto'
              value={subject}
              maxLength={200}
              onChange={(event) => setSubject(event.target.value)}
            />
          ) : null}
          <Textarea
            aria-label='Mensagem'
            value={body}
            rows={8}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className='flex gap-2'>
            <Button size='xs' disabled={busy} onClick={save}>
              Salvar
            </Button>
            <Button
              size='xs'
              variant='outline'
              disabled={busy}
              onClick={() => {
                setEditing(false)
                setSubject(draft.subject ?? '')
                setBody(draft.body)
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className='rounded-md bg-muted/50 p-3 text-sm'>
          {draft.subject ? (
            <p className='mb-1 font-medium'>{draft.subject}</p>
          ) : null}
          <p className='whitespace-pre-wrap break-words'>{draft.body}</p>
        </div>
      )}

      {draft.sources.length > 0 ? (
        <details className='text-xs'>
          <summary className='cursor-pointer text-muted-foreground'>
            Páginas lidas ({draft.sources.length})
          </summary>
          <ul className='mt-1 flex flex-col gap-1'>
            {draft.sources.map((source) => (
              <li key={source.url} className='min-w-0 break-all'>
                <a
                  href={source.url}
                  target='_blank'
                  rel='noreferrer noopener'
                  className='text-primary underline-offset-4 hover:underline'
                >
                  {source.title ?? source.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {draft.status === 'REJECTED' && draft.rejectReason ? (
        <p className='text-muted-foreground text-xs'>
          Motivo: {draft.rejectReason}
        </p>
      ) : null}

      {draft.status === 'PENDING' && !editing ? (
        rejecting ? (
          <div className='flex flex-col gap-2'>
            <Textarea
              aria-label='Motivo da recusa'
              placeholder='Por que este rascunho não serve?'
              value={reason}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className='flex gap-2'>
              <Button
                size='xs'
                variant='destructive'
                disabled={busy || reason.trim() === ''}
                onClick={reject}
              >
                Confirmar recusa
              </Button>
              <Button
                size='xs'
                variant='outline'
                onClick={() => setRejecting(false)}
              >
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className='flex flex-wrap gap-1'>
            <Button size='xs' disabled={busy} onClick={approve}>
              Aprovar
            </Button>
            <Button
              size='xs'
              variant='outline'
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Editar
            </Button>
            <Button
              size='xs'
              variant='outline'
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              Recusar
            </Button>
          </div>
        )
      ) : null}

      {draft.status === 'APPROVED' ? (
        <div className='flex flex-wrap items-center gap-1'>
          {outLink ? (
            <a
              href={outLink}
              target='_blank'
              rel='noreferrer noopener'
              className={cn(buttonVariants({ size: 'xs' }))}
            >
              {draft.channel === 'EMAIL'
                ? 'Abrir no programa de e-mail'
                : 'Abrir no WhatsApp'}
            </a>
          ) : null}
          <Button
            size='xs'
            variant='outline'
            disabled={busy}
            onClick={markSent}
          >
            Marcar como enviado
          </Button>
        </div>
      ) : null}
    </article>
  )
}
