import { MegaphoneIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CrmCampaignView } from '@/app/_components/crm/campaigns/crm-campaign-view'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Campanha | CRM | Steel',
  description: 'Assistente e resultados da campanha',
}

export default async function CrmCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'workspace-slug': string; id: string }>
  searchParams: Promise<{ passo?: string; emailTemplate?: string }>
}) {
  const { 'workspace-slug': slug, id } = await params
  const { passo, emailTemplate } = await searchParams

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
          <HeaderBreadcrumbCrumb title='Campanhas'>
            <SteelIcon
              icon={MegaphoneIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <CrmCampaignView
          workspaceId={membership.value.workspaceId}
          workspaceSlug={slug}
          campaignId={id}
          initialStep={passo ? Number(passo) - 1 || 0 : 0}
          initialEmailTemplateId={emailTemplate ?? null}
        />
      </div>
    </div>
  )
}
