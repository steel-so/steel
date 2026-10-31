'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppointmentsPanel } from './appointments-panel'
import { ProfessionalsPanel } from './professionals-panel'
import { SchedulingSettings } from './scheduling-settings'
import { ServicesPanel } from './services-panel'

type Tab = 'agenda' | 'services' | 'professionals' | 'settings'

/** Agendamento nativo (Z10): agenda, serviços, profissionais e ajustes. */
export function AgendaView({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<Tab>('agenda')
  return (
    <div className='space-y-4'>
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList aria-label='Seção da agenda'>
          <TabsTrigger value='agenda'>Agenda</TabsTrigger>
          <TabsTrigger value='services'>Serviços</TabsTrigger>
          <TabsTrigger value='professionals'>Profissionais</TabsTrigger>
          <TabsTrigger value='settings'>Configurações</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'agenda' ? (
        <AppointmentsPanel workspaceId={workspaceId} />
      ) : tab === 'services' ? (
        <ServicesPanel workspaceId={workspaceId} />
      ) : tab === 'professionals' ? (
        <ProfessionalsPanel workspaceId={workspaceId} />
      ) : (
        <SchedulingSettings workspaceId={workspaceId} />
      )}
    </div>
  )
}
