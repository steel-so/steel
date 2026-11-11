'use client'

import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { createId } from '@paralleldrive/cuid2'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  inputClass,
  NumberInput,
} from '@/app/_components/canvas/inspector/controls/primitives'
import { SteelIcon } from '@/components/icon/icon'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import type { DocumentPricingItem } from './context'
import { formatBRL } from './format'
import { pricingLineTotal } from './pricing'

/**
 * Inspector controls of the `document` catalog that the generic controls
 * cannot express: options one per line, a table typed as text and the
 * pricing items (ids, money, recurrence, what the reader may change).
 */

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** Local text that follows external changes (undo, AI) but keeps what the
 * user is typing (blank lines, a trailing separator). */
function useSyncedText(external: string) {
  const [text, setText] = useState(external)
  const sent = useRef(external)
  useEffect(() => {
    if (external !== sent.current) {
      sent.current = external
      setText(external)
    }
  }, [external])
  const update = (raw: string, normalized: string) => {
    sent.current = normalized
    setText(raw)
  }
  return [text, update] as const
}

/** `string[]` edited as one item per line (select options). */
export function LinesControl({ value, onChange }: CustomControlProps) {
  const external = strings(value).join('\n')
  const [text, update] = useSyncedText(external)
  return (
    <textarea
      className={cn(inputClass, 'h-auto min-h-24 py-1.5 leading-relaxed')}
      rows={5}
      value={text}
      onChange={(event) => {
        const raw = event.target.value
        const next: string[] = []
        for (const line of raw.split('\n')) {
          if (line.trim() && next.length < 50) next.push(line.trim())
        }
        update(raw, next.join('\n'))
        onChange(next)
      }}
    />
  )
}

export function tableToText(rows: string[][]): string {
  return rows.map((row) => row.join(' | ')).join('\n')
}

export function textToTable(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split('\n')) {
    if (!line.trim() || rows.length >= 200) continue
    const cells = line.split('|').slice(0, 12)
    rows.push(cells.map((cell) => cell.trim()))
  }
  return rows
}

/** `string[][]` typed as text: one row per line, cells split by `|`. */
export function TableControl({ value, onChange }: CustomControlProps) {
  const rows = Array.isArray(value) ? value.map(strings) : []
  const [text, update] = useSyncedText(tableToText(rows))
  return (
    <textarea
      className={cn(
        inputClass,
        'h-auto min-h-32 py-1.5 font-mono text-[11px] leading-relaxed',
      )}
      rows={7}
      spellCheck={false}
      value={text}
      onChange={(event) => {
        const raw = event.target.value
        const next = textToTable(raw)
        update(raw, tableToText(next))
        onChange(next)
      }}
    />
  )
}

const RECURRENCE_OPTIONS = [
  { value: 'once', label: 'Pagamento único' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'yearly', label: 'Anual' },
]

function isItem(value: unknown): value is DocumentPricingItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DocumentPricingItem).id === 'string'
  )
}

function toRecurrence(value: string): DocumentPricingItem['recurrence'] {
  return value === 'monthly' || value === 'yearly' ? value : 'once'
}

/** A new line of a pricing table. */
export function newPricingItem(): DocumentPricingItem {
  return {
    id: createId(),
    name: 'Novo item',
    unitPrice: 0,
    quantity: 1,
  }
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className='flex items-center justify-between gap-2 text-xs'>
      <span>{label}</span>
      <Switch
        size='sm'
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <span className='text-[11px] font-medium text-muted-foreground'>
        {label}
      </span>
      {children}
    </div>
  )
}

