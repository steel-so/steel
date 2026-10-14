import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { WikiPageEditor } from '@/app/_components/wiki/wiki-page-editor'
import { getAuthSession } from '@/src/lib/auth-session'
import { getWikiPageContext } from '@/src/lib/wiki-context'

export const metadata: Metadata = {
  title: 'Wiki | Steel',
  description: 'Página da base de conhecimento do workspace.',
}

export default async function WikiDetailPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; 'wiki-id': string }>
}) {
  const { 'workspace-slug': workspaceSlug, 'wiki-id': wikiPageId } =
    await params
  const context = await getWikiPageContext(workspaceSlug, wikiPageId)
  if (!context) notFound()
  // The avatar the others see in the page's presence list.
  // TODO(wiki-backend): read it from the wiki context instead.
  const session = await getAuthSession()
  const userImage = session.ok ? (session.value.user.image ?? null) : null

  return (
    <WikiPageEditor
      workspaceId={context.workspaceId}
      workspaceSlug={workspaceSlug}
      userId={context.userId}
      userName={context.userName}
      userImage={userImage}
      page={context.page}
    />
  )
}
