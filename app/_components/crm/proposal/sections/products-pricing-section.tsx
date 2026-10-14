'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { AiInput } from '@/components/ui/ai-text-field'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { CrmProposalSectionContent } from '@/src/schemas/crm-proposal.schema'

export type ProductsPricingContent = Extract<
  CrmProposalSectionContent,
  { type: 'PRODUCTS_PRICING' }
>
type ProductLineItem = ProductsPricingContent['items'][number]

const currencyFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function computeItemsTotal(items: ProductLineItem[]): number {
  return items.reduce((sum, item) => sum + item.total, 0)
}

export function productsPricingDefaultContent(): ProductsPricingContent {
  const items: ProductLineItem[] = [
    { name: 'Produto ou serviço', quantity: 1, unitPrice: 0, total: 0 },
  ]
  return { type: 'PRODUCTS_PRICING', items, discount: 0, total: 0 }
}

function recompute(
  items: ProductLineItem[],
  discount: number,
): { items: ProductLineItem[]; total: number } {
  const total = Math.max(0, computeItemsTotal(items) - discount)
  return { items, total }
}

export function ProductsPricingEditor({
  content,
  onChange,
}: {
  content: ProductsPricingContent
  onChange: (content: ProductsPricingContent) => void
}) {
  function updateItem(index: number, patch: Partial<ProductLineItem>) {
    const items = content.items.map((item, i) => {
      if (i !== index) return item
      const next = { ...item, ...patch }
      next.total = Math.max(0, next.quantity * next.unitPrice)
      return next
    })
    onChange({ ...content, ...recompute(items, content.discount) })
  }

  function removeItem(index: number) {
    const items = content.items.filter((_, i) => i !== index)
    onChange({ ...content, ...recompute(items, content.discount) })
  }

  function addItem() {
    const items = [
      ...content.items,
      { name: 'Produto ou serviço', quantity: 1, unitPrice: 0, total: 0 },
    ]
    onChange({ ...content, ...recompute(items, content.discount) })
  }

  function updateDiscount(discount: number) {
    onChange({ ...content, discount, ...recompute(content.items, discount) })
  }

  return (
    <div className='flex flex-col gap-3'>
      {content.items.map((item, index) => (
        <div key={index} className='flex flex-col gap-2 rounded-md border p-3'>
          <div className='flex items-center gap-2'>
            <Input
              value={item.name}
              onChange={(e) => updateItem(index, { name: e.target.value })}
              placeholder='Nome do produto/serviço'
              className='flex-1'
            />
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label='Remover item'
              // A API exige ao menos um item: não deixa remover o último.
              disabled={content.items.length <= 1}
              onClick={() => removeItem(index)}
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
          {item.name === '' ? (
            <FieldError>Nome do item é obrigatório</FieldError>
          ) : null}
          <AiInput
            aiLabel='Descrição do produto/serviço'
            value={item.description ?? ''}
            onChange={(e) =>
              updateItem(index, { description: e.target.value || undefined })
            }
            placeholder='Descrição (opcional)'
          />
          <div className='grid grid-cols-3 gap-2'>
            <Field>
              <FieldLabel>Quantidade</FieldLabel>
              <Input
                type='number'
                min={1}
                value={item.quantity}
                aria-invalid={item.quantity <= 0 || undefined}
                onChange={(e) =>
                  updateItem(index, { quantity: Number(e.target.value) || 0 })
                }
              />
              {item.quantity <= 0 ? (
                <FieldError>Quantidade deve ser maior que zero</FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel>Valor unitário</FieldLabel>
              <Input
                type='number'
                min={0}
                step='0.01'
                value={item.unitPrice}
                onChange={(e) =>
                  updateItem(index, { unitPrice: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <Field>
              <FieldLabel>Total</FieldLabel>
              <Input readOnly value={currencyFmt.format(item.total)} />
            </Field>
          </div>
        </div>
      ))}
      <Button type='button' variant='outline' size='sm' onClick={addItem}>
        <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
        Adicionar produto
      </Button>

      <div className='flex items-center justify-end gap-4 border-t pt-3'>
        <Field className='w-40'>
          <FieldLabel>Desconto</FieldLabel>
          <Input
            type='number'
            min={0}
            step='0.01'
            value={content.discount}
            onChange={(e) => updateDiscount(Number(e.target.value) || 0)}
          />
        </Field>
        <div className='text-right'>
          <p className='text-muted-foreground text-xs'>Total</p>
          <p className='font-semibold text-lg'>
            {currencyFmt.format(content.total)}
          </p>
        </div>
      </div>
    </div>
  )
}

export function ProductsPricingDisplay({
  content,
}: {
  content: ProductsPricingContent
}) {
  return (
    <section className='flex flex-col gap-4 rounded-lg border p-8'>
      <h2 className='font-semibold text-2xl'>Produtos e valores</h2>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b text-left text-muted-foreground'>
            <th className='py-2 font-medium'>Item</th>
            <th className='py-2 font-medium'>Qtd.</th>
            <th className='py-2 font-medium'>Valor unit.</th>
            <th className='py-2 text-right font-medium'>Total</th>
          </tr>
        </thead>
        <tbody>
          {content.items.map((item) => (
            <tr key={item.name} className='border-b'>
              <td className='py-2'>
                <p className='font-medium'>{item.name}</p>
                {item.description ? (
                  <p className='text-muted-foreground text-xs'>
                    {item.description}
                  </p>
                ) : null}
              </td>
              <td className='py-2'>{item.quantity}</td>
              <td className='py-2'>{currencyFmt.format(item.unitPrice)}</td>
              <td className='py-2 text-right'>
                {currencyFmt.format(item.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className='flex flex-col items-end gap-1 text-sm'>
        {content.discount > 0 ? (
          <p className='text-muted-foreground'>
            Desconto: {currencyFmt.format(content.discount)}
          </p>
        ) : null}
        <p className='font-semibold text-lg'>
          Total: {currencyFmt.format(content.total)}
        </p>
      </div>
    </section>
  )
}
