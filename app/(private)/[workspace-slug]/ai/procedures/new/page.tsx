import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AiProcedureDetail } from '@/app/_components/ai-procedures/ai-procedure-detail'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Novo procedimento | Steel AI | Steel',
  description: 'Crie um roteiro com passos obrigatórios.',
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
    <AiProcedureDetail
      workspaceId={membership.value.workspaceId}
      slug={slug}
      procedureId={null}
    />
  )
}
