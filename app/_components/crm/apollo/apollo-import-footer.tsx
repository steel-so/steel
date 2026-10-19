'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCrmApolloMailingLists } from '@/src/hooks/use-crm-apollo'
import { MAX_IMPORT, pluralize, WHATSAPP_NOTE } from './apollo-labels'

const NO_LIST = '__none__'

/** Selection summary, destination list and the "Importar" action. */
export function ApolloImportFooter({
  workspaceId,
  count,
  creditsPerPerson,
  mailingListId,
  onMailingListChange,
  pending,
  onImport,
  onClear,
}: {
  workspaceId: string
  count: number
  /** 1 for searches (enrichment), 0 for saved Apollo lists. */
  creditsPerPerson: 0 | 1
  mailingListId: string | null
  onMailingListChange: (id: string | null) => void
  pending: boolean
  onImport: () => void
  onClear: () => void
}) {
  const lists = useCrmApolloMailingLists(workspaceId)
  const options = [
    { value: NO_LIST, label: 'Não adicionar a nenhuma lista' },
    ...(lists.data ?? []).map((list) => ({ value: list.id, label: list.name })),
  ]
  const credits = count * creditsPerPerson

  return (
    <div className='sticky bottom-0 z-10 flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-3 shadow-sm'>
      <div className='flex min-w-0 flex-wrap items-center justify-between gap-3'>
        <p className='min-w-0 text-sm' aria-live='polite'>
          <strong>{pluralize(count, 'selecionado', 'selecionados')}</strong>
          {' · '}
          {credits === 0
            ? 'sem custo de créditos'
            : `até ${pluralize(credits, 'crédito', 'créditos')} da Apollo`}
          {count > MAX_IMPORT ? (
            <span className='text-destructive'>
              {' '}
              (máximo de {MAX_IMPORT.toLocaleString('pt-BR')} por importação)
            </span>
          ) : null}
        </p>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <div className='w-56 min-w-0 max-w-full'>
            <Select
              items={options}
              value={mailingListId ?? NO_LIST}
              onValueChange={(next) =>
                onMailingListChange(
                  next == null || next === NO_LIST ? null : String(next),
                )
              }
            >
              <SelectTrigger
                size='sm'
                className='w-full min-w-0'
                aria-label='Lista de e-mail de destino'
              >
                <SelectValue placeholder='Lista de destino' />
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
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={count === 0 || pending}
            onClick={onClear}
          >
            Limpar seleção
          </Button>
          <Button
            type='button'
            size='sm'
            disabled={count === 0 || count > MAX_IMPORT || pending}
            onClick={onImport}
          >
            <SteelIcon icon={Download01Icon} strokeWidth={2} />
            {pending ? 'Enviando…' : 'Importar'}
          </Button>
        </div>
      </div>
      <p className='text-muted-foreground text-xs'>{WHATSAPP_NOTE}</p>
    </div>
  )
}
