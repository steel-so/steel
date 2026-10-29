import { FireIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdDirectoryShell } from '@/app/_components/servicedesk/directory/sd-directory-shell'
import { SdMajorIncidentsView } from '@/app/_components/servicedesk/major-incident/sd-major-incidents-view'

export const metadata: Metadata = {
  title: 'Incidentes maiores | ServiceDesk | Steel',
  description:
    'Incidentes maiores em andamento, com os chamados filhos e as páginas de status dos clientes',
}

export default async function SdMajorIncidentsPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const ctx = await loadSdDirectoryContext(slug)
  if (!ctx) notFound()

  return (
    <SdDirectoryShell
      title='Incidentes maiores'
      icon={FireIcon}
      isAgent={ctx.isAgent}
    >
      <div className='h-full overflow-y-auto'>
        <SdMajorIncidentsView workspaceId={ctx.workspaceId} slug={slug} />
      </div>
    </SdDirectoryShell>
  )
}