/** Items of a `pricing-table` (`DocumentPricingItem[]`). */
export function PricingItemsControl({ value, onChange }: CustomControlProps) {
  const items = Array.isArray(value) ? value.filter(isItem) : []
  const [open, setOpen] = useState<string | null>(null)
  const set = (next: DocumentPricingItem[]) => onChange(next)
  const patch = (id: string, changes: Partial<DocumentPricingItem>) =>
    set(items.map((item) => (item.id === id ? { ...item, ...changes } : item)))
  const remove = (id: string) => set(items.filter((item) => item.id !== id))
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    set(next)
  }

  return (
    <div className='flex flex-col gap-1.5'>
      {items.length === 0 ? (
        <p className='rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground'>
          Nenhum item na tabela.
        </p>
      ) : null}
      {items.map((item, index) => {
        const expanded = open === item.id
        return (
          <div key={item.id} className='rounded-md border bg-background'>
            <div className='flex h-9 items-center gap-1 pr-1 pl-2'>
              <button
                type='button'
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : item.id)}
                className='flex min-w-0 flex-1 flex-col items-start rounded px-1 py-0.5 text-left hover:bg-muted/60'
              >
                <span className='w-full truncate text-xs font-medium'>
                  {item.name || 'Item sem nome'}
                </span>
                <span className='text-[10px] text-muted-foreground tabular-nums'>
                  {formatBRL(pricingLineTotal(item))}
                  {item.optional ? ' · opcional' : ''}
                </span>
              </button>
              <button
                type='button'
                aria-label='Mover para cima'
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className='flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30'
              >
                <SteelIcon icon={ArrowUp01Icon} className='size-3.5' />
              </button>
              <button
                type='button'
                aria-label='Mover para baixo'
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
                className='flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30'
              >
                <SteelIcon icon={ArrowDown01Icon} className='size-3.5' />
              </button>
              <button
                type='button'
                aria-label={`Remover ${item.name || 'item'}`}
                onClick={() => remove(item.id)}
                className='flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
              >
                <SteelIcon icon={Delete02Icon} className='size-3.5' />
              </button>
            </div>
            {expanded ? (
              <div className='flex flex-col gap-2.5 border-t px-2.5 py-3'>
                <Field label='Nome'>
                  <input
                    className={inputClass}
                    maxLength={200}
                    value={item.name}
                    onChange={(event) =>
                      patch(item.id, { name: event.target.value })
                    }
                  />
                </Field>
                <Field label='Descrição'>
                  <textarea
                    className={cn(inputClass, 'h-auto min-h-14 py-1.5')}
                    rows={2}
                    maxLength={1000}
                    value={item.description ?? ''}
                    onChange={(event) =>
                      patch(item.id, {
                        description: event.target.value || undefined,
                      })
                    }
                  />
                </Field>
                <div className='grid grid-cols-2 gap-2'>
                  <Field label='Valor unitário (R$)'>
                    <NumberInput
                      value={item.unitPrice}
                      min={0}
                      step={0.01}
                      onChange={(next) =>
                        patch(item.id, { unitPrice: next ?? 0 })
                      }
                    />
                  </Field>
                  <Field label='Quantidade'>
                    <NumberInput
                      value={item.quantity}
                      min={0}
                      step={1}
                      onChange={(next) =>
                        patch(item.id, { quantity: next ?? 0 })
                      }
                    />
                  </Field>
                  <Field label='Unidade'>
                    <input
                      className={inputClass}
                      maxLength={40}
                      placeholder='ex.: horas'
                      value={item.unit ?? ''}
                      onChange={(event) =>
                        patch(item.id, {
                          unit: event.target.value || undefined,
                        })
                      }
                    />
                  </Field>
                  <Field label='Desconto (%)'>
                    <NumberInput
                      value={item.discountPct}
                      min={0}
                      max={100}
                      step={1}
                      allowEmpty
                      onChange={(next) => patch(item.id, { discountPct: next })}
                    />
                  </Field>
                </div>
                <Field label='Cobrança'>
                  <select
                    className={inputClass}
                    value={item.recurrence ?? 'once'}
                    onChange={(event) =>
                      patch(item.id, {
                        recurrence: toRecurrence(event.target.value),
                      })
                    }
                  >
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <ToggleRow
                  label='Item opcional (o cliente escolhe)'
                  checked={item.optional === true}
                  onChange={(checked) => patch(item.id, { optional: checked })}
                />
                {item.optional ? (
                  <ToggleRow
                    label='Começa marcado'
                    checked={item.selectedByDefault === true}
                    onChange={(checked) =>
                      patch(item.id, { selectedByDefault: checked })
                    }
                  />
                ) : null}
                <ToggleRow
                  label='O cliente pode mudar a quantidade'
                  checked={item.quantityEditable === true}
                  onChange={(checked) =>
                    patch(item.id, { quantityEditable: checked })
                  }
                />
              </div>
            ) : null}
          </div>
        )
      })}
      <button
        type='button'
        onClick={() => {
          const item = newPricingItem()
          set([...items, item])
          setOpen(item.id)
        }}
        className='inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary'
      >
        <SteelIcon icon={Add01Icon} className='size-3.5' />
        Adicionar item
      </button>
    </div>
  )
}
