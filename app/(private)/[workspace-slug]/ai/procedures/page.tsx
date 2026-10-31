import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AiProceduresPage } from '@/app/_components/ai-procedures/ai-procedures-page'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Procedimentos | Steel AI | Steel',
  description: 'Roteiros com passos obrigatórios para a IA seguir.',
}

export default async function Page({
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
    <AiProceduresPage workspaceId={membership.value.workspaceId} slug={slug} />
  )
}
