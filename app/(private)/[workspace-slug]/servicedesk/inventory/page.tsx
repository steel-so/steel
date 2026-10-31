import { HardDriveIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdDirectoryShell } from '@/app/_components/servicedesk/directory/sd-directory-shell'
import { SdInventoryView } from '@/app/_components/servicedesk/inventory/sd-inventory-view'

export const metadata: Metadata = {
  title: 'Inventário | ServiceDesk | Steel',
  description:
    'Equipamentos descobertos pela varredura SNMP e por ping/ARP, com hardware, software e alertas',
}

export default async function SdInventoryPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const ctx = await loadSdDirectoryContext(slug)
  if (!ctx) notFound()

  return (
    <SdDirectoryShell
      title='Inventário'
      icon={HardDriveIcon}
      isAgent={ctx.isAgent}
    >
      <SdInventoryView
        workspaceId={ctx.workspaceId}
        slug={slug}
        isAdmin={ctx.isAdmin}
      />
    </SdDirectoryShell>
  )
}
