import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CollectionItemsScreen } from '@/app/_components/crm/sites/blog/collection-items'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Itens da coleção | Sites | CRM | Steel',
  description: 'Itens das coleções dos sites do CRM',
}

type Props = {
  params: Promise<{
    'workspace-slug': string
    siteId: string
    collectionId: string
  }>
}

/** Items of a site collection (cases, equipe, vagas…). */
export default async function SiteCollectionItemsPage({ params }: Props) {
  const { 'workspace-slug': slug, siteId, collectionId } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <FocusedScreen label='Itens da coleção'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <CollectionItemsScreen
          workspaceId={membership.value.workspaceId}
          slug={slug}
          siteId={siteId}
          collectionId={collectionId}
        />
      </div>
    </FocusedScreen>
  )
}
