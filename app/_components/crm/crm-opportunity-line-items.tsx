'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import * as React from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  createCrmOpportunityLineItem,
  deleteCrmOpportunityLineItem,
  updateCrmOpportunityLineItem,
  useCrmOpportunityLineItems,
} from '@/src/hooks/use-crm-opportunity-line-item'
import type { Option } from '@/src/hooks/use-crm-workspace-lookups'
import type { CrmOpportunityLineItemDTO } from '@/types/crm-opportunity'

const moneyFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})

const NONE = '__none__'

/**
 * Itens de uma oportunidade. Cada mutação chama a API (que recalcula o
 * `total`) e dá refetch; `onChanged` avisa a grade para resync do valor.
 */
export function CrmOpportunityLineItems({
  workspaceId,
  opportunityId,
  productOptions,
  slug,
  onChanged,
}: {
  workspaceId: string
  /** Workspace slug, used to link to the products catalog when it is empty. */
  slug?: string
  opportunityId: string
  productOptions: Option[]
  onChanged?: () => void
}) {
  const { items, isLoading, refetch } = useCrmOpportunityLineItems(
    workspaceId,
    opportunityId,
  )
  const [busy, setBusy] = React.useState(false)

  const total = items.reduce((sum, item) => sum + item.total, 0)

  async function afterMutation(result: { ok: boolean; message?: string }) {
    setBusy(false)
    if (!result.ok) {
      notify.error(result.message ?? 'Não foi possível salvar o item.')
      return
    }
    await refetch()
    onChanged?.()
  }

  async function handleAdd() {
    setBusy(true)
    await afterMutation(
      await createCrmOpportunityLineItem(workspaceId, opportunityId, {
        name: 'Novo item',
        quantity: 1,
      }),
    )
  }

  async function handleProduct(
    item: CrmOpportunityLineItemDTO,
    productId: string,
  ) {
    if (productId === (item.productId ?? NONE)) return
    setBusy(true)
    // Atualização atômica: a API copia nome/preço do produto escolhido; em
    // "avulso" apenas desvincula, mantendo os valores atuais do item.
    await afterMutation(
      await updateCrmOpportunityLineItem(workspaceId, opportunityId, item.id, {
        productId: productId === NONE ? null : productId,
      }),
    )
  }

  async function handlePatch(
    item: CrmOpportunityLineItemDTO,
    patch: Partial<
      Pick<
        CrmOpportunityLineItemDTO,
        'name' | 'quantity' | 'unitPrice' | 'discountPct'
      >
    >,
  ) {
    setBusy(true)
    await afterMutation(
      await updateCrmOpportunityLineItem(
        workspaceId,
        opportunityId,
        item.id,
        patch,
      ),
    )
  }

  async function handleDelete(item: CrmOpportunityLineItemDTO) {
    setBusy(true)
    await afterMutation(
      await deleteCrmOpportunityLineItem(workspaceId, opportunityId, item.id),
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <div className='flex flex-col'>
          <span className='font-medium text-sm'>Itens</span>
          <span className='text-muted-foreground text-xs'>
            O total dos itens é uma referência: o valor da oportunidade
            continua sendo o campo Valor.
          </span>
        </div>
        <Button size='sm' variant='outline' onClick={handleAdd} disabled={busy}>
          <SteelIcon icon={Add01Icon} strokeWidth={2} className='size-4' />
          Adicionar
        </Button>
      </div>

      {isLoading ? (
        <p className='text-muted-foreground text-sm'>Carregando…</p>
      ) : items.length === 0 ? (
        <div className='flex flex-col gap-1 text-muted-foreground text-sm'>
          <p>Sem itens. O valor da oportunidade é editável manualmente.</p>
          {productOptions.length === 0 && slug ? (
            <p>
              Ainda não há produtos cadastrados.{' '}
              <Link
                href={`/${slug}/crm/products`}
                className='text-foreground underline underline-offset-2'
              >
                Cadastre produtos
              </Link>{' '}
              para escolher itens do catálogo.
            </p>
          ) : null}
        </div>
      ) : (
        <div className='flex flex-col gap-2'>
          {items.map((item) => (
            <div
              // updatedAt na chave remonta os inputs não controlados quando a
              // API muda valores (ex.: preço copiado ao trocar o produto).
              key={`${item.id}:${item.updatedAt}`}
              className='flex flex-col gap-2 rounded-lg border p-2.5'
            >
              <div className='flex items-center gap-2'>
                {productOptions.length > 0 ? (
                  <Select
                    value={item.productId ?? NONE}
                    onValueChange={(v) =>
                      handleProduct(item, (v as string) ?? NONE)
                    }
                  >
                    <SelectTrigger size='sm' className='flex-1'>
                      <span className='truncate'>{item.name}</span>
                    </SelectTrigger>
                    <SelectContent className='max-h-72'>
                      <SelectItem value={NONE}>— avulso —</SelectItem>
                      {productOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    defaultValue={item.name}
                    className='h-8 flex-1'
                    onBlur={(e) => {
                      if (e.target.value !== item.name) {
                        handlePatch(item, { name: e.target.value })
                      }
                    }}
                    aria-label='Nome do item'
                  />
                )}
                <ConfirmAction
                  trigger={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      disabled={busy}
                      aria-label='Remover item'
                    >
                      <SteelIcon
                        icon={Delete02Icon}
                        strokeWidth={2}
                        className='size-4'
                      />
                    </Button>
                  }
                  title='Remover este item?'
                  description={`"${item.name}" sai da oportunidade. Não é possível desfazer.`}
                  confirmLabel='Remover'
                  onConfirm={() => handleDelete(item)}
                />
              </div>

              <div className='flex items-center gap-2 text-sm'>
                <span className='flex items-center gap-1'>
                  <span className='text-muted-foreground text-xs'>Qtd</span>
                  <Input
                    type='number'
                    min={1}
                    defaultValue={item.quantity}
                    className='h-8 w-16'
                    onBlur={(e) => {
                      const q = Math.max(1, Number(e.target.value) || 1)
                      if (q !== item.quantity)
                        handlePatch(item, { quantity: q })
                    }}
                    aria-label='Quantidade'
                  />
                </span>
                <span className='flex items-center gap-1'>
                  <span className='text-muted-foreground text-xs'>Preço</span>
                  <Input
                    type='number'
                    min={0}
                    step='0.01'
                    defaultValue={item.unitPrice}
                    className='h-8 w-24'
                    onBlur={(e) => {
                      const p = Math.max(0, Number(e.target.value) || 0)
                      if (p !== item.unitPrice)
                        handlePatch(item, { unitPrice: p })
                    }}
                    aria-label='Preço unitário'
                  />
                </span>
                <span className='flex items-center gap-1'>
                  <span className='text-muted-foreground text-xs'>Desc%</span>
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    defaultValue={item.discountPct}
                    className='h-8 w-16'
                    onBlur={(e) => {
                      const d = Math.min(
                        100,
                        Math.max(0, Number(e.target.value) || 0),
                      )
                      if (d !== item.discountPct)
                        handlePatch(item, { discountPct: d })
                    }}
                    aria-label='Desconto percentual'
                  />
                </span>
                <span className='ml-auto font-medium tabular-nums'>
                  {moneyFmt.format(item.total)}
                </span>
              </div>
            </div>
          ))}

          <div className='flex items-center justify-between border-t pt-2 text-sm'>
            <span className='text-muted-foreground'>Total</span>
            <span className='font-semibold tabular-nums'>
              {moneyFmt.format(total)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
