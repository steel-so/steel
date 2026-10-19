import { Settings02Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { WhatsappSettingsAi } from '@/app/_components/whatsapp/settings/whatsapp-settings-ai'
import { WhatsappSettingsAiKnowledge } from '@/app/_components/whatsapp/settings/whatsapp-settings-ai-knowledge'
import { WhatsappSettingsCallRecording } from '@/app/_components/whatsapp/settings/whatsapp-settings-call-recording'
import { WhatsappSettingsConnections } from '@/app/_components/whatsapp/settings/whatsapp-settings-connections'
import { WhatsappSettingsService } from '@/app/_components/whatsapp/settings/whatsapp-settings-service'
import { SteelIcon } from '@/components/icon/icon'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Configurações do WhatsApp | Steel',
  description: 'Conexões, IA e atendimento do WhatsApp',
}

export default async function ZapSettingsPage({
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

  const workspaceId = membership.value.workspaceId

  return (
    <div className='h-full w-full overflow-y-auto'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Configurações do WhatsApp'>
            <SteelIcon
              icon={Settings02Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='w-full p-6'>
        <Tabs defaultValue='connections'>
          <TabsList>
            <TabsTrigger value='connections'>Conexões</TabsTrigger>
            <TabsTrigger value='ai'>IA</TabsTrigger>
            <TabsTrigger value='service'>Atendimento</TabsTrigger>
          </TabsList>
          <TabsContent value='connections' className='pt-4'>
            <WhatsappSettingsConnections workspaceId={workspaceId} />
          </TabsContent>
          <TabsContent value='ai' className='space-y-6 pt-4'>
            <WhatsappSettingsAi workspaceId={workspaceId} />
            <WhatsappSettingsAiKnowledge workspaceId={workspaceId} />
          </TabsContent>
          <TabsContent value='service' className='space-y-6 pt-4'>
            <WhatsappSettingsService workspaceId={workspaceId} />
            <WhatsappSettingsCallRecording workspaceId={workspaceId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
