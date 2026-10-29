import { AiMagicIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SdAiComparisonPanel } from '@/app/_components/servicedesk/ai-comparison/sd-ai-comparison-panel'
import { loadSdDirectoryContext } from '@/app/_components/servicedesk/directory/sd-directory-context'
import { SdPageShell } from '@/app/_components/servicedesk/shell/sd-page-shell'

export const metadata: Metadata = {
  title: 'IA vs. técnico | ServiceDesk | Steel',
  description:
    'Compara o que a IA sugeriu com o que o técnico fez no ServiceDesk',
}

export default async function SdAiComparisonPage({
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
      title='IA vs. técnico'
      icon={AiMagicIcon}
      isAgent={ctx.isAgent}
    >
      <SdAiComparisonPanel workspaceId={ctx.workspaceId} slug={slug} />
    </SdPageShell>
  )
}
