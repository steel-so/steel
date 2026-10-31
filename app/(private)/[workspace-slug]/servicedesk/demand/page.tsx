import { UserGroupIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdPageShell } from '@/app/_components/servicedesk/shell/sd-page-shell'
import { SdWfmView } from '@/app/_components/servicedesk/wfm/sd-wfm-view'

export const metadata: Metadata = {
  title: 'Demanda e escala | ServiceDesk | Steel',
  description:
    'Previsão de volume de chamados e dimensionamento da equipe por turno',
}

export default async function SdDemandPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const ctx = await loadSdDirectoryContext(slug)
  if (!ctx) notFound()

  return (
    <SdPageShell
      slug={slug}
      title='Demanda e escala'
      icon={UserGroupIcon}
      isAgent={ctx.isAgent}
    >
      <SdWfmView workspaceId={ctx.workspaceId} isAdmin={ctx.isAdmin} />
    </SdPageShell>
  )
}
