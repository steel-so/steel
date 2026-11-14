'use client'

import {
  Cancel01Icon,
  ChevronDownIcon,
  Delete02Icon,
  PlusSignIcon,
  Search01Icon,
  UserAdd01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useState } from 'react'
import {
  STAGE_LABELS,
  STAGE_STYLES,
} from '@/app/_components/crm/crm-lead-stage'
import { DataTable } from '@/app/_components/crm/table/data-table'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useAddCrmMailingListMember,
  useCreateCrmMailingList,
  useCrmEmailOptOuts,
  useDeleteCrmMailingList,
  useRemoveCrmMailingListMember,
} from '@/src/hooks/use-crm-email-marketing'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import { useCrmWorkspaceLookups } from '@/src/hooks/use-crm-workspace-lookups'
import { parsePastedEmails } from '@/src/lib/crm-email-paste'
import type {
  CrmMailingListDTO,
  CrmMailingListMemberDTO,
} from '@/types/crm-email-marketing'
import type { CrmLeadDTO } from '@/types/crm-lead'

const COLUMNS: GridColumn[] = [
  {
    key: 'name',
    header: 'Nome',
    kind: 'text',
    primary: true,
    readonly: true,
    placeholder: '—',
  },
  { key: 'memberCount', header: 'Membros', kind: 'number', readonly: true },
  {
    key: 'description',
    header: 'Descrição',
    kind: 'text',
    readonly: true,
    placeholder: '—',
  },
  { key: 'createdAt', header: 'Criada em', kind: 'readonly-date' },
]

