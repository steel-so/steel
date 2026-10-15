import { DashboardSquare01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CrmDashboardsTable } from '@/app/_components/crm/crm-dashboards-table'
import { SalesTvTemplateButton } from '@/app/_components/crm/dashboard/sales-tv-template-button'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Painéis | CRM | Steel',
  description: 'Painéis customizados do CRM',
}

export default async function CrmDashboardsPage({
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
          <HeaderBreadcrumbCrumb title='Painéis'>
            <SteelIcon
              icon={DashboardSquare01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='flex min-h-0 flex-1 flex-col gap-4 p-6'>
        <SalesTvTemplateButton
          workspaceId={membership.value.workspaceId}
          slug={slug}
        />
        <div className='min-h-0 flex-1'>
          <CrmDashboardsTable
            workspaceId={membership.value.workspaceId}
            slug={slug}
          />
        </div>
      </div>
    </div>
  )
}
