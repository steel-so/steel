import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { WelcomeStepEditorPage } from '@/app/_components/crm/newsletters/automation/editor/welcome-step-editor-page'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { CrmNewsletterWelcomeService } from '@/src/services/crm-newsletter-welcome.service'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Boas-vindas | Newsletter | CRM | Steel',
  description: 'Editor de um e-mail da série de boas-vindas da newsletter',
}

export default async function CrmNewsletterWelcomeStepEditorRoute({
  params,
}: {
  params: Promise<{
    'workspace-slug': string
    newsletterId: string
    stepId: string
  }>
}) {
  const { 'workspace-slug': slug, newsletterId, stepId } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  const step = await CrmNewsletterWelcomeService.get(
    session.value.user.id,
    membership.value.workspaceId,
    newsletterId,
    stepId,
  )
  if (!step.ok) notFound()

  return (
    <FocusedScreen
      label='Editor da etapa de boas-vindas'
      mobileBack={{
        href: `/${slug}/crm/newsletters/${newsletterId}?aba=boas-vindas`,
        label: 'Voltar para a série de boas-vindas',
      }}
    >
      <div className='min-h-0 flex-1'>
        <WelcomeStepEditorPage
          workspaceId={membership.value.workspaceId}
          slug={slug}
          newsletterId={newsletterId}
          stepId={stepId}
          allowHtml={isPrivilegedRole(membership.value.role)}
        />
      </div>
    </FocusedScreen>
  )
}
