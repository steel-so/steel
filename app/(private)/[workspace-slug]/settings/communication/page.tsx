import { Chatting01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { WhatsAppUsageSection } from '@/app/_components/settings/whatsapp-usage-section'
import { SteelIcon } from '@/components/icon/icon'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'
import { getAuthSession } from '@/src/lib/auth-session'
import { hasModuleAccess } from '@/src/lib/module-access-guard'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Comunicação | Steel',
  description:
    'Consumo mensal de conversas e mensagens do WhatsApp e os limites do workspace',
}

export default async function SettingsCommunicationPage({
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
  // notFound() stays in the page body (Cache Components must see it).
  if (!(await hasModuleAccess(slug, 'COMMUNICATION'))) notFound()

  return (
    <div className='w-full overflow-y-auto'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Comunicação'>
            <SteelIcon
              icon={Chatting01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='w-full space-y-6 p-6'>
        <div>
          <H3>Comunicação</H3>
          <Muted>
            Consumo do mês e limites mensais de conversas e mensagens do
            WhatsApp.
          </Muted>
        </div>
        <WhatsAppUsageSection workspaceId={membership.value.workspaceId} />
      </div>
    </div>
  )
}
