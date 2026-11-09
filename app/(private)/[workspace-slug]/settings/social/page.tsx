import { Share08Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CrmSocialConnectionsSection } from '@/app/_components/crm/crm-social-panel'
import { SettingsPageFrame } from '@/app/_components/settings/settings-page-frame'
import { getAuthSession } from '@/src/lib/auth-session'
import { hasModuleAccess } from '@/src/lib/module-access-guard'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Redes sociais | Integrações | Steel',
  description:
    'Facebook, Instagram, TikTok, YouTube, Google Ads e Analytics usados pelo CRM.',
}

export default async function SettingsSocialPage({
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
  if (!(await hasModuleAccess(slug, 'CRM'))) notFound()

  return (
    <SettingsPageFrame
      title='Redes sociais'
      description='Facebook, Instagram, TikTok, YouTube, Google Ads e Analytics usados pelo CRM.'
      icon={Share08Icon}
    >
      <CrmSocialConnectionsSection workspaceId={membership.value.workspaceId} />
    </SettingsPageFrame>
  )
}
