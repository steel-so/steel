'use client'

import { Cancel01Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CrmEmailCampaignRecipientPicker,
  crmDefaultRecipientSelection,
  type RecipientSelection,
} from '@/app/_components/crm/crm-email-campaign-recipient-picker'
import { EmailEditorShell } from '@/app/_components/crm/email-editor-shell'
import { EmailSenderPicker } from '@/app/_components/crm/email-sender-picker'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { notify } from '@/lib/notify'
import {
  renderCrmEmailTemplate,
  useSendCrmEmailTest,
} from '@/src/hooks/use-crm-email-builder'
import {
  useCreateCrmEmailCampaign,
  useCrmEmailCampaignRecipients,
  useCrmEmailOptOuts,
  useSendCrmEmailCampaign,
} from '@/src/hooks/use-crm-email-marketing'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type {
  CrmCampaignRecipientStatusDTO,
  CrmCampaignStatusDTO,
  CrmEmailCampaignDTO,
  CrmEmailTemplateDTO,
  CrmMailingListDTO,
} from '@/types/crm-email-marketing'
import type { CrmPersonDTO } from '@/types/crm-person'

type EditorRef = {
  getEmailHTML: () => Promise<string>
  getJSON: () => unknown
}

const STATUS_LABEL: Record<CrmCampaignStatusDTO, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  SENDING: 'Enviando',
  SENT: 'Enviada',
  FAILED: 'Falhou',
}

const STATUS_STYLE: Record<CrmCampaignStatusDTO, string> = {
  DRAFT: 'bg-muted text-foreground',
  SCHEDULED: 'bg-amber-500/20 text-amber-600',
  SENDING: 'bg-sky-500/20 text-sky-600',
  SENT: 'bg-emerald-500/20 text-emerald-600',
  FAILED: 'bg-destructive/20 text-destructive',
}

const RECIPIENT_LABEL: Record<CrmCampaignRecipientStatusDTO, string> = {
  PENDING: 'Pendente',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Descadastrado',
}

const RECIPIENT_STYLE: Record<CrmCampaignRecipientStatusDTO, string> = {
  PENDING: 'text-muted-foreground',
  SENT: 'text-emerald-500',
  FAILED: 'text-destructive',
  SKIPPED: 'text-amber-600',
}

const STATUS_OPTIONS = (
  Object.keys(STATUS_LABEL) as CrmCampaignStatusDTO[]
).map((status) => ({ value: status, label: STATUS_LABEL[status] }))

const LOOKUP_KINDS: LookupKind[] = ['users']

const COLUMNS: GridColumn[] = [
  {
    key: 'subject',
    header: 'Assunto',
    kind: 'text',
    primary: true,
    readonly: true,
    placeholder: '—',
  },
  {
    key: 'status',
    header: 'Status',
    kind: 'select',
    readonly: true,
    options: STATUS_OPTIONS,
    optionStyles: STATUS_STYLE,
  },
  {
    key: 'recipientCount',
    header: 'Destinatários',
    kind: 'number',
    readonly: true,
  },
  { key: 'sentCount', header: 'Enviados', kind: 'number', readonly: true },
  { key: 'failedCount', header: 'Falhas', kind: 'number', readonly: true },
  {
    key: 'skippedCount',
    header: 'Descadastrados',
    kind: 'number',
    readonly: true,
  },
  { key: 'scheduledAt', header: 'Agendada para', kind: 'readonly-date' },
  { key: 'sentAt', header: 'Enviada em', kind: 'readonly-date' },
  {
    key: 'createdById',
    header: 'Criada por',
    kind: 'relation',
    relationKind: 'users',
    readonly: true,
  },
  { key: 'createdAt', header: 'Criada em', kind: 'readonly-date' },
]

export function CrmEmailCampaignsTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const { items, isLoading, refetch } = useCrmResourceList<CrmEmailCampaignDTO>(
    workspaceId,
    'email-campaigns',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const columns = useMemo(() => COLUMNS, [])
  const [viewing, setViewing] = useState<string | 'new' | null>(null)

  return (
    <>
      <DataTable
        columns={columns}
        data={items}
        workspaceId={workspaceId}
        slug={slug}
        resource='email-campaigns'
        createTitle='campanha'
        lookups={lookups}
        isLoading={isLoading}
        searchPlaceholder='Buscar campanhas…'
        refetch={refetch}
        disableInlineCreate
        headerAction={
          <Button
            size='sm'
            onClick={() => setViewing('new')}
            data-tour='email-campaigns-new'
          >
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Nova campanha
          </Button>
        }
        onOpenRecord={(record) => setViewing(record.id)}
      />

      <CampaignSheet
        workspaceId={workspaceId}
        slug={slug}
        viewing={viewing}
        onClose={() => setViewing(null)}
        onSent={() => {
          setViewing(null)
          refetch()
        }}
      />
    </>
  )
}

