import { redirect } from 'next/navigation'
import { CRM_SETTINGS_SECTIONS } from '@/app/_components/settings/crm-settings-sections'

export default async function CrmSettingsIndex({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  redirect(`/${slug}/crm/settings/${CRM_SETTINGS_SECTIONS[0].id}`)
}
