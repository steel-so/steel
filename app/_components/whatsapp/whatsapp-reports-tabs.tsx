'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WhatsAppCostsTab } from './costs/whatsapp-costs-tab'
import { WhatsappReportsList } from './whatsapp-reports-list'

/**
 * Zap reports page: the custom reports plus, for OWNER/ADMIN, the "Custos"
 * tab (money is never shown to other roles — ADR 0050).
 */
export function WhatsappReportsTabs({
  workspaceId,
  slug,
  canSeeCosts,
  initialTab,
}: {
  workspaceId: string
  slug: string
  canSeeCosts: boolean
  initialTab?: string
}) {
  const [tab, setTab] = useState<'reports' | 'costs'>(
    canSeeCosts && initialTab === 'custos' ? 'costs' : 'reports',
  )

  if (!canSeeCosts) {
    return <WhatsappReportsList workspaceId={workspaceId} slug={slug} />
  }

  return (
    <div>
      <div className='px-6 pt-4'>
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setTab(value === 'costs' ? 'costs' : 'reports')
          }
        >
          <TabsList aria-label='Seção dos relatórios'>
            <TabsTrigger value='reports'>Relatórios</TabsTrigger>
            <TabsTrigger value='costs'>Custos</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {tab === 'costs' ? (
        <WhatsAppCostsTab workspaceId={workspaceId} />
      ) : (
        <WhatsappReportsList workspaceId={workspaceId} slug={slug} />
      )}
    </div>
  )
}
