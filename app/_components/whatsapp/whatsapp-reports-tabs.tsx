'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WhatsAppAdsTab } from './ads/whatsapp-ads-tab'
import { WhatsAppCostsTab } from './costs/whatsapp-costs-tab'
import { WhatsappAgentReport } from './whatsapp-agent-report'
import { WhatsappReportsList } from './whatsapp-reports-list'
import { WhatsappSlaReport } from './whatsapp-sla-report'

/**
 * Zap reports page: the custom reports, the SLA report (ADR 0048), the
 * "Atendentes" tab (agent performance, only where the platform admin enabled
 * it — ADR 0062) and, for OWNER/ADMIN, the "Custos" tab (money is never shown
 * to other roles — ADR 0050) and the "Anúncios" tab (Click-to-WhatsApp
 * attribution and ROI).
 */
export function WhatsappReportsTabs({
  workspaceId,
  slug,
  canSeeCosts,
  agentReportEnabled = false,
  initialTab,
}: {
  workspaceId: string
  slug: string
  canSeeCosts: boolean
  agentReportEnabled?: boolean
  initialTab?: string
}) {
  const [tab, setTab] = useState<
    'reports' | 'sla' | 'agents' | 'costs' | 'ads'
  >(
    canSeeCosts && initialTab === 'custos'
      ? 'costs'
      : canSeeCosts && initialTab === 'anuncios'
        ? 'ads'
        : agentReportEnabled && initialTab === 'atendentes'
          ? 'agents'
          : initialTab === 'sla'
            ? 'sla'
            : 'reports',
  )

  return (
    <div>
      <div className='px-6 pt-4'>
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setTab(
              value === 'costs'
                ? 'costs'
                : value === 'ads'
                  ? 'ads'
                  : value === 'sla'
                    ? 'sla'
                    : value === 'agents' && agentReportEnabled
                      ? 'agents'
                      : 'reports',
            )
          }
        >
          <TabsList aria-label='Seção dos relatórios'>
            <TabsTrigger value='reports'>Relatórios</TabsTrigger>
            <TabsTrigger value='sla'>SLA</TabsTrigger>
            {agentReportEnabled ? (
              <TabsTrigger value='agents'>Atendentes</TabsTrigger>
            ) : null}
            {canSeeCosts ? (
              <TabsTrigger value='costs'>Custos</TabsTrigger>
            ) : null}
            {canSeeCosts ? (
              <TabsTrigger value='ads'>Anúncios</TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
      </div>
      {tab === 'costs' && canSeeCosts ? (
        <WhatsAppCostsTab workspaceId={workspaceId} />
      ) : tab === 'ads' && canSeeCosts ? (
        <WhatsAppAdsTab workspaceId={workspaceId} />
      ) : tab === 'agents' && agentReportEnabled ? (
        <WhatsappAgentReport workspaceId={workspaceId} />
      ) : tab === 'sla' ? (
        <WhatsappSlaReport workspaceId={workspaceId} />
      ) : (
        <WhatsappReportsList workspaceId={workspaceId} slug={slug} />
      )}
    </div>
  )
}