export function CrmMailingListsTable({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const { items, isLoading, refetch } = useCrmResourceList<CrmMailingListDTO>(
    workspaceId,
    'mailing-lists',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, [])
  const columns = useMemo(() => COLUMNS, [])
  const [viewing, setViewing] = useState<string | 'new' | null>(null)

  return (
    <>
      <DataTable
        columns={columns}
        data={items}
        workspaceId={workspaceId}
        slug={slug}
        resource='mailing-lists'
        createTitle='lista'
        lookups={lookups}
        isLoading={isLoading}
        searchPlaceholder='Buscar listas…'
        refetch={refetch}
        disableInlineCreate
        headerAction={
          <Button
            size='sm'
            onClick={() => setViewing('new')}
            data-tour='mailing-lists-new'
          >
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Nova lista
          </Button>
        }
        onOpenRecord={(record) => setViewing(record.id)}
      />

      <MailingListSheet
        workspaceId={workspaceId}
        viewing={viewing}
        onClose={() => setViewing(null)}
        onSaved={() => {
          setViewing(null)
          refetch()
        }}
        onDeleted={() => {
          setViewing(null)
          refetch()
        }}
      />
    </>
  )
}

function MailingListSheet({
  workspaceId,
  viewing,
  onClose,
  onSaved,
  onDeleted,
}: {
  workspaceId: string
  viewing: string | 'new' | null
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const open = viewing !== null
  const isNew = viewing === 'new'

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent
        side='right'
        showCloseButton={false}
        className='flex w-[560px] max-w-[560px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px] data-[side=right]:sm:max-w-[560px]'
      >
        {!open ? null : isNew ? (
          <CreateListPanel
            workspaceId={workspaceId}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : (
          <ListDetailPanel
            workspaceId={workspaceId}
            id={viewing as string}
            onClose={onClose}
            onDeleted={onDeleted}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function PanelHeader({
  onClose,
  title,
}: {
  onClose: () => void
  title: React.ReactNode
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
    </div>
  )
}

function CreateListPanel({
  workspaceId,
  onClose,
  onSaved,
}: {
  workspaceId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const createList = useCreateCrmMailingList(workspaceId)

  async function onSubmit() {
    if (!name.trim()) {
      notify.error('Informe o nome da lista')
      return
    }
    try {
      await createList.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      notify.success('Lista criada')
      onSaved()
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <>
      <PanelHeader onClose={onClose} title='Nova lista de mailing' />
      <div className='min-h-0 flex-1 overflow-y-auto p-4'>
        <div className='flex flex-col gap-4'>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Ex: Clientes VIP'
            />
          </div>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>
              Descrição (opcional)
            </Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='Descrição da lista…'
              rows={2}
            />
          </div>
        </div>
      </div>
      <div className='flex shrink-0 items-center justify-end gap-2 border-t p-3'>
        <Button
          variant='ghost'
          onClick={onClose}
          disabled={createList.isPending}
        >
          Cancelar
        </Button>
        <Button onClick={onSubmit} disabled={createList.isPending}>
          {createList.isPending ? 'Criando…' : 'Criar lista'}
        </Button>
      </div>
    </>
  )
}

/** Dropdown com checkbox para adicionar membros a uma lista — só a partir de
 * leads existentes (nome, email, status), nunca por digitação livre. */
function LeadPickerDropdown({
  workspaceId,
  existingEmails,
  onAdd,
  isAdding,
}: {
  workspaceId: string
  existingEmails: Set<string>
  onAdd: (leads: { email: string; name?: string }[]) => Promise<void>
  isAdding: boolean
}) {
  const { items: leads, isLoading } = useCrmResourceList<CrmLeadDTO>(
    workspaceId,
    'leads',
  )
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const eligible = useMemo(
    () =>
      leads.filter(
        (l) =>
          l.emails.length > 0 && !existingEmails.has(l.emails[0].toLowerCase()),
      ),
    [leads, existingEmails],
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return eligible
    return eligible.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.emails.some((e) => e.toLowerCase().includes(q)),
    )
  }, [eligible, search])

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAdd() {
    const chosen = eligible.filter((l) => selected.has(l.id))
    await onAdd(chosen.map((l) => ({ email: l.emails[0], name: l.name })))
    setSelected(new Set())
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='w-full justify-between'
          >
            <span className='flex items-center gap-1.5'>
              <SteelIcon icon={UserAdd01Icon} strokeWidth={2} />
              Adicionar leads
            </span>
            <SteelIcon
              icon={ChevronDownIcon}
              strokeWidth={2}
              className='size-3.5'
            />
          </Button>
        }
      />
      <PopoverContent className='w-96 p-3' align='start'>
        <div className='flex flex-col gap-2.5'>
          <div className='relative'>
            <SteelIcon
              icon={Search01Icon}
              strokeWidth={2}
              className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground'
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Buscar lead por nome ou email…'
              className='pl-9'
            />
          </div>

          <div className='max-h-72 overflow-auto rounded-md border border-border'>
            {isLoading ? (
              <div className='p-4 text-muted-foreground text-sm'>
                Carregando…
              </div>
            ) : filtered.length === 0 ? (
              <div className='p-4 text-muted-foreground text-sm'>
                Nenhum lead disponível.
              </div>
            ) : (
              <ul className='divide-y divide-border'>
                {filtered.map((l) => (
                  <li key={l.id}>
                    <label className='flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40'>
                      <input
                        type='checkbox'
                        className='size-4 shrink-0 accent-primary'
                        checked={selected.has(l.id)}
                        onChange={() => toggle(l.id)}
                      />
                      <span className='w-28 shrink-0 truncate font-medium text-sm'>
                        {l.name}
                      </span>
                      <span className='min-w-0 flex-1 truncate text-muted-foreground text-xs'>
                        {l.emails[0]}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 font-medium text-[10px]',
                          STAGE_STYLES[l.stage],
                        )}
                      >
                        {STAGE_LABELS[l.stage]}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-xs'>
              {selected.size} selecionado(s)
            </span>
            <Button
              type='button'
              size='sm'
              disabled={selected.size === 0 || isAdding}
              onClick={handleAdd}
            >
              {isAdding ? 'Adicionando…' : 'Adicionar'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Paste e-mails (or pick a CSV) to add many members at once. */
function PasteEmailsBox({
  existingEmails,
  onAdd,
  isAdding,
}: {
  existingEmails: Set<string>
  onAdd: (members: { email: string; name?: string }[]) => Promise<void>
  isAdding: boolean
}) {
  const [text, setText] = useState('')
  const parsed = useMemo(
    () => parsePastedEmails(text, existingEmails),
    [text, existingEmails],
  )

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      const content = await file.text()
      setText((cur) => (cur ? `${cur}\n${content}` : content))
    } catch (err) {
      notify.error(err, 'Não foi possível ler o arquivo. Tente outro CSV.')
    }
  }

  async function handleAdd() {
    await onAdd(parsed.members)
    setText('')
  }

  return (
    <div className='grid gap-1.5 rounded-lg border border-border p-3'>
      <Label className='text-muted-foreground text-xs'>
        Colar e-mails ou importar CSV
      </Label>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'maria@empresa.com\njoao@empresa.com, ana@empresa.com'}
        rows={3}
      />
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <label className='cursor-pointer text-primary text-xs underline-offset-2 hover:underline'>
          Escolher arquivo CSV
          <input
            type='file'
            accept='.csv,text/csv,text/plain'
            className='sr-only'
            onChange={(e) => {
              handleFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <Button
          type='button'
          size='sm'
          disabled={parsed.members.length === 0 || isAdding}
          onClick={handleAdd}
        >
          {isAdding
            ? 'Adicionando…'
            : parsed.members.length > 0
              ? `Adicionar ${parsed.members.length} e-mail(s)`
              : 'Adicionar e-mails'}
        </Button>
      </div>
      {text.trim() ? (
        <p className='text-muted-foreground text-xs'>
          {parsed.members.length} válido(s)
          {parsed.duplicates.length > 0
            ? ` · ${parsed.duplicates.length} já na lista ou repetido(s)`
            : ''}
          {parsed.invalid.length > 0
            ? ` · ${parsed.invalid.length} ignorado(s) por não parecer(em) e-mail`
            : ''}
        </p>
      ) : null}
    </div>
  )
}

function ListDetailPanel({
  workspaceId,
  id,
  onClose,
  onDeleted,
}: {
  workspaceId: string
  id: string
  onClose: () => void
  onDeleted: () => void
}) {
  const { items: lists } = useCrmResourceList<CrmMailingListDTO>(
    workspaceId,
    'mailing-lists',
  )
  const list = lists.find((l) => l.id === id)
  const {
    items: members,
    isLoading,
    refetch,
  } = useCrmResourceList<CrmMailingListMemberDTO>(
    workspaceId,
    `mailing-lists/${id}/members`,
  )

  const { isOptedOut } = useCrmEmailOptOuts(workspaceId)
  const optedOutCount = members.filter((m) =>
    isOptedOut(m.email, m.personId),
  ).length
  const addMember = useAddCrmMailingListMember(workspaceId, id)
  const removeMember = useRemoveCrmMailingListMember(workspaceId, id)
  const deleteList = useDeleteCrmMailingList(workspaceId)

  async function handleRemoveMember(memberId: string) {
    try {
      await removeMember.mutateAsync(memberId)
      refetch()
    } catch (err) {
      notify.error(err)
    }
  }

  const existingEmails = useMemo(
    () => new Set(members.map((m) => m.email.toLowerCase())),
    [members],
  )

  /** Adds one by one and reports what worked, so a failure never hides the rest. */
  async function addMembers(
    toAdd: { email: string; name?: string }[],
  ): Promise<void> {
    let added = 0
    const failed: string[] = []
    let firstError: unknown
    for (const member of toAdd) {
      try {
        await addMember.mutateAsync(member)
        added += 1
      } catch (err) {
        failed.push(member.email)
        firstError ??= err
      }
    }
    refetch()
    if (added > 0) {
      notify.success(
        added === 1 ? '1 membro adicionado' : `${added} membros adicionados`,
      )
    }
    if (failed.length > 0) {
      notify.error(
        firstError,
        `${failed.length} e-mail(s) não puderam ser adicionados: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`,
      )
    }
  }

  async function handleDeleteList() {
    try {
      await deleteList.mutateAsync(id)
      notify.success('Lista removida')
      onDeleted()
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <>
      <PanelHeader onClose={onClose} title={list?.name ?? 'Lista'} />

      <div className='min-h-0 flex-1 overflow-y-auto p-4'>
        <div className='flex flex-col gap-5'>
          {list?.description ? (
            <p className='text-muted-foreground text-sm'>{list.description}</p>
          ) : null}

          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>
              Adicionar membros
            </Label>
            <LeadPickerDropdown
              workspaceId={workspaceId}
              existingEmails={existingEmails}
              isAdding={addMember.isPending}
              onAdd={addMembers}
            />
            <PasteEmailsBox
              existingEmails={existingEmails}
              isAdding={addMember.isPending}
              onAdd={addMembers}
            />
          </div>

          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>
              Membros ({members.length})
              {optedOutCount > 0
                ? ` · ${optedOutCount} descadastrado(s), não recebem campanhas`
                : ''}
            </Label>
            {isLoading ? null : members.length === 0 ? (
              <div className='rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-xs'>
                Esta lista ainda não tem membros. Escolha leads existentes, cole
                e-mails ou importe um arquivo CSV acima.
              </div>
            ) : (
              <ul className='max-h-96 divide-y divide-border overflow-auto rounded-lg border border-border'>
                {members.map((m) => (
                  <li key={m.id} className='flex items-center gap-3 px-3 py-2'>
                    <div className='min-w-0 flex-1'>
                      {m.name ? (
                        <div className='truncate font-medium text-sm'>
                          {m.name}
                        </div>
                      ) : null}
                      <div className='truncate text-muted-foreground text-xs'>
                        {m.email}
                      </div>
                    </div>
                    {isOptedOut(m.email, m.personId) ? (
                      <span
                        className='shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600'
                        title='Descadastrado das campanhas (LGPD) — não receberá'
                      >
                        Descadastrado
                      </span>
                    ) : null}
                    <ConfirmAction
                      trigger={
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          aria-label={`Remover ${m.email} da lista`}
                          className='shrink-0 text-muted-foreground hover:text-destructive'
                        >
                          <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
                        </Button>
                      }
                      title='Remover da lista?'
                      description={`${m.email} deixa de receber as campanhas enviadas para esta lista. O contato continua no CRM.`}
                      confirmLabel='Remover'
                      onConfirm={() => handleRemoveMember(m.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className='flex shrink-0 items-center justify-between gap-2 border-t p-3'>
        <ConfirmAction
          trigger={
            <Button
              variant='ghost'
              size='sm'
              disabled={deleteList.isPending}
              className='text-muted-foreground hover:text-destructive'
            >
              <SteelIcon
                icon={Delete02Icon}
                strokeWidth={2}
                className='mr-1.5 size-4'
              />
              {deleteList.isPending ? 'Removendo…' : 'Remover lista'}
            </Button>
          }
          title={`Remover a lista "${list?.name ?? ''}"?`}
          description={
            members.length > 0
              ? `Os ${members.length} membros da lista deixam de fazer parte dela. Os leads e pessoas continuam no CRM. Não dá para desfazer.`
              : 'A lista está vazia. Não dá para desfazer.'
          }
          confirmLabel='Remover lista'
          pending={deleteList.isPending}
          onConfirm={handleDeleteList}
        />
        <Button variant='ghost' onClick={onClose}>
          Fechar
        </Button>
      </div>
    </>
  )
}
