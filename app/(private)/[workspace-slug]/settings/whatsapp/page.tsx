import { WhatsappIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { SettingsPageFrame } from '@/app/_components/settings/settings-page-frame'
import { WhatsappSettingsConnections } from '@/app/_components/whatsapp/settings/whatsapp-settings-connections'
import { WhatsappSettingsMetaChannels } from '@/app/_components/whatsapp/settings/whatsapp-settings-meta-channels'
import { getAuthSession } from '@/src/lib/auth-session'
import { hasModuleAccess } from '@/src/lib/module-access-guard'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'WhatsApp | Integrações | Steel',
  description:
    'Conexões do WhatsApp (Meta Cloud API e Z-API) usadas pela Comunicação.',
}

export default async function SettingsWhatsappPage({
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
    <SettingsPageFrame
      title='WhatsApp'
      description='Conexões do WhatsApp (Meta Cloud API e Z-API) usadas pela Comunicação.'
      icon={WhatsappIcon}
    >
      <>
        <WhatsappSettingsConnections
          workspaceId={membership.value.workspaceId}
        />
        <WhatsappSettingsMetaChannels
          workspaceId={membership.value.workspaceId}
        />
      </>
    </SettingsPageFrame>
  )
}
