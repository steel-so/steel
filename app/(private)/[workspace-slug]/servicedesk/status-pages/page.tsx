import { Megaphone01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdDirectoryShell } from '@/app/_components/servicedesk/directory/sd-directory-shell'
import { SdStatusPagesView } from '@/app/_components/servicedesk/major-incident/sd-status-pages-view'

export const metadata: Metadata = {
  title: 'Páginas de status | ServiceDesk | Steel',
  description:
    'Páginas de status públicas por cliente ou serviço, com avisos por e-mail e WhatsApp',
}

export default async function SdStatusPagesPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const ctx = await loadSdDirectoryContext(slug)
  if (!ctx) notFound()

  return (
    <SdDirectoryShell
      title='Páginas de status'
      icon={Megaphone01Icon}
      isAgent={ctx.isAgent}
    >
      <div className='h-full overflow-y-auto'>
        <SdStatusPagesView workspaceId={ctx.workspaceId} slug={slug} />
      </div>
    </SdDirectoryShell>
  )
}