function CampaignSheet({
  workspaceId,
  slug,
  viewing,
  onClose,
  onSent,
}: {
  workspaceId: string
  slug: string
  viewing: string | 'new' | null
  onClose: () => void
  onSent: () => void
}) {
  const open = viewing !== null
  const isNew = viewing === 'new'
  // The composer keeps this up to date so closing the sheet never silently
  // throws away a half-written campaign.
  const dirtyRef = useRef(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  function requestClose() {
    if (isNew && dirtyRef.current) {
      setConfirmDiscard(true)
      return
    }
    dirtyRef.current = false
    onClose()
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => (o ? null : requestClose())}>
        <SheetContent
          side='right'
          showCloseButton={false}
          className='flex w-full max-w-[640px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px] data-[side=right]:sm:max-w-[640px]'
        >
          {!open ? null : isNew ? (
            <CampaignComposer
              workspaceId={workspaceId}
              slug={slug}
              dirtyRef={dirtyRef}
              onClose={requestClose}
              onSent={() => {
                dirtyRef.current = false
                onSent()
              }}
            />
          ) : (
            <CampaignDetail
              workspaceId={workspaceId}
              id={viewing as string}
              onClose={onClose}
            />
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar esta campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Você começou a preencher a campanha e ela ainda não foi enviada.
              Se fechar agora, o que foi preenchido será perdido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                dirtyRef.current = false
                setConfirmDiscard(false)
                onClose()
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function PanelHeader({
  onClose,
  title,
  badge,
}: {
  onClose: () => void
  title: React.ReactNode
  badge?: React.ReactNode
}) {
  return (
    <div className='flex shrink-0 items-center gap-2 border-b p-3'>
      <Button
        variant='ghost'
        size='icon-sm'
        onClick={onClose}
        aria-label='Fechar'
      >
        <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
      <SheetTitle className='truncate'>{title}</SheetTitle>
      {badge}
    </div>
  )
}

function Field({
  label,
  children,
  required = false,
  error,
}: {
  label: React.ReactNode
  children: React.ReactNode
  required?: boolean
  error?: string
}) {
  return (
    <div className='grid gap-1.5'>
      <Label className='text-muted-foreground text-xs'>
        {label}
        {required ? (
          <span className='text-destructive' aria-hidden='true'>
            {' '}
            *
          </span>
        ) : null}
      </Label>
      <div className='min-w-0'>{children}</div>
      {error ? (
        <p role='alert' className='text-destructive text-xs'>
          {error}
        </p>
      ) : null}
    </div>
  )
}

type FieldErrors = Partial<
  Record<'subject' | 'from' | 'recipients' | 'schedule' | 'link', string>
>

function CampaignComposer({
  workspaceId,
  slug,
  dirtyRef,
  onClose,
  onSent,
}: {
  workspaceId: string
  slug: string
  dirtyRef: React.MutableRefObject<boolean>
  onClose: () => void
  onSent: () => void
}) {
  const editorRef = useRef<EditorRef | null>(null)
  const [subject, setSubject] = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduledAtLocal, setScheduledAtLocal] = useState('')
  const [recipients, setRecipients] = useState<RecipientSelection>(
    crmDefaultRecipientSelection(),
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [editorSeed, setEditorSeed] = useState<string | undefined>(undefined)
  const { items: templates } = useCrmResourceList<CrmEmailTemplateDTO>(
    workspaceId,
    'email-templates',
  )
  const createCampaign = useCreateCrmEmailCampaign(workspaceId)
  const sendCampaign = useSendCrmEmailCampaign(workspaceId)
  const [submitting, setSubmitting] = useState(false)
  const [campaignLink, setCampaignLink] = useState('')
  const [builderPreview, setBuilderPreview] = useState('')
  const builderTemplate = templates.find(
    (t) => t.id === selectedTemplateId && t.kind === 'BUILDER',
  )
  const [errors, setErrors] = useState<FieldErrors>({})
  const sendTest = useSendCrmEmailTest(workspaceId, builderTemplate?.id ?? '')
  const { items: people } = useCrmResourceList<CrmPersonDTO>(
    workspaceId,
    'people',
  )
  const { items: mailingLists } = useCrmResourceList<CrmMailingListDTO>(
    workspaceId,
    'mailing-lists',
  )
  const { isOptedOut } = useCrmEmailOptOuts(workspaceId)

  dirtyRef.current = Boolean(
    subject.trim() ||
      selectedTemplateId ||
      campaignLink.trim() ||
      recipients.scope === 'SELECTED',
  )

  /** Approximate audience: the server still removes duplicates and opt-outs. */
  const estimatedRecipients = useMemo(() => {
    const eligible = people.filter(
      (p) => p.emails.length > 0 && !isOptedOut(p.emails[0], p.id),
    )
    if (recipients.scope === 'ALL') return eligible.length
    const fromPeople = eligible.filter((p) =>
      recipients.personIds.includes(p.id),
    ).length
    const fromLists = mailingLists
      .filter((l) => recipients.mailingListIds.includes(l.id))
      .reduce((sum, l) => sum + l.memberCount, 0)
    return fromPeople + fromLists + recipients.extraEmails.length
  }, [people, mailingLists, recipients, isOptedOut])

  function clearError(field: keyof FieldErrors) {
    setErrors((cur) => (cur[field] ? { ...cur, [field]: undefined } : cur))
  }

  async function handleSendTest() {
    if (!builderTemplate) return
    try {
      const result = await sendTest.mutateAsync({})
      notify.success(
        result?.to
          ? `Teste enviado para ${result.to}`
          : 'Teste enviado para o seu e-mail',
      )
    } catch (err) {
      notify.error(err)
    }
  }

  // Visual-builder templates are rendered by the server (sample contact).
  useEffect(() => {
    if (!builderTemplate) return
    const link = /^https?:\/\//.test(campaignLink.trim())
      ? campaignLink.trim()
      : undefined
    const handle = setTimeout(() => {
      renderCrmEmailTemplate(workspaceId, builderTemplate.id, {
        campaignLink: link,
      })
        .then((rendered) => setBuilderPreview(rendered.html))
        .catch(() => setBuilderPreview(''))
    }, 300)
    return () => clearTimeout(handle)
  }, [builderTemplate, campaignLink, workspaceId])

  function handlePickTemplate(templateId: string) {
    setSelectedTemplateId(templateId)
    const template = templates.find((t) => t.id === templateId)
    if (!template) return
    if (!subject.trim()) setSubject(template.subject)
    setEditorSeed(template.contentHtml)
  }

  type Prepared = {
    payload: Parameters<typeof createCampaign.mutateAsync>[0]
    scheduled: boolean
  }
  const [prepared, setPrepared] = useState<Prepared | null>(null)

  /** Checks every field, shows all problems at once, and builds the payload. */
  async function prepare(): Promise<Prepared | null> {
    const next: FieldErrors = {}
    if (!subject.trim()) next.subject = 'Informe o assunto do e-mail.'
    if (!fromAddress.trim()) next.from = 'Escolha quem aparece como remetente.'
    if (
      recipients.scope === 'SELECTED' &&
      recipients.personIds.length === 0 &&
      recipients.mailingListIds.length === 0 &&
      recipients.extraEmails.length === 0
    ) {
      next.recipients =
        'Escolha pelo menos um contato, uma lista ou um e-mail avulso.'
    }

    let content: {
      contentHtml?: string
      contentJson?: string
      templateId?: string
      campaignLink?: string
    } = {}
    if (builderTemplate) {
      const link = campaignLink.trim()
      if (link && !/^https?:\/\//.test(link)) {
        next.link = 'O link precisa começar com https://'
      }
      content = {
        templateId: builderTemplate.id,
        campaignLink: link || undefined,
      }
    } else {
      const html = (await editorRef.current?.getEmailHTML())?.trim()
      if (!html) {
        notify.error('O conteúdo do e-mail está vazio. Escreva a mensagem.')
        setErrors(next)
        return null
      }
      content = {
        contentHtml: html,
        contentJson: JSON.stringify(editorRef.current?.getJSON() ?? null),
      }
    }

    let scheduledAt: string | undefined
    if (scheduleEnabled) {
      const date = scheduledAtLocal ? new Date(scheduledAtLocal) : null
      if (!date) {
        next.schedule = 'Informe a data e a hora do envio.'
      } else if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        next.schedule = 'Escolha uma data e hora no futuro.'
      } else {
        scheduledAt = date.toISOString()
      }
    }

    setErrors(next)
    if (Object.values(next).some(Boolean)) {
      notify.error('Confira os campos marcados em vermelho.')
      return null
    }

    return {
      scheduled: Boolean(scheduledAt),
      payload: {
        subject,
        ...content,
        fromAddress,
        recipientScope: recipients.scope,
        personIds:
          recipients.scope === 'SELECTED' ? recipients.personIds : undefined,
        mailingListIds:
          recipients.scope === 'SELECTED'
            ? recipients.mailingListIds
            : undefined,
        extraEmails:
          recipients.scope === 'SELECTED' ? recipients.extraEmails : undefined,
        scheduledAt,
      },
    }
  }

  async function perform(ready: Prepared) {
    setSubmitting(true)
    try {
      const created = await createCampaign.mutateAsync(ready.payload)
      if (!ready.scheduled) {
        await sendCampaign.mutateAsync(created.id)
      }
      notify.success(ready.scheduled ? 'Campanha agendada' : 'Campanha enviada')
      onSent()
    } catch (err) {
      notify.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  async function onSubmit() {
    const ready = await prepare()
    if (!ready) return
    // Sending cannot be undone, so it asks first; scheduling can be changed.
    if (ready.scheduled) {
      await perform(ready)
      return
    }
    setPrepared(ready)
  }

  return (
    <>
      <PanelHeader onClose={onClose} title='Nova campanha' />

      <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'>
        <div className='flex flex-col gap-5 p-4'>
          <Field label='Assunto' required error={errors.subject}>
            <Input
              value={subject}
              aria-invalid={Boolean(errors.subject)}
              onChange={(e) => {
                setSubject(e.target.value)
                clearError('subject')
              }}
              placeholder='Novidades de junho'
            />
          </Field>

          <EmailSenderPicker
            workspaceId={workspaceId}
            workspaceSlug={slug}
            id='email-campaign-from'
            value={fromAddress}
            onChange={(v) => {
              setFromAddress(v)
              clearError('from')
            }}
          />
          {errors.from ? (
            <p role='alert' className='-mt-3 text-destructive text-xs'>
              {errors.from}
            </p>
          ) : null}

          {templates.length > 0 ? (
            <Field label='Começar a partir de um modelo (opcional)'>
              <Select
                value={selectedTemplateId || undefined}
                onValueChange={(v) => v && handlePickTemplate(v)}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Editor em branco' />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                        {template.kind === 'BUILDER' ? ' · editor visual' : ''}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {builderTemplate ? (
            <>
              <Field label='Link da campanha' error={errors.link}>
                <Input
                  type='url'
                  value={campaignLink}
                  aria-invalid={Boolean(errors.link)}
                  onChange={(e) => {
                    setCampaignLink(e.target.value)
                    clearError('link')
                  }}
                  placeholder='https://suaempresa.com.br/oferta?utm_source=email'
                />
                <p className='mt-1 text-muted-foreground text-xs'>
                  Usado nos botões que apontam para “Link da campanha”.
                </p>
              </Field>
              <Field label='Pré-visualização (contato de exemplo)'>
                {builderPreview ? (
                  <iframe
                    title='Pré-visualização da campanha'
                    srcDoc={builderPreview}
                    sandbox=''
                    className='h-[480px] w-full rounded-lg border border-border bg-white'
                  />
                ) : (
                  <div className='flex h-40 items-center justify-center rounded-lg border border-border text-muted-foreground text-xs'>
                    Gerando pré-visualização…
                  </div>
                )}
              </Field>
            </>
          ) : (
            <Field label='Conteúdo'>
              <div className='min-h-[420px]'>
                <EmailEditorShell
                  key={selectedTemplateId || 'blank'}
                  initialContent={editorSeed}
                  ref={(r) => {
                    editorRef.current = r as unknown as EditorRef | null
                  }}
                />
              </div>
            </Field>
          )}

          <Field label='Destinatários' required error={errors.recipients}>
            <CrmEmailCampaignRecipientPicker
              workspaceId={workspaceId}
              value={recipients}
              onChange={(v) => {
                setRecipients(v)
                clearError('recipients')
              }}
            />
            <p className='mt-2 text-muted-foreground text-xs'>
              {recipients.scope === 'ALL'
                ? 'Por padrão, o e-mail vai para todos os contatos que têm e-mail.'
                : 'Só os contatos, listas e e-mails escolhidos receberão.'}{' '}
              Quem pediu para sair da lista (descadastro) nunca recebe.
            </p>
          </Field>

          <Field label='Agendamento' error={errors.schedule}>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                className='size-4 accent-primary'
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
              />
              <span>Enviar mais tarde</span>
            </label>
            {scheduleEnabled ? (
              <div className='mt-3 grid gap-1.5'>
                <Input
                  type='datetime-local'
                  value={scheduledAtLocal}
                  aria-invalid={Boolean(errors.schedule)}
                  onChange={(e) => {
                    setScheduledAtLocal(e.target.value)
                    clearError('schedule')
                  }}
                />
              </div>
            ) : null}
          </Field>
        </div>
      </div>

      <div className='flex shrink-0 flex-wrap items-center justify-end gap-2 border-t p-3'>
        {builderTemplate ? (
          <Button
            variant='outline'
            onClick={handleSendTest}
            disabled={submitting || sendTest.isPending}
          >
            {sendTest.isPending ? 'Enviando teste…' : 'Enviar teste para mim'}
          </Button>
        ) : (
          <span className='mr-auto text-muted-foreground text-xs'>
            Para receber um teste, comece a partir de um modelo.
          </span>
        )}
        <Button variant='ghost' onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting
            ? 'Enviando…'
            : scheduleEnabled
              ? 'Agendar envio'
              : 'Enviar agora'}
        </Button>
      </div>

      <AlertDialog
        open={prepared !== null}
        onOpenChange={(o) => (o ? null : setPrepared(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar a campanha agora?</AlertDialogTitle>
            <AlertDialogDescription>
              {`O e-mail "${subject.trim()}" será enviado agora para cerca de ${estimatedRecipients} ${estimatedRecipients === 1 ? 'pessoa' : 'pessoas'}, sem contar quem já pediu descadastro. Depois de enviado, não dá para cancelar.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => {
                const ready = prepared
                setPrepared(null)
                if (ready) perform(ready)
              }}
            >
              Enviar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CampaignDetail({
  workspaceId,
  id,
  onClose,
}: {
  workspaceId: string
  id: string
  onClose: () => void
}) {
  const { items: campaigns } = useCrmResourceList<CrmEmailCampaignDTO>(
    workspaceId,
    'email-campaigns',
  )
  const campaign = campaigns.find((c) => c.id === id)
  const { data: recipients, isLoading: recipientsLoading } =
    useCrmEmailCampaignRecipients(workspaceId, id)

  return (
    <>
      <PanelHeader
        onClose={onClose}
        title={campaign?.subject ?? 'Campanha'}
        badge={
          campaign ? (
            <span
              className={`ml-2 shrink-0 rounded-full px-2 py-0.5 font-medium text-xs ${STATUS_STYLE[campaign.status]}`}
            >
              {STATUS_LABEL[campaign.status]}
            </span>
          ) : null
        }
      />

      <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'>
        {!campaign ? (
          <div className='p-4 text-muted-foreground text-sm'>
            Campanha não encontrada
          </div>
        ) : (
          <div className='flex flex-col gap-5 p-4'>
            <Field label='De'>
              <span className='text-sm'>{campaign.fromAddress}</span>
            </Field>

            <Field label='Conteúdo'>
              <div
                className='prose prose-sm max-w-none rounded-lg border border-border bg-card p-4 dark:prose-invert'
                dangerouslySetInnerHTML={{ __html: campaign.contentHtml }}
              />
            </Field>

            <Field label='Resumo'>
              <dl className='grid grid-cols-2 gap-2 text-sm sm:grid-cols-4'>
                <Metric label='Destinatários' value={campaign.recipientCount} />
                <Metric
                  label='Enviados'
                  value={campaign.sentCount}
                  tone='emerald'
                />
                <Metric
                  label='Falhas'
                  value={campaign.failedCount}
                  tone='destructive'
                />
                <Metric
                  label='Descadastrados'
                  value={campaign.skippedCount}
                  tone='amber'
                />
              </dl>
            </Field>

            <Field label={`Destinatários (${recipients?.length ?? 0})`}>
              {recipientsLoading ? null : (
                <ul className='max-h-96 divide-y divide-border overflow-auto rounded-lg border border-border'>
                  {recipients?.map((r) => (
                    <li key={r.id} className='px-3 py-2'>
                      <div className='flex items-center justify-between gap-2'>
                        <div className='min-w-0'>
                          <div className='truncate font-medium text-sm'>
                            {r.name ?? r.email}
                          </div>
                          {r.name ? (
                            <div className='truncate text-muted-foreground text-xs'>
                              {r.email}
                            </div>
                          ) : null}
                        </div>
                        <span
                          className={`shrink-0 text-xs ${RECIPIENT_STYLE[r.status]}`}
                        >
                          {RECIPIENT_LABEL[r.status]}
                        </span>
                      </div>
                      {r.errorMessage ? (
                        <div className='mt-1 truncate text-destructive text-xs'>
                          {r.errorMessage}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          </div>
        )}
      </div>
    </>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'emerald' | 'destructive' | 'amber'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-500'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'amber'
          ? 'text-amber-600'
          : ''
  return (
    <div className='rounded-lg border border-border bg-card p-3'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className={`mt-1 font-semibold text-lg ${toneClass}`}>{value}</dd>
    </div>
  )
}
