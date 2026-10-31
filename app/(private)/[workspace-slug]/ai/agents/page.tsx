import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { SteelAgentsList } from '@/app/_components/steel-agents/steel-agents-list'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Agentes | Steel AI | Steel',
  description: 'Agentes autônomos do Steel AI.',
}

export default async function SteelAgentsPage({
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
    <SteelAgentsList
      workspaceId={membership.value.workspaceId}
      slug={slug}
      currentUserId={session.value.user.id}
    />
  )
}
