import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { SteelGovernance } from '@/app/_components/steel-agents/steel-governance'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Governança dos agentes | Steel AI | Steel',
  description:
    'Inventário, permissões e desligamento de emergência dos agentes.',
}

export default async function SteelAgentsGovernancePage({
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

  return (
    <SteelGovernance workspaceId={membership.value.workspaceId} slug={slug} />
  )
}
