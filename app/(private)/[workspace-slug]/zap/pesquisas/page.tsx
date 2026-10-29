import { StarIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { WhatsappSurveysTabs } from '@/app/_components/whatsapp/surveys/whatsapp-surveys-tabs'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Pesquisas | WhatsApp | Steel',
  description: 'Pesquisas de satisfação NPS, CSAT e CES por WhatsApp e e-mail',
}

export default async function ZapSurveysPage({
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
    <div className='h-full w-full overflow-y-auto'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Pesquisas'>
            <SteelIcon
              icon={StarIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <WhatsappSurveysTabs
        workspaceId={membership.value.workspaceId}
        canEdit={isPrivilegedRole(membership.value.role)}
      />
    </div>
  )
}
