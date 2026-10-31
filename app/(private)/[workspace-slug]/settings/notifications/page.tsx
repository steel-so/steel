import { Notification01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { NotificationBrowserSettingCard } from '@/app/_components/notifications/notification-browser-toggle'
import { PushSettingsCard } from '@/app/_components/notifications/push-settings-card'
import { AiDigestSettingsCard } from '@/app/_components/settings/ai-digest-settings-card'
import { NotificationPreferencesSection } from '@/app/_components/settings/notification-preferences-section'
import { SteelIcon } from '@/components/icon/icon'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Notificações | Steel',
  description: 'Escolha quais avisos chegam à sua caixa de entrada',
}

export default async function SettingsNotificationsPage({
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
    <div className='w-full overflow-y-auto'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Notificações'>
            <SteelIcon
              icon={Notification01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='w-full max-w-3xl space-y-6 p-6'>
        <div>
          <H3>Notificações</H3>
          <Muted>
            Escolha quais avisos chegam à sua caixa de entrada neste workspace.
            A escolha é só sua. Os avisos do ServiceDesk têm preferências
            próprias, nas configurações do ServiceDesk.
          </Muted>
        </div>
        <NotificationBrowserSettingCard
          workspaceId={membership.value.workspaceId}
        />
        <PushSettingsCard />
        <AiDigestSettingsCard workspaceId={membership.value.workspaceId} />
        <NotificationPreferencesSection
          workspaceId={membership.value.workspaceId}
        />
      </div>
    </div>
  )
}
