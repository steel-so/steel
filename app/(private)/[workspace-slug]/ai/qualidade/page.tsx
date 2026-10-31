import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { QaPage } from '@/app/_components/steel-ai-qa/qa-page'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Qualidade | Steel AI | Steel',
  description:
    'Nota automática por IA em cada conversa e chamado, com painel de coaching por atendente.',
}

export default async function SteelAiQualityRoute({
  params,
  searchParams,
}: {
  params: Promise<{ 'workspace-slug': string }>
  searchParams: Promise<{ review?: string }>
}) {
  const [{ 'workspace-slug': slug }, { review }] = await Promise.all([
    params,
    searchParams,
  ])
  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')
  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <QaPage
      workspaceId={membership.value.workspaceId}
      canManage={isPrivilegedRole(membership.value.role)}
      initialReviewId={review ?? null}
    />
  )
}
