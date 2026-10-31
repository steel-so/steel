import { UserSearch02Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ProspectingPanel } from '@/app/_components/crm/prospecting/prospecting-panel'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Prospecção | CRM | Steel',
  description: 'Agente de prospecção e enriquecimento do CRM',
}

export default async function CrmProspectingPage({
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
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Prospecção'>
            <SteelIcon
              icon={UserSearch02Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1'>
        <ProspectingPanel
          workspaceId={membership.value.workspaceId}
          slug={slug}
          canManage={
            membership.value.role === 'OWNER' ||
            membership.value.role === 'ADMIN'
          }
        />
      </div>
    </div>
  )
}
