import { redirect } from 'next/navigation'
import { ZAP_SETTINGS_SECTIONS } from '@/app/_components/whatsapp/settings/zap-settings-sections'

export default async function ZapSettingsIndex({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  redirect(`/${slug}/zap/configuracoes/${ZAP_SETTINGS_SECTIONS[0].id}`)
}
