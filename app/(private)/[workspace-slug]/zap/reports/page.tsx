import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { WhatsappReportsList } from '@/app/_components/whatsapp/whatsapp-reports-list'
import { WhatsappSlaReport } from '@/app/_components/whatsapp/whatsapp-sla-report'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Relatórios | WhatsApp | Steel',
  description: 'Relatórios de conversas e transmissões do WhatsApp',
}

export default async function WhatsappReportsPage({
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
    <div className='flex h-full w-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <WhatsappSlaReport workspaceId={membership.value.workspaceId} />
        <WhatsappReportsList
          workspaceId={membership.value.workspaceId}
          slug={slug}
        />
      </div>
    </div>
  )
}
