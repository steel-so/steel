'use client'

import {
  Delete02Icon,
  Search01Icon,
  SentIcon,
  UserAdd01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
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
import { PhoneInput } from '@/components/ui/phone-input'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import {
  type DocumentRecipientBody,
  type SendDocumentBody,
  useSendDocument,
} from '@/src/hooks/use-documents'
import { SendDocumentSchema } from '@/src/schemas/document.schema'
import type { CrmPersonDTO } from '@/types/crm-person'
import type { DocumentDTO, DocumentRecipientDTO } from '@/types/document'
import { CopyLinkButton } from './copy-link-button'
import {
  fromDateInputValue,
  RECIPIENT_CHANNEL_LABELS,
  RECIPIENT_ROLE_LABELS,
  toDateInputValue,
} from './documents-tone'
import { OptionSelect } from './option-select'

type Role = DocumentRecipientDTO['role']

interface RecipientRow {
  key: number
  name: string
  email: string
  phone: string
  personId?: string
  role: Role
}

const ROLE_OPTIONS = (['APPROVER', 'VIEWER'] as const).map((value) => ({
  value,
  label: RECIPIENT_ROLE_LABELS[value],
}))

const MAX_MATCHES = 6

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** A CRM person as a recipient: e-mail when there is one, else WhatsApp (never both). */
function rowFromPerson(person: CrmPersonDTO, key: number): RecipientRow {
  const email = person.emails[0] ?? ''
  const phone = email ? '' : (person.phones[0] ?? '')
  return {
    key,
    name: person.name,
    email,
    phone,
    personId: person.id,
    role: 'APPROVER',
  }
}

function toBody(row: RecipientRow): DocumentRecipientBody {
  return {
    name: row.name.trim(),
    email: row.email.trim() || undefined,
    phone: row.phone.trim() || undefined,
    personId: row.personId,
    role: row.role,
  }
}

function PersonPicker({
  workspaceId,
  exclude,
  onPick,
}: {
  workspaceId: string
  exclude: Set<string>
  onPick: (person: CrmPersonDTO) => void
}) {
  const id = useId()
  const { items, isLoading } = useCrmResourceList<CrmPersonDTO>(
    workspaceId,
    'people',
  )
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const needle = normalize(query.trim())
    if (!needle) return []
    return items
      .filter((person) => !exclude.has(person.id))
      .filter(
        (person) =>
          normalize(person.name).includes(needle) ||
          person.emails.some((email) => normalize(email).includes(needle)),
      )
      .slice(0, MAX_MATCHES)
  }, [items, query, exclude])

  return (
    <div className='relative'>
      <Label htmlFor={`${id}-q`} className='sr-only'>
        Buscar pessoa do CRM
      </Label>
      <SteelIcon
        icon={Search01Icon}
        className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground'
      />
      <Input
        id={`${id}-q`}
        type='search'
        value={query}
        autoComplete='off'
        onChange={(event) => setQuery(event.target.value)}
        placeholder={
          isLoading ? 'Carregando pessoas…' : 'Buscar pessoa do CRM…'
        }
        className='pl-8'
      />
      {query.trim() ? (
        <ul
          aria-label='Pessoas encontradas'
          className='absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md'
        >
          {matches.length === 0 ? (
            <li className='px-2 py-1.5 text-muted-foreground text-sm'>
              Ninguém encontrado. Adicione manualmente abaixo.
            </li>
          ) : (
            matches.map((person) => (
              <li key={person.id}>
                <button
                  type='button'
                  onClick={() => {
                    onPick(person)
                    setQuery('')
                  }}
                  className='flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'
                >
                  <span className='truncate font-medium text-sm'>
                    {person.name}
                  </span>
                  <span className='truncate text-muted-foreground text-xs'>
                    {person.emails[0] ?? person.phones[0] ?? 'Sem contato'}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

function RecipientEditor({
  row,
  onChange,
  onRemove,
}: {
  row: RecipientRow
  onChange: (patch: Partial<RecipientRow>) => void
  onRemove: () => void
}) {
  const id = useId()
  return (
    <li
      data-testid='send-recipient'
      className='grid gap-2 rounded-lg border p-3 sm:grid-cols-2'
    >
      <div className='grid gap-1 sm:col-span-2'>
        <div className='flex items-center justify-between gap-2'>
          <Label htmlFor={`${id}-name`}>Nome</Label>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            onClick={onRemove}
            aria-label={`Remover ${row.name || 'destinatário'}`}
          >
            <SteelIcon icon={Delete02Icon} />
          </Button>
        </div>
        <Input
          id={`${id}-name`}
          value={row.name}
          maxLength={200}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      <div className='grid gap-1'>
        <Label htmlFor={`${id}-email`}>E-mail</Label>
        <Input
          id={`${id}-email`}
          type='email'
          value={row.email}
          maxLength={320}
          disabled={Boolean(row.phone)}
          placeholder={row.phone ? 'Já vai por WhatsApp' : undefined}
          onChange={(event) => onChange({ email: event.target.value })}
        />
      </div>
      <div className='grid gap-1'>
        <Label htmlFor={`${id}-phone`}>WhatsApp</Label>
        <PhoneInput
          id={`${id}-phone`}
          value={row.phone}
          maxLength={20}
          disabled={Boolean(row.email)}
          placeholder={row.email ? 'Já vai por e-mail' : '(11) 98888-7777'}
          onValueChange={(phone) => onChange({ phone })}
        />
      </div>
      <div className='grid gap-1'>
        <Label htmlFor={`${id}-role`}>Papel</Label>
        <OptionSelect
          id={`${id}-role`}
          value={row.role}
          options={ROLE_OPTIONS}
          onChange={(value) => onChange({ role: value as Role })}
        />
      </div>
      <p className='text-muted-foreground text-xs sm:col-span-2'>
        {row.phone
          ? 'Será enviado por WhatsApp.'
          : row.email
            ? 'Será enviado por e-mail.'
            : 'Preencha o e-mail ou o WhatsApp (só um). Sem nenhum, fica só o link pessoal.'}
      </p>
    </li>
  )
}

function SentLinks({ document }: { document: DocumentDTO }) {
  return (
    <div className='grid gap-3'>
      <div className='grid gap-1.5 rounded-lg border bg-muted/30 p-3'>
        <span className='font-medium text-sm'>Link geral</span>
        <span className='text-muted-foreground text-xs'>
          Para colar onde quiser. Cada leitura aparece como visitante.
        </span>
        <div className='flex min-w-0 items-center gap-2'>
          <code className='min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs'>
            {document.publicUrl}
          </code>
          <CopyLinkButton url={document.publicUrl} iconOnly />
        </div>
      </div>
      {document.recipients.length > 0 ? (
        <ul aria-label='Links pessoais' className='grid gap-2'>
          {document.recipients.map((recipient) => (
            <li
              key={recipient.id}
              className='flex min-w-0 items-center gap-2 rounded-lg border p-2.5'
            >
              <span className='min-w-0 flex-1'>
                <span className='block truncate font-medium text-sm'>
                  {recipient.name}
                </span>
                <span className='block truncate text-muted-foreground text-xs'>
                  {RECIPIENT_ROLE_LABELS[recipient.role]} ·{' '}
                  {RECIPIENT_CHANNEL_LABELS[recipient.channel]}
                </span>
              </span>
              <CopyLinkButton
                url={recipient.url}
                label={`Copiar link de ${recipient.name}`}
                iconOnly
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * "Enviar" / "Atualizar versão": freezes the current draft as a new version
 * and delivers it — recipients picked from CRM people or typed (role
 * Aprovador/Leitor, channel link, e-mail or WhatsApp), a message and the
 * validity. Shows the generic and personal links after sending.
 */
export function SendDocumentDialog({
  workspaceId,
  document,
  open,
  onOpenChange,
  beforeSend,
  onSent,
}: {
  workspaceId: string
  document: DocumentDTO
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs before sending (the editor saves pending changes); false aborts. */
  beforeSend?: () => Promise<boolean>
  onSent?: (document: DocumentDTO) => void
}) {
  const id = useId()
  const send = useSendDocument(workspaceId, document.id)
  const nextKey = useRef(1)
  const [rows, setRows] = useState<RecipientRow[]>([])
  const [message, setMessage] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [sent, setSent] = useState<DocumentDTO | null>(null)
  const update = Boolean(document.currentVersion)

  // Fresh form each time it opens; a new document suggests its contact.
  useEffect(() => {
    if (!open) return
    setSent(null)
    setMessage('')
    setValidUntil(toDateInputValue(document.validUntil))
    const linked = document.person
    const alreadySent = document.recipients.some(
      (recipient) => recipient.name === linked?.name,
    )
    setRows(
      linked && !alreadySent
        ? [
            {
              key: nextKey.current++,
              name: linked.name,
              email: '',
              phone: '',
              personId: linked.id,
              role: 'APPROVER',
            },
          ]
        : [],
    )
  }, [open])

  const picked = useMemo(() => {
    const ids = new Set<string>()
    for (const row of rows) {
      if (row.personId) ids.add(row.personId)
    }
    return ids
  }, [rows])

  function patchRow(key: number, patch: Partial<RecipientRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    )
  }

  function addManual() {
    setRows((current) => [
      ...current,
      {
        key: nextKey.current++,
        name: '',
        email: '',
        phone: '',
        role: 'APPROVER',
      },
    ])
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const body: SendDocumentBody = {
      recipients: rows.map(toBody),
      message: message.trim() || undefined,
      validUntil: validUntil ? fromDateInputValue(validUntil) : null,
    }
    const parsed = SendDocumentSchema.safeParse(body)
    if (!parsed.success) {
      notify.error(parsed.error.issues[0]?.message ?? 'Revise os dados')
      return
    }
    if (beforeSend && !(await beforeSend())) return
    try {
      const result = await send.mutateAsync(body)
      setSent(result)
      onSent?.(result)
      notify.success(update ? 'Nova versão enviada.' : 'Documento enviado.')
    } catch (error) {
      notify.error(error, 'Não foi possível enviar o documento')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {sent
              ? 'Pronto, links gerados'
              : update
                ? 'Atualizar versão'
                : 'Enviar documento'}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? 'Copie os links ou acompanhe as leituras na página do documento.'
              : update
                ? 'As alterações viram uma nova versão. Quem já recebeu passa a ver a versão nova no mesmo link.'
                : 'O documento é congelado nesta versão e ganha um link rastreado. Edições depois disso só chegam ao leitor quando você atualizar a versão.'}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className='min-h-0 overflow-y-auto'>
            <SentLinks document={sent} />
          </div>
        ) : (
          <form
            id={`${id}-form`}
            onSubmit={(event) => void submit(event)}
            className='grid min-h-0 gap-4 overflow-y-auto'
          >
            <fieldset className='grid gap-2'>
              <legend className='mb-2 font-medium text-sm'>
                {update ? 'Novos destinatários (opcional)' : 'Destinatários'}
              </legend>
              <PersonPicker
                workspaceId={workspaceId}
                exclude={picked}
                onPick={(person) =>
                  setRows((current) => [
                    ...current,
                    rowFromPerson(person, nextKey.current++),
                  ])
                }
              />
              {rows.length > 0 ? (
                <ul className='grid gap-2'>
                  {rows.map((row) => (
                    <RecipientEditor
                      key={row.key}
                      row={row}
                      onChange={(patch) => patchRow(row.key, patch)}
                      onRemove={() =>
                        setRows((current) =>
                          current.filter((item) => item.key !== row.key),
                        )
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className='text-muted-foreground text-xs'>
                  Sem destinatários, o documento fica disponível só pelo link
                  geral.
                </p>
              )}
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='justify-self-start'
                onClick={addManual}
              >
                <SteelIcon icon={UserAdd01Icon} data-icon='inline-start' />
                Adicionar manualmente
              </Button>
            </fieldset>

            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-message`}>Mensagem (opcional)</Label>
              <Textarea
                id={`${id}-message`}
                value={message}
                maxLength={2000}
                rows={3}
                placeholder='Olá! Segue a proposta que conversamos.'
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>

            <div className='grid gap-1.5 sm:max-w-56'>
              <Label htmlFor={`${id}-valid`}>Válido até</Label>
              <Input
                id={`${id}-valid`}
                type='date'
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            </div>
          </form>
        )}

        <DialogFooter>
          {sent ? (
            <Button type='button' onClick={() => onOpenChange(false)}>
              Concluir
            </Button>
          ) : (
            <>
              <Button
                type='button'
                variant='ghost'
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type='button'
                onClick={() => void submit()}
                disabled={send.isPending}
                data-testid='send-document-submit'
              >
                <SteelIcon icon={SentIcon} data-icon='inline-start' />
                {send.isPending
                  ? 'Enviando…'
                  : update
                    ? 'Enviar nova versão'
                    : 'Enviar'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
