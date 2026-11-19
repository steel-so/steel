'use client'

import {
  Cancel01Icon,
  PlusSignIcon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCrmEmailOptOuts } from '@/src/hooks/use-crm-email-marketing'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import { useCrmSegments } from '@/src/hooks/use-crm-segments'
import type { CrmMailingListDTO } from '@/types/crm-email-marketing'
import type { CrmPersonDTO } from '@/types/crm-person'

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type RecipientSelection = {
  scope: 'ALL' | 'SELECTED'
  personIds: string[]
  mailingListIds: string[]
  /** Dynamic segments, resolved when the campaign is created. */
  segmentIds?: string[]
  extraEmails: string[]
}

export function crmDefaultRecipientSelection(): RecipientSelection {
  return { scope: 'ALL', personIds: [], mailingListIds: [], extraEmails: [] }
}

type Props = {
  workspaceId: string
  value: RecipientSelection
  onChange: (next: RecipientSelection) => void
}

/** Combina pessoas + várias listas + e-mails avulsos numa seleção só —
 * igual ao `RecipientPicker` original. */
export function CrmEmailCampaignRecipientPicker({
  workspaceId,
  value,
  onChange,
}: Props) {
  return (
    <Tabs defaultValue='contacts'>
      <TabsList variant='line' className='mb-2 w-full justify-start'>
        <TabsTrigger value='contacts'>Contatos</TabsTrigger>
        <TabsTrigger value='lists'>Listas</TabsTrigger>
        <TabsTrigger value='segments'>Segmentos</TabsTrigger>
        <TabsTrigger value='extra'>Avulsos</TabsTrigger>
      </TabsList>

      <TabsContent value='contacts'>
        <ContactsTab
          workspaceId={workspaceId}
          value={value}
          onChange={onChange}
        />
      </TabsContent>

      <TabsContent value='lists'>
        <MailingListsTab
          workspaceId={workspaceId}
          value={value}
          onChange={onChange}
        />
      </TabsContent>

      <TabsContent value='segments'>
        <SegmentsTab
          workspaceId={workspaceId}
          value={value}
          onChange={onChange}
        />
      </TabsContent>

      <TabsContent value='extra'>
        <ExtraEmailsTab
          workspaceId={workspaceId}
          value={value}
          onChange={onChange}
        />
      </TabsContent>
    </Tabs>
  )
}

