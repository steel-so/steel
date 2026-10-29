import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { SteelAgentSimulationView } from '@/app/_components/steel-agents/steel-agent-simulation-view'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Simulação do agente | Steel AI | Steel',
  description: 'Conversas simuladas com personas e a avaliação de cada uma.',
}

export default async function SteelAgentSimulationPage({
  params,
}: {
  params: Promise<{
    'workspace-slug': string
    agentId: string
    simulationId: string
  }>
}) {
  const { 'workspace-slug': slug, agentId, simulationId } = await params
  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')
  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <SteelAgentSimulationView
      key={simulationId}
      workspaceId={membership.value.workspaceId}
      slug={slug}
      agentId={agentId}
      simulationId={simulationId}
    />
  )
}
