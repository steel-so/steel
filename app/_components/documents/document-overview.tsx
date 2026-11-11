'use client'

import { Delete02Icon, RefreshIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type ReactNode, useId, useMemo, useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import {
  type UpdateDocumentBody,
  useDocumentResponses,
  useRemoveDocumentRecipient,
  useResendDocumentRecipient,
  useUpdateDocument,
} from '@/src/hooks/use-documents'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { documentFields, documentPricingItems } from '@/src/lib/canvas-document'
import type {
  DocumentDTO,
  DocumentRecipientDTO,
  DocumentResponseDTO,
} from '@/types/document'
import { CopyLinkButton } from './copy-link-button'
import { RecipientStatusChip } from './document-chips'
import {
  formatDocumentDateTime,
  formatDocumentMoney,
  RECIPIENT_CHANNEL_LABELS,
  RECIPIENT_ROLE_LABELS,
} from './documents-tone'
import { OptionSelect } from './option-select'

const LOOKUP_KINDS: LookupKind[] = ['companies', 'people', 'opportunities']

type LinkKey = 'companyId' | 'personId' | 'opportunityId' | 'leadId'

const RESPONSE_LABELS: Record<DocumentResponseDTO['action'], string> = {
  ACCEPT: 'Aceite',
  DECLINE: 'Recusa',
  SUBMIT: 'Respostas enviadas',
}

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className='grid gap-3 rounded-xl border bg-card p-4'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <h2 className='font-medium text-sm'>{title}</h2>
          {description ? (
            <p className='text-muted-foreground text-xs'>{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function asContent(doc: DocumentDTO): CanvasDocument | null {
  const content = doc.content as Partial<CanvasDocument>
  return content && typeof content.nodes === 'object' && content.nodes
    ? (content as CanvasDocument)
    : null
}

function fieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function LinkCard({ document }: { document: DocumentDTO }) {
  const canEdit = useCan('documents', 'EDIT')
  const update = useUpdateDocument(document.workspaceId, document.id)
  const id = useId()
  if (!document.currentVersion) {
    return (
      <Card
        title='Link do documento'
        description='O link é criado no primeiro envio.'
      >
        <p className='text-muted-foreground text-sm'>
          Envie o documento para gerar o link geral e os links pessoais de cada
          destinatário.
        </p>
      </Card>
    )
  }
  return (
    <Card
      title='Link do documento'
      description='Mostra a versão atual. Leituras aparecem como visitantes.'
      action={<CopyLinkButton url={document.publicUrl} />}
    >
      <code className='block truncate rounded-md bg-muted px-2 py-1.5 text-xs'>
        {document.publicUrl}
      </code>
      <div className='flex items-center justify-between gap-3'>
        <Label htmlFor={`${id}-enabled`} className='font-normal'>
          Link ativo
        </Label>
        <Switch
          id={`${id}-enabled`}
          checked={document.linkEnabled}
          disabled={!canEdit || update.isPending}
          onCheckedChange={(linkEnabled) =>
            update.mutate(
              { linkEnabled },
              {
                onSuccess: () =>
                  notify.success(
                    linkEnabled ? 'Link reativado.' : 'Link desativado.',
                  ),
                onError: (error) =>
                  notify.error(error, 'Não foi possível alterar o link'),
              },
            )
          }
        />
      </div>
    </Card>
  )
}

function RecipientRow({
  document,
  recipient,
  onRemove,
}: {
  document: DocumentDTO
  recipient: DocumentRecipientDTO
  onRemove: (recipient: DocumentRecipientDTO) => void
}) {
  const canEdit = useCan('documents', 'EDIT')
  const resend = useResendDocumentRecipient(document.workspaceId, document.id)
  const summary = [
    recipient.email ?? recipient.phone,
    RECIPIENT_ROLE_LABELS[recipient.role],
    RECIPIENT_CHANNEL_LABELS[recipient.channel],
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li
      data-testid={`document-recipient-${recipient.id}`}
      className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0'
    >
      <div className='min-w-0 flex-1 basis-48'>
        <p className='truncate font-medium text-sm'>{recipient.name}</p>
        <p className='truncate text-muted-foreground text-xs'>{summary}</p>
        <p className='truncate text-muted-foreground text-xs'>
          {recipient.respondedAt
            ? `Respondeu em ${formatDocumentDateTime(recipient.respondedAt)}`
            : recipient.lastViewedAt
              ? `Última leitura em ${formatDocumentDateTime(recipient.lastViewedAt)}`
              : recipient.sentAt
                ? `Enviado em ${formatDocumentDateTime(recipient.sentAt)}`
                : 'Ainda não enviado'}
        </p>
      </div>
      <RecipientStatusChip status={recipient.status} />
      <div className='flex items-center gap-1'>
        <CopyLinkButton
          url={recipient.url}
          label={`Copiar link de ${recipient.name}`}
          iconOnly
          variant='ghost'
        />
        {canEdit && recipient.channel !== 'LINK' ? (
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            disabled={resend.isPending}
            aria-label={`Reenviar para ${recipient.name}`}
            title='Reenviar'
            onClick={() =>
              resend.mutate(recipient.id, {
                onSuccess: () => notify.success('Documento reenviado.'),
                onError: (error) =>
                  notify.error(error, 'Não foi possível reenviar'),
              })
            }
          >
            <SteelIcon icon={RefreshIcon} />
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            aria-label={`Remover ${recipient.name}`}
            title='Remover'
            onClick={() => onRemove(recipient)}
          >
            <SteelIcon icon={Delete02Icon} />
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function RecipientsCard({
  document,
  onSend,
}: {
  document: DocumentDTO
  onSend: () => void
}) {
  const canEdit = useCan('documents', 'EDIT')
  const remove = useRemoveDocumentRecipient(document.workspaceId, document.id)
  const [removing, setRemoving] = useState<DocumentRecipientDTO | null>(null)

  async function confirmRemove() {
    if (!removing) return
    const recipient = removing
    setRemoving(null)
    try {
      await remove.mutateAsync(recipient.id)
      notify.success(`${recipient.name} não tem mais acesso pelo link pessoal.`)
    } catch (error) {
      notify.error(error, 'Não foi possível remover o destinatário')
    }
  }

  return (
    <Card
      title='Destinatários'
      description='Cada pessoa tem um link pessoal: você sabe quem leu.'
      action={
        canEdit ? (
          <Button size='sm' variant='outline' onClick={onSend}>
            Adicionar
          </Button>
        ) : null
      }
    >
      {document.recipients.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Ninguém ainda. Use “Enviar” para escolher quem recebe.
        </p>
      ) : (
        <ul className='divide-y'>
          {document.recipients.map((recipient) => (
            <RecipientRow
              key={recipient.id}
              document={document}
              recipient={recipient}
              onRemove={setRemoving}
            />
          ))}
        </ul>
      )}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O link pessoal dessa pessoa para de funcionar. As leituras e
              respostas que ela já fez continuam no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void confirmRemove()}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function CrmLinksCard({ document }: { document: DocumentDTO }) {
  const id = useId()
  const canEdit = useCan('documents', 'EDIT')
  const update = useUpdateDocument(document.workspaceId, document.id)
  const { lookups } = useCrmWorkspaceLookups(
    document.workspaceId,
    LOOKUP_KINDS,
  )
  const leads = useCrmResourceList<{ id: string; name: string }>(
    document.workspaceId,
    'leads',
  )
  const leadOptions = useMemo(
    () => leads.items.map((lead) => ({ value: lead.id, label: lead.name })),
    [leads.items],
  )

  // The linked record is offered even before the lookups load.
  const withCurrent = (
    options: Array<{ value: string; label: string }>,
    current: { id: string; name: string } | null,
  ) =>
    current && !options.some((option) => option.value === current.id)
      ? [{ value: current.id, label: current.name }, ...options]
      : options

  const save = (key: LinkKey, value: string) =>
    update.mutate({ [key]: value || null } as UpdateDocumentBody, {
      onError: (error) => notify.error(error, 'Não foi possível vincular'),
    })

  const fields = [
    {
      key: 'companyId',
      label: 'Empresa',
      current: document.company,
      options: lookups.options.companies,
    },
    {
      key: 'personId',
      label: 'Pessoa',
      current: document.person,
      options: lookups.options.people,
    },
    {
      key: 'opportunityId',
      label: 'Oportunidade',
      current: document.opportunity,
      options: lookups.options.opportunities,
    },
    {
      key: 'leadId',
      label: 'Lead',
      current: document.lead,
      options: leadOptions,
    },
  ] as const

  return (
    <Card
      title='Vínculos no CRM'
      description='O documento aparece na ficha de cada registro vinculado.'
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        {fields.map((field) => (
          <div key={field.key} className='grid gap-1.5'>
            <Label htmlFor={`${id}-${field.key}`}>{field.label}</Label>
            <OptionSelect
              id={`${id}-${field.key}`}
              value={field.current?.id ?? ''}
              options={withCurrent(field.options, field.current)}
              emptyLabel='Nenhum'
              disabled={!canEdit || update.isPending}
              onChange={(value) => save(field.key, value)}
            />
          </div>
        ))}
      </div>
    </Card>
  )
}

function OutcomeCard({ document }: { document: DocumentDTO }) {
  if (document.status === 'ACCEPTED' && document.acceptedAt) {
    return (
      <Card title='Aceite'>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
          <dt className='text-muted-foreground'>Quem</dt>
          <dd className='min-w-0 break-words'>
            {document.acceptedByName ?? '—'}
            {document.acceptedByEmail ? ` · ${document.acceptedByEmail}` : ''}
          </dd>
          <dt className='text-muted-foreground'>Quando</dt>
          <dd>{formatDocumentDateTime(document.acceptedAt)}</dd>
          <dt className='text-muted-foreground'>Versão</dt>
          <dd>
            {document.currentVersion
              ? `Versão ${document.currentVersion.number}`
              : '—'}
          </dd>
          <dt className='text-muted-foreground'>Valor</dt>
          <dd className='tabular-nums'>
            {formatDocumentMoney(document.totalValue)}
          </dd>
        </dl>
      </Card>
    )
  }
  if (document.status === 'DECLINED' && document.declinedAt) {
    return (
      <Card title='Recusa'>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
          <dt className='text-muted-foreground'>Quando</dt>
          <dd>{formatDocumentDateTime(document.declinedAt)}</dd>
          <dt className='text-muted-foreground'>Motivo</dt>
          <dd className='min-w-0 break-words'>
            {document.declineReason ?? 'Não informado'}
          </dd>
        </dl>
      </Card>
    )
  }
  return null
}

function ResponsesCard({ document }: { document: DocumentDTO }) {
  const responses = useDocumentResponses(document.workspaceId, document.id)
  const content = useMemo(() => asContent(document), [document])
  const labels = useMemo(() => {
    const fields = new Map<string, string>()
    const items = new Map<string, string>()
    if (content) {
      for (const field of documentFields(content)) {
        fields.set(field.id, field.label)
      }
      for (const item of documentPricingItems(content)) {
        items.set(item.id, item.name)
      }
    }
    return { fields, items }
  }, [content])

  if (responses.isLoading) {
    return <Skeleton className='h-24 w-full rounded-xl' />
  }
  const list = responses.data ?? []
  if (responses.error || list.length === 0) return null

  return (
    <Card
      title='Respostas'
      description='O que cada leitor preencheu e escolheu na tabela de preços.'
    >
      <ul className='grid gap-3'>
        {list.map((response) => {
          const fieldEntries = Object.entries(response.fields)
          const picked = Object.entries(response.selection).filter(
            ([, choice]) => choice.selected,
          )
          return (
            <li
              key={response.id}
              data-testid='document-response'
              className='grid gap-2 rounded-lg border p-3'
            >
              <div className='flex flex-wrap items-baseline justify-between gap-2'>
                <span className='font-medium text-sm'>
                  {RESPONSE_LABELS[response.action]}
                  {response.name ? ` · ${response.name}` : ''}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {formatDocumentDateTime(response.createdAt)} · versão{' '}
                  {response.versionNumber}
                </span>
              </div>
              {response.reason ? (
                <p className='text-sm'>“{response.reason}”</p>
              ) : null}
              {fieldEntries.length > 0 ? (
                <dl className='grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,12rem)_1fr]'>
                  {fieldEntries.map(([fieldId, value]) => (
                    <div key={fieldId} className='contents'>
                      <dt className='truncate text-muted-foreground'>
                        {labels.fields.get(fieldId) ?? 'Campo'}
                      </dt>
                      <dd className='min-w-0 break-words'>
                        {fieldValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {picked.length > 0 ? (
                <div className='grid gap-1 text-sm'>
                  <span className='text-muted-foreground text-xs'>
                    Itens escolhidos
                  </span>
                  <ul className='grid gap-0.5'>
                    {picked.map(([itemId, choice]) => (
                      <li key={itemId} className='flex justify-between gap-3'>
                        <span className='truncate'>
                          {labels.items.get(itemId) ?? 'Item'}
                        </span>
                        <span className='shrink-0 text-muted-foreground tabular-nums'>
                          × {choice.quantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {response.totalValue !== null ? (
                <p className='text-right font-medium text-sm tabular-nums'>
                  Total {formatDocumentMoney(response.totalValue)}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * "Visão geral" of the document page: the generic link, recipients with
 * status and personal links, the CRM links, the accept/decline outcome and
 * the responses (field values and the pricing selection).
 */
export function DocumentOverview({
  document,
  onSend,
}: {
  document: DocumentDTO
  onSend: () => void
}) {
  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]'>
      <div className='grid content-start gap-4'>
        <OutcomeCard document={document} />
        <RecipientsCard document={document} onSend={onSend} />
        <ResponsesCard document={document} />
      </div>
      <div className='grid content-start gap-4'>
        <LinkCard document={document} />
        <CrmLinksCard document={document} />
      </div>
    </div>
  )
}
