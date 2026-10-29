'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WhatsappSurveyResponses } from './whatsapp-survey-responses'
import { WhatsappSurveyResults } from './whatsapp-survey-results'
import { WhatsappSurveySettings } from './whatsapp-survey-settings'

type Tab = 'results' | 'responses' | 'rules'

/** Pesquisas NPS/CSAT/CES: resultados, respostas e regras de envio. */
export function WhatsappSurveysTabs({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const [tab, setTab] = useState<Tab>('results')
  return (
    <div>
      <div className='px-6 pt-4'>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList aria-label='Seção das pesquisas'>
            <TabsTrigger value='results'>Resultados</TabsTrigger>
            <TabsTrigger value='responses'>Envios</TabsTrigger>
            <TabsTrigger value='rules'>Regras</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {tab === 'results' ? (
        <WhatsappSurveyResults workspaceId={workspaceId} />
      ) : tab === 'responses' ? (
        <WhatsappSurveyResponses workspaceId={workspaceId} />
      ) : (
        <WhatsappSurveySettings workspaceId={workspaceId} canEdit={canEdit} />
      )}
    </div>
  )
}
