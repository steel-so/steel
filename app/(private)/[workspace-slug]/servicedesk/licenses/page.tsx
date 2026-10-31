import { Key01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdDirectoryShell } from '@/app/_components/servicedesk/directory/sd-directory-shell'
import { SdLicensesView } from '@/app/_components/servicedesk/licenses/sd-licenses-view'

export const metadata: Metadata = {
  title: 'Licenças de software | ServiceDesk | Steel',
  description:
    'Licenças contra o software instalado no inventário, conformidade e avisos de vencimento',
}

export default async function SdLicensesPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const ctx = await loadSdDirectoryContext(slug)
  if (!ctx) notFound()

  return (
    <SdDirectoryShell
      title='Licenças de software'
      icon={Key01Icon}
      isAgent={ctx.isAgent}
    >
      <SdLicensesView
        workspaceId={ctx.workspaceId}
        slug={slug}
        isAdmin={ctx.isAdmin}
      />
    </SdDirectoryShell>
  )
}
