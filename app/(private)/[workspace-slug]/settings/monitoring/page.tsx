import { RadarIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { MonitoringSettingsSection } from '@/app/_components/settings/monitoring-settings-section'
import { SettingsPageFrame } from '@/app/_components/settings/settings-page-frame'
import { getAuthSession } from '@/src/lib/auth-session'
import { hasModuleAccess } from '@/src/lib/module-access-guard'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Monitoramento | Integrações | Steel',
  description: 'Zabbix, Grafana, PRTG ou webhook: origens que abrem chamados no ServiceDesk.',
}

export default async function SettingsMonitoringPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()
  // notFound() stays in the page body (Cache Components must see it).
  if (!(await hasModuleAccess(slug, 'SERVICE_DESK'))) notFound()

  return (
    <SettingsPageFrame
      title='Monitoramento'
      description='Zabbix, Grafana, PRTG ou webhook: origens que abrem chamados no ServiceDesk.'
      icon={RadarIcon}
    >
      <MonitoringSettingsSection workspaceId={membership.value.workspaceId} />
    </SettingsPageFrame>
  )
}
