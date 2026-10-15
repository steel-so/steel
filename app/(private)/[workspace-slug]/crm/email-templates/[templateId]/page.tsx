import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { EmailTemplateEditorPage } from '@/app/_components/crm/email-editor/email-template-editor-page'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Editor de e-mail | CRM | Steel',
  description: 'Editor visual de templates de e-mail do CRM',
}

export default async function CrmEmailTemplateEditorPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; templateId: string }>
}) {
  const { 'workspace-slug': slug, templateId } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <FocusedScreen
      label='Editor de e-mail'
      mobileBack={{
        href: `/${slug}/crm/email-templates`,
        label: 'Voltar para os templates',
      }}
    >
      <div className='min-h-0 flex-1'>
        <EmailTemplateEditorPage
          workspaceId={membership.value.workspaceId}
          slug={slug}
          templateId={templateId}
          allowHtml={isPrivilegedRole(membership.value.role)}
          collabUser={{
            id: session.value.user.id,
            name: session.value.user.name || session.value.user.email,
            image: session.value.user.image ?? null,
          }}
        />
      </div>
    </FocusedScreen>
  )
}
