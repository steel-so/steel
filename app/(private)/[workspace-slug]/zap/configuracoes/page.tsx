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
import { WhatsappSettingsArchive } from '@/app/_components/whatsapp/settings/whatsapp-settings-archive'
import { WhatsappSettingsBusinessHours } from '@/app/_components/whatsapp/settings/whatsapp-settings-business-hours'
import { WhatsappSettingsCallRecording } from '@/app/_components/whatsapp/settings/whatsapp-settings-call-recording'
import { WhatsappSettingsCloseStatuses } from '@/app/_components/whatsapp/settings/whatsapp-settings-close-statuses'
import { WhatsappSettingsConnections } from '@/app/_components/whatsapp/settings/whatsapp-settings-connections'
import { WhatsappSettingsCopilot } from '@/app/_components/whatsapp/settings/whatsapp-settings-copilot'
import { WhatsappSettingsDistribution } from '@/app/_components/whatsapp/settings/whatsapp-settings-distribution'
import { WhatsappSettingsMetaChannels } from '@/app/_components/whatsapp/settings/whatsapp-settings-meta-channels'
import { WhatsappSettingsNumberCheck } from '@/app/_components/whatsapp/settings/whatsapp-settings-number-check'
import { WhatsappSettingsBoleto } from '@/app/_components/whatsapp/settings/whatsapp-settings-boleto'
import { WhatsappSettingsPix } from '@/app/_components/whatsapp/settings/whatsapp-settings-pix'
import { WhatsappSettingsService } from '@/app/_components/whatsapp/settings/whatsapp-settings-service'
import { WhatsappSettingsSla } from '@/app/_components/whatsapp/settings/whatsapp-settings-sla'
import { WhatsappSettingsVoiceAgent } from '@/app/_components/whatsapp/settings/whatsapp-settings-voice-agent'
import { WhatsappSettingsWidget } from '@/app/_components/whatsapp/settings/whatsapp-settings-widget'
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
            <TabsTrigger value='voice'>Atendente de voz</TabsTrigger>
            <TabsTrigger value='widget'>Chat do site</TabsTrigger>
          </TabsList>
          <TabsContent value='connections' className='space-y-6 pt-4'>
            <WhatsappSettingsConnections workspaceId={workspaceId} />
            <WhatsappSettingsMetaChannels workspaceId={workspaceId} />
          </TabsContent>
          <TabsContent value='ai' className='space-y-6 pt-4'>
            <WhatsappSettingsAi workspaceId={workspaceId} />
            <WhatsappSettingsCopilot workspaceId={workspaceId} />
            <WhatsappSettingsAiKnowledge workspaceId={workspaceId} />
          </TabsContent>
          <TabsContent value='service' className='space-y-6 pt-4'>
            <WhatsappSettingsService workspaceId={workspaceId} />
            <WhatsappSettingsBusinessHours workspaceId={workspaceId} />
            <WhatsappSettingsDistribution workspaceId={workspaceId} />
            <WhatsappSettingsCloseStatuses workspaceId={workspaceId} />
            <WhatsappSettingsSla workspaceId={workspaceId} />
            <WhatsappSettingsCallRecording workspaceId={workspaceId} />
            <WhatsappSettingsPix workspaceId={workspaceId} />
            <WhatsappSettingsBoleto workspaceId={workspaceId} />
            <WhatsappSettingsNumberCheck workspaceId={workspaceId} />
            <WhatsappSettingsArchive workspaceId={workspaceId} />
          </TabsContent>
          <TabsContent value='voice' className='pt-4'>
            <WhatsappSettingsVoiceAgent workspaceId={workspaceId} />
          </TabsContent>
          <TabsContent value='widget' className='pt-4'>
            <WhatsappSettingsWidget workspaceId={workspaceId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
