'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CatalogOrdersTable } from './catalog-orders-table'
import { CatalogProductsTable } from './catalog-products-table'
import { CatalogSettings } from './catalog-settings'

type Tab = 'products' | 'orders' | 'settings'

/** Catálogo e carrinho (Z8): produtos, pedidos recebidos e configuração. */
export function CatalogView({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const [tab, setTab] = useState<Tab>('products')
  return (
    <div className='space-y-4'>
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList aria-label='Seção do catálogo'>
          <TabsTrigger value='products'>Produtos</TabsTrigger>
          <TabsTrigger value='orders'>Pedidos</TabsTrigger>
          <TabsTrigger value='settings'>Configurações</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'products' ? (
        <CatalogProductsTable workspaceId={workspaceId} />
      ) : tab === 'orders' ? (
        <CatalogOrdersTable workspaceId={workspaceId} slug={slug} />
      ) : (
        <CatalogSettings workspaceId={workspaceId} />
      )}
    </div>
  )
}
