import { Mail01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { EmailTemplateEditorPage } from '@/app/_components/crm/email-editor/email-template-editor-page'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
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
    <div className='flex h-full w-full min-h-0 flex-col'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Editor de e-mail'>
            <SteelIcon
              icon={Mail01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1'>
        <EmailTemplateEditorPage
          workspaceId={membership.value.workspaceId}
          slug={slug}
          templateId={templateId}
          allowHtml={isPrivilegedRole(membership.value.role)}
        />
      </div>
    </div>
  )
}
