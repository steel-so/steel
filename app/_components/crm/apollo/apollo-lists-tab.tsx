'use client'

import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import {
  useCreateCrmApolloImport,
  useCrmApolloListContacts,
  useCrmApolloLists,
} from '@/src/hooks/use-crm-apollo'
import type { CrmApolloContactDTO } from '@/types/crm-apollo'
import { ApolloImportFooter } from './apollo-import-footer'
import { ApolloPager } from './apollo-pager'

const PER_PAGE = 25

/** "Minhas listas da Apollo": contacts already saved there (0 credits). */
export function ApolloListsTab({
  workspaceId,
  defaultMailingListId,
  phoneRevealAvailable,
  onImported,
}: {
  workspaceId: string
  defaultMailingListId: string | null
  phoneRevealAvailable: boolean
  onImported: () => void
}) {
  const lists = useCrmApolloLists(workspaceId, true)
  const [labelId, setLabelId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  // Picked contacts keep their data: the import carries them (they already
  // include the e-mail, so nothing is enriched).
  const [selected, setSelected] = useState<Map<string, CrmApolloContactDTO>>(
    new Map(),
  )
  const [mailingListId, setMailingListId] = useState<string | null>(
    defaultMailingListId,
  )
  const contacts = useCrmApolloListContacts(
    workspaceId,
    labelId,
    page,
    PER_PAGE,
  )
  const [revealPhones, setRevealPhones] = useState(false)
  const createImport = useCreateCrmApolloImport(workspaceId)

  if (lists.isLoading) {
    return <p className='text-muted-foreground text-sm'>Carregando listas…</p>
  }
  if (lists.error) {
    return (
      <p role='alert' className='rounded-lg border border-dashed p-4 text-sm'>
        {isApiErrorCode(lists.error, 'CRM_APOLLO_FORBIDDEN')
          ? 'A chave cadastrada não tem permissão para listas. Use uma chave master da Apollo em Ajustes > Integrações.'
          : lists.error.message}
      </p>
    )
  }

  const options = (lists.data ?? []).map((list) => ({
    value: list.id,
    label: `${list.name} (${list.count.toLocaleString('pt-BR')})`,
  }))
  const rows = contacts.data?.contacts ?? []
  const importable = (contact: CrmApolloContactDTO) => !!contact.email

  function toggle(contact: CrmApolloContactDTO, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current)
      if (checked) next.set(contact.id, contact)
      else next.delete(contact.id)
      return next
    })
  }

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const next = new Map(current)
      for (const contact of rows.filter(importable)) {
        if (checked) next.set(contact.id, contact)
        else next.delete(contact.id)
      }
      return next
    })
  }

  function startImport() {
    if (!labelId) return
    const label = options.find((option) => option.value === labelId)?.label
    createImport.mutate(
      {
        source: 'LIST',
        labelId,
        labelName: label,
        contacts: [...selected.values()].map((contact) => ({
          id: contact.id,
          name: contact.name,
          email: contact.email,
          emailStatus: contact.emailStatus,
          title: contact.title,
          organizationName: contact.organizationName,
          linkedinUrl: contact.linkedinUrl,
          city: contact.city,
        })),
        mailingListId,
        revealPhones: phoneRevealAvailable && revealPhones,
      },
      {
        onSuccess: () => {
          notify.success('Importação iniciada. Acompanhe no histórico.')
          setSelected(new Map())
          onImported()
        },
        onError: (error) => notify.error(error.message),
      },
    )
  }

  if (options.length === 0) {
    return (
      <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
        Sua conta da Apollo ainda não tem listas salvas.
      </p>
    )
  }

  const pageSelected =
    rows.filter(importable).length > 0 &&
    rows.filter(importable).every((contact) => selected.has(contact.id))

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='w-full max-w-md'>
        <Select
          items={options}
          value={labelId}
          onValueChange={(next) => {
            setLabelId(next == null ? null : String(next))
            setPage(1)
            setSelected(new Map())
          }}
        >
          <SelectTrigger
            className='w-full min-w-0'
            aria-label='Lista da Apollo'
          >
            <SelectValue placeholder='Escolha uma lista da Apollo' />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {labelId && contacts.isLoading ? (
        <p className='text-muted-foreground text-sm'>Carregando contatos…</p>
      ) : null}
      {labelId && contacts.error ? (
        <p role='alert' className='text-destructive text-sm'>
          {contacts.error.message}
        </p>
      ) : null}

      {labelId && contacts.data ? (
        rows.length === 0 ? (
          <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
            Esta lista está vazia.
          </p>
        ) : (
          <>
            <ApolloPager
              page={contacts.data.page}
              totalPages={contacts.data.totalPages}
              totalEntries={contacts.data.totalEntries}
              disabled={contacts.isFetching}
              onPage={setPage}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-10'>
                    <Checkbox
                      aria-label='Selecionar esta página'
                      checked={pageSelected}
                      onCheckedChange={(checked) => togglePage(!!checked)}
                    />
                  </TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>E-mail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Selecionar ${contact.name}`}
                        disabled={!importable(contact)}
                        checked={selected.has(contact.id)}
                        onCheckedChange={(checked) =>
                          toggle(contact, !!checked)
                        }
                      />
                    </TableCell>
                    <TableCell className='font-medium'>
                      {contact.name}
                    </TableCell>
                    <TableCell className='max-w-64 truncate'>
                      {contact.title ?? '—'}
                    </TableCell>
                    <TableCell className='max-w-56 truncate'>
                      {contact.organizationName ?? '—'}
                    </TableCell>
                    <TableCell className='max-w-64 truncate text-muted-foreground'>
                      {contact.email ?? 'Sem e-mail'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )
      ) : null}

      {selected.size > 0 ? (
        <ApolloImportFooter
          workspaceId={workspaceId}
          count={selected.size}
          creditsPerPerson={0}
          revealPhones={revealPhones}
          onRevealPhonesChange={setRevealPhones}
          phoneRevealAvailable={phoneRevealAvailable}
          mailingListId={mailingListId}
          onMailingListChange={setMailingListId}
          pending={createImport.isPending}
          onImport={startImport}
          onClear={() => setSelected(new Map())}
        />
      ) : null}
    </div>
  )
}
