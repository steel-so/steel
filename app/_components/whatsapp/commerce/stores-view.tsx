'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EventLog } from './event-log'
import { StoreList } from './store-list'
import { TriggerCards } from './trigger-cards'

type Tab = 'stores' | 'triggers' | 'events'

/** Lojas e gatilhos de e-commerce (Z9). */
export function StoresView({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<Tab>('stores')
  return (
    <div className='space-y-4'>
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList aria-label='Seção das lojas'>
          <TabsTrigger value='stores'>Lojas</TabsTrigger>
          <TabsTrigger value='triggers'>Gatilhos</TabsTrigger>
          <TabsTrigger value='events'>Eventos</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'stores' ? (
        <StoreList workspaceId={workspaceId} />
      ) : tab === 'triggers' ? (
        <TriggerCards workspaceId={workspaceId} />
      ) : (
        <EventLog workspaceId={workspaceId} />
      )}
    </div>
  )
}
