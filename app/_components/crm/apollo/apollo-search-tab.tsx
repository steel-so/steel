'use client'

import { Search01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import {
  useCreateCrmApolloImport,
  useCrmApolloSearch,
} from '@/src/hooks/use-crm-apollo'
import {
  type ApolloSearchFiltersDTO,
  hasApolloFilters,
} from '@/src/schemas/crm-apollo.schema'
import type { CrmApolloSearchResultDTO } from '@/types/crm-apollo'
import { ApolloFiltersForm } from './apollo-filters-form'
import { ApolloImportFooter } from './apollo-import-footer'
import { EMPTY_FILTERS, MAX_IMPORT, pluralize } from './apollo-labels'
import { ApolloPager } from './apollo-pager'

const PER_PAGE = 25
const BULK_PER_PAGE = 100

/** "Buscar na Apollo": filters → preview (0 credits) → select → import. */
const PHONE_LABEL = {
  YES: 'Sim',
  MAYBE: 'Talvez',
  NO: 'Não',
} as const

export function ApolloSearchTab({
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
  const [filters, setFilters] = useState<ApolloSearchFiltersDTO>(EMPTY_FILTERS)
  // Filters of the search that produced `result` (editing the form does not
  // change what an import will record until "Buscar" is pressed again).
  const [applied, setApplied] = useState<ApolloSearchFiltersDTO | null>(null)
  const [result, setResult] = useState<CrmApolloSearchResultDTO | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mailingListId, setMailingListId] = useState<string | null>(
    defaultMailingListId,
  )
  const [selectingAll, setSelectingAll] = useState(false)
  const search = useCrmApolloSearch(workspaceId)
  const [revealPhones, setRevealPhones] = useState(false)
  // People seen in results without an e-mail: they cost a credit and only
  // become leads when a phone is revealed, so they start unselected.
  const [noEmailIds, setNoEmailIds] = useState<Set<string>>(new Set())
  const createImport = useCreateCrmApolloImport(workspaceId)

  function rememberNoEmail(list: CrmApolloSearchResultDTO['people']) {
    setNoEmailIds((current) => {
      const next = new Set(current)
      for (const person of list) if (!person.hasEmail) next.add(person.id)
      return next
    })
  }

  function changeRevealPhones(value: boolean) {
    setRevealPhones(value)
    // Without phones, a person with no e-mail is only wasted credit.
    if (!value) {
      setSelected(
        (current) => new Set([...current].filter((id) => !noEmailIds.has(id))),
      )
    }
  }

  function run(
    next: ApolloSearchFiltersDTO,
    page: number,
    resetSelection: boolean,
  ) {
    search.mutate(
      { filters: next, page, perPage: PER_PAGE },
      {
        onSuccess: (data) => {
          rememberNoEmail(data.people)
          setResult(data)
          setApplied(next)
          if (resetSelection) setSelected(new Set())
        },
        onError: (error) => notify.error(error.message),
      },
    )
  }

  async function selectAllResults() {
    if (!applied || !result) return
    setSelectingAll(true)
    try {
      const ids = new Set<string>()
      const wanted = Math.min(result.totalEntries, MAX_IMPORT)
      for (let page = 1; ids.size < wanted; page += 1) {
        const data = await search.mutateAsync({
          filters: applied,
          page,
          perPage: BULK_PER_PAGE,
        })
        rememberNoEmail(data.people)
        for (const person of data.people) {
          if (person.hasEmail || revealPhones) ids.add(person.id)
        }
        if (page >= data.totalPages || data.people.length === 0) break
      }
      setSelected(new Set([...ids].slice(0, MAX_IMPORT)))
      notify.success(
        `${pluralize(ids.size, 'pessoa selecionada', 'pessoas selecionadas')}`,
      )
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Erro ao selecionar',
      )
    } finally {
      setSelectingAll(false)
    }
  }

  const people = result?.people ?? []
  const selectable = people.filter((person) => person.hasEmail || revealPhones)
  const pageSelected =
    selectable.length > 0 &&
    selectable.every((person) => selected.has(person.id))

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const person of people) {
        if (checked && (person.hasEmail || revealPhones)) next.add(person.id)
        else next.delete(person.id)
      }
      return next
    })
  }

  function togglePerson(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function startImport() {
    if (!applied) return
    createImport.mutate(
      {
        source: 'SEARCH',
        filters: applied,
        apolloIds: [...selected],
        mailingListId,
        revealPhones: phoneRevealAvailable && revealPhones,
      },
      {
        onSuccess: () => {
          notify.success('Importação iniciada. Acompanhe no histórico.')
          setSelected(new Set())
          onImported()
        },
        onError: (error) => notify.error(error.message),
      },
    )
  }

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <ApolloFiltersForm value={filters} onChange={setFilters} />
      <div className='flex flex-wrap items-center gap-3'>
        <Button
          type='button'
          disabled={search.isPending || !hasApolloFilters(filters)}
          onClick={() => run(filters, 1, true)}
        >
          <SteelIcon icon={Search01Icon} strokeWidth={2} />
          {search.isPending ? 'Buscando…' : 'Buscar'}
        </Button>
        <p className='text-muted-foreground text-xs'>
          A busca não gasta créditos. Só a importação consome (cerca de 1 por
          pessoa, mesmo quando a Apollo não encontra o e-mail). Quem está sem
          e-mail fica desmarcado, a menos que você revele telefones.
        </p>
      </div>

      {result ? (
        <div className='flex min-w-0 flex-col gap-3'>
          {people.length === 0 ? (
            <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
              Nenhuma pessoa encontrada com esses filtros. Tente ampliar a
              busca.
            </p>
          ) : (
            <>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <ApolloPager
                  page={result.page}
                  totalPages={result.totalPages}
                  totalEntries={result.totalEntries}
                  disabled={search.isPending || selectingAll}
                  onPage={(page) => applied && run(applied, page, false)}
                />
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={selectingAll || search.isPending}
                  onClick={selectAllResults}
                >
                  {selectingAll
                    ? 'Selecionando…'
                    : `Selecionar todos os resultados (até ${MAX_IMPORT.toLocaleString('pt-BR')})`}
                </Button>
              </div>
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
                    <TableHead>Telefone</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Selecionar ${person.name}`}
                          checked={selected.has(person.id)}
                          onCheckedChange={(checked) =>
                            togglePerson(person.id, !!checked)
                          }
                        />
                      </TableCell>
                      <TableCell className='font-medium'>
                        {person.name}
                        {person.hasEmail ? null : (
                          <Badge variant='outline' className='ml-2'>
                            sem e-mail
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className='max-w-64 truncate'>
                        {person.title ?? '—'}
                      </TableCell>
                      <TableCell className='max-w-56 truncate'>
                        {person.organizationName ?? '—'}
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {person.hasEmail ? 'Sim' : 'Não'}
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {PHONE_LABEL[person.directPhone]}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <ApolloImportFooter
          workspaceId={workspaceId}
          count={selected.size}
          creditsPerPerson={1}
          revealPhones={revealPhones}
          onRevealPhonesChange={changeRevealPhones}
          phoneRevealAvailable={phoneRevealAvailable}
          mailingListId={mailingListId}
          onMailingListChange={setMailingListId}
          pending={createImport.isPending}
          onImport={startImport}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
    </div>
  )
}
