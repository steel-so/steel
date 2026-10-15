import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CrmDashboardTvSession } from '@/app/_components/crm/dashboard/tv/crm-dashboard-tv-screens'
import { getAuthSession } from '@/src/lib/auth-session'
import { CrmDashboardService } from '@/src/services/crm-dashboard.service'
import { CrmSalesMetricsService } from '@/src/services/crm-sales-metrics.service'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Modo TV | Painéis | CRM | Steel',
  description: 'Painel do CRM em tela cheia para a TV da sala de vendas.',
}

/**
 * Modo TV com login: tela cheia sobre a casca do app. `?interval=30`
 * sobrepõe a rotação entre as telas configurada no painel.
 */
export default async function CrmDashboardTvPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'workspace-slug': string; id: string }>
  searchParams: Promise<{ interval?: string }>
}) {
  const { 'workspace-slug': slug, id } = await params
  const { interval } = await searchParams

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()
  const workspaceId = membership.value.workspaceId

  const dashboard = await CrmDashboardService.get(
    session.value.user.id,
    workspaceId,
    id,
  )
  if (!dashboard.ok) notFound()

  const clock = await CrmSalesMetricsService.clock(workspaceId)

  return (
    <CrmDashboardTvSession
      workspaceId={workspaceId}
      dashboardId={id}
      slug={slug}
      timeZone={clock.ok ? clock.value.timeZone : 'America/Sao_Paulo'}
      interval={interval}
    />
  )
}
