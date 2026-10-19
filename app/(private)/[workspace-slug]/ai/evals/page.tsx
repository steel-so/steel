import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AiEvalsPage } from '@/app/_components/steel-ai-evals/ai-evals-page'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Avaliações | Steel AI | Steel',
  description:
    'Conjuntos de teste do Steel AI para rodar antes de trocar o modelo, o prompt ou uma skill.',
}

export default async function SteelAiEvalsRoute({
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
    <AiEvalsPage
      workspaceId={membership.value.workspaceId}
      slug={slug}
      canManage={isPrivilegedRole(membership.value.role)}
    />
  )
}
