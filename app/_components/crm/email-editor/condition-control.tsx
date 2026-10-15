'use client'

import { Cancel01Icon, FilterIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import {
  defaultEmailCondition,
  describeEmailCondition,
  EMAIL_CONDITION_FIELD_LABELS,
  EMAIL_CONDITION_FIELDS,
  EMAIL_FIELD_OPERATOR_LABELS,
  EMAIL_FIELD_OPERATORS,
  EMAIL_LIST_OPERATOR_LABELS,
  EMAIL_LIST_OPERATORS,
  type EmailCondition,
  emailConditionSchema,
  operatorTakesValue,
} from '@/src/lib/canvas-email/conditions'
import type { CrmMailingListDTO } from '@/types/crm-email-marketing'
import { useEmailEditorData } from './editor-data'
import { OptionSelect } from './option-select'

const KIND_OPTIONS = [
  { value: 'field', label: 'Dado do contato' },
  { value: 'list', label: 'Lista de e-mail' },
]
const FIELD_OPTIONS = EMAIL_CONDITION_FIELDS.map((field) => ({
  value: field,
  label: EMAIL_CONDITION_FIELD_LABELS[field],
}))
const FIELD_OP_OPTIONS = EMAIL_FIELD_OPERATORS.map((op) => ({
  value: op,
  label: EMAIL_FIELD_OPERATOR_LABELS[op],
}))
const LIST_OP_OPTIONS = EMAIL_LIST_OPERATORS.map((op) => ({
  value: op,
  label: EMAIL_LIST_OPERATOR_LABELS[op],
}))

/** Mailing-list picker (loads the lists only when a list condition shows). */
function ListPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (listId: string) => void
}) {
  const { workspaceId } = useEmailEditorData()
  const { items, isLoading } = useCrmResourceList<CrmMailingListDTO>(
    workspaceId,
    'mailing-lists',
  )
  if (!isLoading && items.length === 0) {
    return (
      <p className='rounded-md border border-dashed px-2.5 py-2 text-[11px] text-muted-foreground'>
        Nenhuma lista de e-mail no CRM. Crie uma em Marketing › Listas.
      </p>
    )
  }
  return (
    <OptionSelect
      label='Lista de e-mail'
      value={value || null}
      placeholder={isLoading ? 'Carregando listas…' : 'Escolha a lista'}
      options={items.map((list) => ({ value: list.id, label: list.name }))}
      onChange={onChange}
    />
  )
}

/**
 * "Mostrar se" of a section or block (E3): shown only to recipients whose
 * contact data or mailing lists match. Evaluated per recipient on send,
 * test and campaign; the canvas marks the node with a badge.
 */
export function ConditionControl({ value, onChange }: CustomControlProps) {
  const parsed = emailConditionSchema.safeParse(value)
  const condition = parsed.success ? parsed.data : null

  if (!condition) {
    return (
      <div className='flex flex-col gap-2'>
        <p className='text-[11px] text-muted-foreground'>
          Todos os destinatários veem este elemento.
        </p>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='w-full justify-start'
          onClick={() => onChange(defaultEmailCondition())}
          data-testid='condition-add'
        >
          <SteelIcon icon={FilterIcon} strokeWidth={2} />
          Adicionar condição
        </Button>
      </div>
    )
  }

  const set = (next: EmailCondition) => onChange(next)

  return (
    <div className='flex flex-col gap-2' data-testid='condition-editor'>
      <OptionSelect
        label='Tipo de condição'
        value={condition.kind}
        options={KIND_OPTIONS}
        onChange={(kind) =>
          set(
            kind === 'list'
              ? { kind: 'list', op: 'in', listId: '' }
              : defaultEmailCondition(),
          )
        }
      />
      {condition.kind === 'field' ? (
        <>
          <div className='grid grid-cols-2 gap-2'>
            <OptionSelect
              label='Dado do contato'
              value={condition.field}
              options={FIELD_OPTIONS}
              onChange={(field) =>
                set({ ...condition, field: field as typeof condition.field })
              }
            />
            <OptionSelect
              label='Comparação'
              value={condition.op}
              options={FIELD_OP_OPTIONS}
              onChange={(op) =>
                set({ ...condition, op: op as typeof condition.op })
              }
            />
          </div>
          {operatorTakesValue(condition.op) ? (
            <Input
              aria-label='Valor da condição'
              value={condition.value}
              maxLength={200}
              placeholder='Ex.: Campinas'
              className='h-8 text-xs'
              onChange={(event) =>
                set({ ...condition, value: event.target.value })
              }
            />
          ) : null}
        </>
      ) : (
        <>
          <OptionSelect
            label='Comparação'
            value={condition.op}
            options={LIST_OP_OPTIONS}
            onChange={(op) =>
              set({ ...condition, op: op as typeof condition.op })
            }
          />
          <ListPicker
            value={condition.listId}
            onChange={(listId) => set({ ...condition, listId })}
          />
        </>
      )}
      <div className='flex items-start justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-2'>
        <p className='min-w-0 text-[11px] text-muted-foreground'>
          <span className='font-medium text-foreground'>Mostrar se </span>
          {describeEmailCondition(condition).replace(/^./, (c) =>
            c.toLowerCase(),
          )}
        </p>
        <button
          type='button'
          onClick={() => onChange(undefined)}
          className='-m-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
          aria-label='Remover condição'
          title='Remover condição'
        >
          <SteelIcon icon={Cancel01Icon} className='size-3.5' />
        </button>
      </div>
    </div>
  )
}
