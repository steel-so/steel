import { FireIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdDirectoryShell } from '@/app/_components/servicedesk/directory/sd-directory-shell'
import { SdMajorIncidentDetail } from '@/app/_components/servicedesk/major-incident/sd-major-incident-detail'

export const metadata: Metadata = {
  title: 'Incidente maior | ServiceDesk | Steel',
}

export default async function SdMajorIncidentPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; incidentId: string }>
}) {
  const { 'workspace-slug': slug, incidentId } = await params
  const ctx = await loadSdDirectoryContext(slug)
  if (!ctx) notFound()

  return (
    <SdDirectoryShell
      title='Incidente maior'
      icon={FireIcon}
      isAgent={ctx.isAgent}
    >
      <div className='h-full overflow-y-auto'>
        <SdMajorIncidentDetail
          workspaceId={ctx.workspaceId}
          slug={slug}
          incidentId={incidentId}
        />
      </div>
    </SdDirectoryShell>
  )
}
