'use client'

import { SdMonitoringTab } from '@/app/_components/servicedesk/settings/monitoring-tab'
import { SdSettingsProvider } from '@/app/_components/servicedesk/settings/sd-settings-kit'
import { Skeleton } from '@/components/ui/skeleton'
import { useSdConfig, useSdMe } from '@/src/hooks/use-sd-config'

/**
 * Ajustes › Integrações › Monitoramento: Zabbix, Grafana, PRTG and generic
 * webhook sources. They open ServiceDesk tickets, so the section reuses the
 * ServiceDesk settings context (priorities lookup, admin gate).
 */
export function MonitoringSettingsSection({
  workspaceId,
}: {
  workspaceId: string
}) {
  const me = useSdMe(workspaceId)
  const config = useSdConfig(workspaceId)
  if (me.isPending) return <Skeleton className='h-40 w-full' />
  return (
    <SdSettingsProvider
      value={{
        workspaceId,
        canEdit: me.data?.isAdmin ?? false,
        config: config.data,
      }}
    >
      <SdMonitoringTab />
    </SdSettingsProvider>
  )
}
