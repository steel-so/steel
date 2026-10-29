import { News01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { NewsletterIssueReport } from '@/app/_components/crm/newsletters/issues/report/newsletter-issue-report'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { CrmNewsletterIssueService } from '@/src/services/crm-newsletter-issue.service'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Relatório da edição | Newsletter | CRM | Steel',
  description: 'Entregas, aberturas e cliques de uma edição da newsletter',
}

export default async function CrmNewsletterIssueReportRoute({
  params,
}: {
  params: Promise<{
    'workspace-slug': string
    newsletterId: string
    issueId: string
  }>
}) {
  const { 'workspace-slug': slug, newsletterId, issueId } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  const newsletter = await CrmNewsletterIssueService.summary(
    session.value.user.id,
    membership.value.workspaceId,
    newsletterId,
  )
  if (!newsletter.ok) notFound()

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Newsletters'>
            <SteelIcon
              icon={News01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <NewsletterIssueReport
          workspaceId={membership.value.workspaceId}
          slug={slug}
          newsletterId={newsletterId}
          newsletterName={newsletter.value.name}
          issueId={issueId}
        />
      </div>
    </div>
  )
}
