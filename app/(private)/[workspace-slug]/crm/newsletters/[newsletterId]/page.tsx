import { NewsIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CrmNewsletterView } from '@/app/_components/crm/newsletters/crm-newsletter-view'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Newsletter | CRM | Steel',
  description: 'Edições, assinantes e configurações da newsletter',
}

export default async function CrmNewsletterPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; newsletterId: string }>
}) {
  const { 'workspace-slug': slug, newsletterId } = await params

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
          <HeaderBreadcrumbCrumb title='Newsletters'>
            <SteelIcon
              icon={NewsIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <CrmNewsletterView
          workspaceId={membership.value.workspaceId}
          slug={slug}
          newsletterId={newsletterId}
        />
      </div>
    </div>
  )
}
