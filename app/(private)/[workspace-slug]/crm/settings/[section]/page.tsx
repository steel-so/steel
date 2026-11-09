import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CRM_SETTINGS_SECTIONS } from '@/app/_components/settings/crm-settings-sections'
import { SettingsPageFrame } from '@/app/_components/settings/settings-page-frame'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Configurações do CRM | Steel',
  description:
    'Pipelines, campos, regras do funil, perfis e privacidade do CRM',
}

export default async function CrmSettingsSectionPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; section: string }>
}) {
  const { 'workspace-slug': slug, section: sectionId } = await params
  const section = CRM_SETTINGS_SECTIONS.find((s) => s.id === sectionId)
  if (!section) notFound()

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <SettingsPageFrame
      title={section.label}
      description={section.description}
      icon={section.icon}
    >
      {section.render(membership.value.workspaceId)}
    </SettingsPageFrame>
  )
}
