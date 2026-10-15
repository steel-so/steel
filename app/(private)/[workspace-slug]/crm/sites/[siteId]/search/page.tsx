import { WebDesign01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { SiteSearchScreen } from '@/app/_components/crm/sites/search/site-search-screen'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Buscadores do site | CRM | Steel',
  description: 'SEO, AEO e GEO de um site do CRM',
}

type Props = {
  params: Promise<{ 'workspace-slug': string; siteId: string }>
}

export default async function CrmSiteSearchPage({ params }: Props) {
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
          <HeaderBreadcrumbCrumb title='Buscadores'>
            <span aria-hidden className='text-muted-foreground'>
              /
            </span>
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <Suspense fallback={<Skeleton className='m-6 h-96' />}>
          <SiteSearchScreen
            workspaceId={membership.value.workspaceId}
            slug={slug}
            siteId={siteId}
          />
        </Suspense>
      </div>
    </div>
  )
}
