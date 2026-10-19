import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AiEvalSetPage } from '@/app/_components/steel-ai-evals/ai-eval-set-page'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Conjunto de teste | Steel AI | Steel',
  description: 'Casos, execuções e resultados de um conjunto de teste.',
}

export default async function SteelAiEvalSetRoute({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; setId: string }>
}) {
  const { 'workspace-slug': slug, setId } = await params
  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')
  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()
  if (!isPrivilegedRole(membership.value.role)) {
    redirect(`/${slug}/ai/evals`)
  }

  return (
    <AiEvalSetPage
      key={setId}
      workspaceId={membership.value.workspaceId}
      slug={slug}
      setId={setId}
    />
  )
}
