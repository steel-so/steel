import { WebDesign01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { SiteExperiments } from '@/app/_components/crm/sites/experiments/site-experiments'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Testes A/B do site | CRM | Steel',
  description: 'Testes A/B de seções e páginas de um site do CRM',
}

type Props = {
  params: Promise<{ 'workspace-slug': string; siteId: string }>
}

export default async function CrmSiteExperimentsPage({ params }: Props) {
  const { 'workspace-slug': slug, siteId } = await params

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
          <HeaderBreadcrumbCrumb title='Sites'>
            <SteelIcon
              icon={WebDesign01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
          <HeaderBreadcrumbCrumb title='Testes A/B'>
            <span aria-hidden className='text-muted-foreground'>
              /
            </span>
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <SiteExperiments
          workspaceId={membership.value.workspaceId}
          slug={slug}
          siteId={siteId}
        />
      </div>
    </div>
  )
}
