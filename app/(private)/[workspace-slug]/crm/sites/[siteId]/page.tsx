import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { SiteEditor } from '@/app/_components/crm/sites/site-editor'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Editor do site | CRM | Steel',
  description: 'Editor visual dos sites do CRM',
}

type Props = {
  params: Promise<{ 'workspace-slug': string; siteId: string }>
  searchParams: Promise<{ page?: string }>
}

/** Site editor in a focused full-screen layout (no CRM navigation). */
export default async function CrmSiteEditorPage({
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
    <FocusedScreen
      label='Editor do site'
      mobileBack={{ href: `/${slug}/crm/sites`, label: 'Voltar para os sites' }}
    >
      <div className='min-h-0 flex-1'>
        <SiteEditor
          workspaceId={membership.value.workspaceId}
          slug={slug}
          siteId={siteId}
          initialPageId={typeof page === 'string' ? page : undefined}
          collabUser={{
            id: session.value.user.id,
            name: session.value.user.name || session.value.user.email,
            image: session.value.user.image ?? null,
          }}
        />
      </div>
    </FocusedScreen>
  )
}
