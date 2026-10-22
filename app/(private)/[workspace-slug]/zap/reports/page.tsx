import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { WhatsappReportsTabs } from '@/app/_components/whatsapp/whatsapp-reports-tabs'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Relatórios | WhatsApp | Steel',
  description: 'Relatórios de conversas e transmissões do WhatsApp',
}

export default async function WhatsappReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'workspace-slug': string }>
  searchParams: Promise<{ aba?: string }>
}) {
  const [{ 'workspace-slug': slug }, { aba }] = await Promise.all([
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
    <div className='flex h-full w-full min-h-0 flex-col'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <WhatsappReportsTabs
          workspaceId={membership.value.workspaceId}
          slug={slug}
          canSeeCosts={isPrivilegedRole(membership.value.role)}
          initialTab={aba}
        />
      </div>
    </div>
  )
}
