'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { AiInput, AiTextarea } from '@/components/ui/ai-text-field'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'

export type ListItem = { title: string; description: string }

/** Editor genérico de lista título+descrição (usado por Necessidade e Escopo). */
export function ListItemsEditor({
  items,
  onChange,
  addLabel,
  itemPlaceholder,
}: {
  items: ListItem[]
  onChange: (items: ListItem[]) => void
  addLabel: string
  itemPlaceholder: string
}) {
  function update(index: number, patch: Partial<ListItem>) {
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    )
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index))
  }

  function add() {
    onChange([...items, { title: itemPlaceholder, description: '' }])
  }

  return (
    <div className='flex flex-col gap-3'>
      {items.map((item, index) => (
        <div key={index} className='flex flex-col gap-2 rounded-md border p-3'>
          <div className='flex items-center gap-2'>
            <AiInput
              aiLabel='Título do item'
              value={item.title}
              onChange={(e) => update(index, { title: e.target.value })}
              placeholder={itemPlaceholder}
              className='flex-1'
            />
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label='Remover item'
              // A API exige ao menos um item: não deixa remover o último.
              disabled={items.length <= 1}
              onClick={() => remove(index)}
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
          {item.title === '' ? (
            <FieldError>Título do item é obrigatório</FieldError>
          ) : null}
          <AiTextarea
            aiLabel='Descrição do item'
            value={item.description}
            onChange={(e) => update(index, { description: e.target.value })}
            placeholder='Descrição (opcional)'
            rows={2}
          />
        </div>
      ))}
      <Button type='button' variant='outline' size='sm' onClick={add}>
        <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
        {addLabel}
      </Button>
    </div>
  )
}
