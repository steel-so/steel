import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { NewsletterIssueEditorPage } from '@/app/_components/crm/newsletters/issues/editor/newsletter-issue-editor-page'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { CrmNewsletterIssueService } from '@/src/services/crm-newsletter-issue.service'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Editor da edição | Newsletter | CRM | Steel',
  description: 'Editor visual de uma edição da newsletter do CRM',
}

export default async function CrmNewsletterIssueEditorRoute({
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
    <FocusedScreen
      label='Editor da edição'
      mobileBack={{
        href: `/${slug}/crm/newsletters/${newsletterId}`,
        label: 'Voltar para a newsletter',
      }}
    >
      <div className='min-h-0 flex-1'>
        <NewsletterIssueEditorPage
          workspaceId={membership.value.workspaceId}
          slug={slug}
          newsletterId={newsletterId}
          issueId={issueId}
          allowHtml={isPrivilegedRole(membership.value.role)}
          senderVerified={newsletter.value.senderVerified}
        />
      </div>
    </FocusedScreen>
  )
}