function ContactsTab({ workspaceId, value, onChange }: Props) {
  const { items: people, isLoading } = useCrmResourceList<CrmPersonDTO>(
    workspaceId,
    'people',
  )
  const [search, setSearch] = useState('')
  const { isOptedOut } = useCrmEmailOptOuts(workspaceId)

  const peopleWithEmail = useMemo(
    () => people.filter((p) => p.emails.length > 0),
    [people],
  )
  // Opt-out LGPD: o servidor exclui na montagem da campanha; aqui só
  // refletimos para a contagem bater com o que será enviado.
  const optedOutIds = useMemo(
    () =>
      new Set(
        peopleWithEmail
          .filter((p) => isOptedOut(p.emails[0], p.id))
          .map((p) => p.id),
      ),
    [peopleWithEmail, isOptedOut],
  )
  const eligible = useMemo(
    () => peopleWithEmail.filter((p) => !optedOutIds.has(p.id)),
    [peopleWithEmail, optedOutIds],
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return peopleWithEmail
    return peopleWithEmail.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.emails.some((e) => e.toLowerCase().includes(q)),
    )
  }, [peopleWithEmail, search])

  const totalWithEmail = eligible.length
  const selectedIds = new Set(value.personIds)
  const isChecked = (id: string) =>
    optedOutIds.has(id)
      ? false
      : value.scope === 'ALL'
        ? true
        : selectedIds.has(id)
  const selectedCount =
    value.scope === 'ALL'
      ? totalWithEmail
      : value.personIds.filter((id) => !optedOutIds.has(id)).length
  const allMarked = value.scope === 'ALL' || selectedCount === totalWithEmail

  function toggle(id: string) {
    if (optedOutIds.has(id)) return
    if (value.scope === 'ALL') {
      const next = eligible.map((p) => p.id).filter((x) => x !== id)
      onChange({ ...value, scope: 'SELECTED', personIds: next })
      return
    }
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...value, scope: 'SELECTED', personIds: Array.from(next) })
  }

  function toggleAll() {
    if (allMarked) {
      onChange({ ...value, scope: 'SELECTED', personIds: [] })
    } else {
      onChange({ ...value, scope: 'ALL' })
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <div className='relative flex-1'>
          <SteelIcon
            icon={Search01Icon}
            strokeWidth={2}
            className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground'
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Buscar pessoa ou email…'
            className='pl-9'
          />
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={toggleAll}
          disabled={totalWithEmail === 0}
        >
          {allMarked ? 'Desmarcar todos' : 'Marcar todos'}
        </Button>
      </div>

      <div className='flex items-center justify-between text-muted-foreground text-xs'>
        <span>
          {selectedCount} de {totalWithEmail} selecionada(s)
          {optedOutIds.size > 0
            ? ` · ${optedOutIds.size} descadastrada(s) excluída(s)`
            : ''}
        </span>
        {value.scope === 'ALL' ? (
          <span>Inclui pessoas adicionadas depois</span>
        ) : null}
      </div>

      <div className='max-h-64 overflow-auto rounded-md border border-border'>
        {isLoading ? (
          <div className='p-4 text-muted-foreground text-sm'>Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className='p-4 text-muted-foreground text-sm'>
            Nenhuma pessoa com email encontrada.
          </div>
        ) : (
          <ul className='divide-y divide-border'>
            {filtered.map((p) => {
              const optedOut = optedOutIds.has(p.id)
              return (
                <li key={p.id}>
                  <label
                    className={
                      optedOut
                        ? 'flex cursor-not-allowed items-center gap-3 px-3 py-2 opacity-60'
                        : 'flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40'
                    }
                    title={
                      optedOut
                        ? 'Descadastrado das campanhas (LGPD) — não receberá'
                        : undefined
                    }
                  >
                    <input
                      type='checkbox'
                      className='size-4 accent-primary'
                      checked={isChecked(p.id)}
                      disabled={optedOut}
                      onChange={() => toggle(p.id)}
                    />
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-medium text-sm'>
                        {p.name}
                      </div>
                      <div className='truncate text-muted-foreground text-xs'>
                        {p.emails.join(', ')}
                      </div>
                    </div>
                    {optedOut ? (
                      <span className='shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600'>
                        Descadastrado
                      </span>
                    ) : null}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function MailingListsTab({ workspaceId, value, onChange }: Props) {
  const { items: lists, isLoading } = useCrmResourceList<CrmMailingListDTO>(
    workspaceId,
    'mailing-lists',
  )
  const selectedIds = new Set(value.mailingListIds)

  function toggle(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...value, mailingListIds: Array.from(next) })
  }

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-xs'>
        Os membros das listas selecionadas serão incluídos como destinatários.
      </p>

      <div className='max-h-64 overflow-auto rounded-md border border-border'>
        {isLoading ? (
          <div className='p-4 text-muted-foreground text-sm'>Carregando…</div>
        ) : lists.length === 0 ? (
          <div className='p-4 text-muted-foreground text-sm'>
            Nenhuma lista criada. Crie listas em Marketing → Listas.
          </div>
        ) : (
          <ul className='divide-y divide-border'>
            {lists.map((l) => (
              <li key={l.id}>
                <label className='flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40'>
                  <input
                    type='checkbox'
                    className='size-4 accent-primary'
                    checked={selectedIds.has(l.id)}
                    onChange={() => toggle(l.id)}
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate font-medium text-sm'>{l.name}</div>
                    <div className='truncate text-muted-foreground text-xs'>
                      {l.memberCount} membro(s)
                      {l.description ? ` · ${l.description}` : ''}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedIds.size > 0 ? (
        <p className='text-muted-foreground text-xs'>
          {selectedIds.size} lista(s) selecionada(s)
        </p>
      ) : null}
    </div>
  )
}

function SegmentsTab({ workspaceId, value, onChange }: Props) {
  const { data, isLoading } = useCrmSegments(workspaceId)
  const segments = (data ?? []).filter((segment) => segment.valid)
  const selectedIds = new Set(value.segmentIds ?? [])

  function toggle(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...value, scope: 'SELECTED', segmentIds: Array.from(next) })
  }

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-xs'>
        Os contatos de cada segmento são calculados agora, na criação do envio.
        Quem pediu descadastro nunca recebe.
      </p>

      <div className='max-h-64 overflow-auto rounded-md border border-border'>
        {isLoading ? (
          <div className='p-4 text-muted-foreground text-sm'>Carregando…</div>
        ) : segments.length === 0 ? (
          <div className='p-4 text-muted-foreground text-sm'>
            Nenhum segmento criado. Crie em Captar e qualificar → Segmentação.
          </div>
        ) : (
          <ul className='divide-y divide-border'>
            {segments.map((segment) => (
              <li key={segment.id}>
                <label className='flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40'>
                  <input
                    type='checkbox'
                    className='size-4 accent-primary'
                    checked={selectedIds.has(segment.id)}
                    onChange={() => toggle(segment.id)}
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate font-medium text-sm'>
                      {segment.name}
                    </div>
                    {segment.description ? (
                      <div className='truncate text-muted-foreground text-xs'>
                        {segment.description}
                      </div>
                    ) : null}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedIds.size > 0 ? (
        <p className='text-muted-foreground text-xs'>
          {selectedIds.size} segmento(s) selecionado(s)
        </p>
      ) : null}
    </div>
  )
}

function ExtraEmailsTab({ workspaceId, value, onChange }: Props) {
  const { isOptedOut } = useCrmEmailOptOuts(workspaceId)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  function addEmail() {
    const email = input.trim().toLowerCase()
    if (!email) return
    if (!EMAIL_RX.test(email)) {
      setError('Email inválido')
      return
    }
    if (value.extraEmails.includes(email)) {
      setError('Email já adicionado')
      return
    }
    onChange({ ...value, extraEmails: [...value.extraEmails, email] })
    setInput('')
    setError('')
  }

  function removeEmail(email: string) {
    onChange({
      ...value,
      extraEmails: value.extraEmails.filter((e) => e !== email),
    })
  }

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-xs'>
        Adicione emails que não estão cadastrados no CRM.
      </p>

      <div className='flex gap-2'>
        <div className='flex-1'>
          <Input
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addEmail()
              }
            }}
            placeholder='nome@empresa.com'
            type='email'
          />
          {error ? (
            <p className='mt-1 text-destructive text-xs'>{error}</p>
          ) : null}
        </div>
        <Button type='button' variant='outline' size='sm' onClick={addEmail}>
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Adicionar
        </Button>
      </div>

      {value.extraEmails.length > 0 ? (
        <div className='flex flex-wrap gap-1.5'>
          {value.extraEmails.map((email) => (
            <span
              key={email}
              className={
                isOptedOut(email)
                  ? 'inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-700 text-xs line-through'
                  : 'inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs'
              }
              title={
                isOptedOut(email)
                  ? 'Descadastrado das campanhas (LGPD) — não receberá'
                  : undefined
              }
            >
              {email}
              <button
                type='button'
                onClick={() => removeEmail(email)}
                className='text-muted-foreground hover:text-foreground'
                aria-label={`Remover ${email}`}
              >
                <SteelIcon
                  icon={Cancel01Icon}
                  strokeWidth={2}
                  className='size-3'
                />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className='text-muted-foreground text-xs'>
          Nenhum email avulso adicionado.
        </p>
      )}
    </div>
  )
}
