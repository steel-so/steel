import { Home01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdHome } from '@/app/_components/servicedesk/home/sd-home'
import { SdPageShell } from '@/app/_components/servicedesk/shell/sd-page-shell'
import { getAuthSession } from '@/src/lib/auth-session'
import { PREFERENCE_COOKIES } from '@/src/lib/preference-cookies'

export const metadata: Metadata = {
  title: 'ServiceDesk | Steel',
  description: 'Minha fila, indicadores e SLA do ServiceDesk',
}

export default async function ServiceDeskPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const ctx = await loadSdDirectoryContext(slug)
  if (!ctx) notFound()
  // Solicitantes (sem departamento) usam o portal.
  if (!ctx.isAgent) redirect(`/${slug}/servicedesk/portal`)
  const session = await getAuthSession()
  const userName = session.ok ? (session.value.user.name ?? '') : ''
  const timeZone = (await cookies()).get(PREFERENCE_COOKIES.timezone)?.value

  return (
    <SdPageShell
      slug={slug}
      title='ServiceDesk'
      icon={Home01Icon}
      isAgent={ctx.isAgent}
    >
      <SdHome
        workspaceId={ctx.workspaceId}
        slug={slug}
        userName={userName}
        timeZone={timeZone}
      />
    </SdPageShell>
  )
}
