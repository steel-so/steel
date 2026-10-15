import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { SitePreview } from '@/app/_components/crm/sites/site-preview'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Prévia do site | CRM | Steel',
  description: 'Rascunho do site como o visitante vai ver',
  robots: { index: false, follow: false },
}

type Props = {
  params: Promise<{ 'workspace-slug': string; siteId: string }>
  searchParams: Promise<{ page?: string }>
}

/** Draft preview: the unpublished site rendered like the public one. */
export default async function CrmSitePreviewPage({
  params,
  searchParams,
}: Props) {
  const [{ 'workspace-slug': slug, siteId }, { page }] = await Promise.all([
    params,
    searchParams,
  ])

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <FocusedScreen label='Prévia do site'>
      <SitePreview
        workspaceId={membership.value.workspaceId}
        slug={slug}
        siteId={siteId}
        initialPageId={typeof page === 'string' ? page : undefined}
      />
    </FocusedScreen>
  )
}
