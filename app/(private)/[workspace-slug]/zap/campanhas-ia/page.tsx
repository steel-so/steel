import { AiMagicIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { FeatureGate, FeatureUnavailable } from '@/app/_components/feature-gate'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { WhatsappAiCampaignsPage } from '@/app/_components/whatsapp/ai-campaigns/ai-campaigns-page'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Campanhas de IA | Steel',
  description: 'Campanhas de WhatsApp com template e respostas da IA',
}

export default async function ZapAiCampaignsPage({
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
          <HeaderBreadcrumbCrumb title='Campanhas de IA'>
            <SteelIcon
              icon={AiMagicIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='w-full p-6'>
        <FeatureGate
          workspaceId={membership.value.workspaceId}
          feature='communication.broadcasts'
          fallback={<FeatureUnavailable title='Campanhas de IA' />}
        >
          <WhatsappAiCampaignsPage
            workspaceId={membership.value.workspaceId}
            slug={slug}
          />
        </FeatureGate>
      </div>
    </div>
  )
}
