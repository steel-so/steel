'use client'

import {
  ArrowDown01Icon,
  Cancel01Icon,
  Search01Icon,
  ShoppingBag01Icon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import { formatProductPrice, useEmailEditorData } from './editor-data'

function normalize(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Inspector control of `email.product` → `productId`: searches the
 * workspace's CRM products (name, SKU, description) and stores the id; the
 * block then shows the product's name, description and price.
 */
export function ProductPickerControl({ value, onChange }: CustomControlProps) {
  const { products, productsLoading, slug } = useEmailEditorData()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selectedId = typeof value === 'string' ? value : null
  const selected = products.find((product) => product.id === selectedId)

  const results = useMemo(() => {
    const q = normalize(query)
    const active = products.filter(
      (product) => product.active || product.id === selectedId,
    )
    if (!q) return active
    return active.filter((product) =>
      normalize(
        `${product.name} ${product.sku ?? ''} ${product.description ?? ''}`,
      ).includes(q),
    )
  }, [products, query, selectedId])

  const pick = (id: string | null) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className='flex min-w-0 items-center gap-1'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label='Produto do CRM'
          data-testid='product-picker-trigger'
          className='flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2 text-left text-xs shadow-xs outline-none transition-[border-color,box-shadow] hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'
        >
          <span className='flex size-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground'>
            <SteelIcon icon={ShoppingBag01Icon} className='size-3.5' />
          </span>
          {selected ? (
            <span className='flex min-w-0 flex-1 flex-col leading-tight'>
              <span className='truncate font-medium'>{selected.name}</span>
              <span className='truncate text-[11px] text-muted-foreground tabular-nums'>
                {formatProductPrice(selected)}
              </span>
            </span>
          ) : (
            <span className='min-w-0 flex-1 truncate text-muted-foreground'>
              {selectedId ? 'Produto removido do CRM' : 'Escolher um produto'}
            </span>
          )}
          <SteelIcon
            icon={ArrowDown01Icon}
            className='size-3.5 shrink-0 text-muted-foreground'
          />
        </PopoverTrigger>
        <PopoverContent align='start' className='w-72 gap-0 p-0'>
          <div className='flex items-center gap-2 border-b px-2.5'>
            <SteelIcon
              icon={Search01Icon}
              className='size-3.5 shrink-0 text-muted-foreground'
            />
            <input
              autoFocus
              aria-label='Buscar produto'
              placeholder='Buscar por nome ou SKU…'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className='h-9 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground'
            />
          </div>
          <div
            role='listbox'
            aria-label='Produtos do CRM'
            className='max-h-64 overflow-y-auto p-1'
          >
            {productsLoading ? (
              <p className='px-2 py-6 text-center text-muted-foreground text-xs'>
                Carregando produtos…
              </p>
            ) : results.length === 0 ? (
              <div className='flex flex-col items-center gap-2 px-3 py-6 text-center text-xs'>
                <p className='text-muted-foreground'>
                  {products.length === 0
                    ? 'Nenhum produto cadastrado no CRM.'
                    : 'Nenhum produto encontrado.'}
                </p>
                {products.length === 0 ? (
                  <Link
                    href={`/${slug}/crm/products`}
                    className='font-medium text-primary hover:underline'
                  >
                    Cadastrar produtos
                  </Link>
                ) : null}
              </div>
            ) : (
              results.map((product) => {
                const isSelected = product.id === selectedId
                return (
                  <button
                    key={product.id}
                    type='button'
                    role='option'
                    aria-selected={isSelected}
                    onClick={() => pick(product.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-muted focus-visible:bg-muted',
                      isSelected && 'bg-primary/5',
                    )}
                  >
                    <span className='flex min-w-0 flex-1 flex-col'>
                      <span className='truncate font-medium'>
                        {product.name}
                      </span>
                      <span className='truncate text-[11px] text-muted-foreground'>
                        {[product.sku, formatProductPrice(product)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {isSelected ? (
                      <SteelIcon
                        icon={Tick02Icon}
                        className='size-3.5 shrink-0 text-primary'
                      />
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selectedId ? (
        <button
          type='button'
          aria-label='Remover produto'
          title='Remover produto'
          onClick={() => pick(null)}
          className='flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          <SteelIcon icon={Cancel01Icon} className='size-3.5' />
        </button>
      ) : null}
    </div>
  )
}
