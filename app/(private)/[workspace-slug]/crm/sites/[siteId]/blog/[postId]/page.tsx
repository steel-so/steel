import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PostEditor } from '@/app/_components/crm/sites/blog/post-editor'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Editor do post | Sites | CRM | Steel',
  description: 'Editor dos posts do blog dos sites do CRM',
}

type Props = {
  params: Promise<{ 'workspace-slug': string; siteId: string; postId: string }>
}

/** Post editor of a site's blog, full screen (no CRM navigation). */
export default async function SitePostEditorPage({ params }: Props) {
  const { 'workspace-slug': slug, siteId, postId } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <FocusedScreen label='Editor do post'>
      <div className='min-h-0 flex-1'>
        <PostEditor
          workspaceId={membership.value.workspaceId}
          slug={slug}
          siteId={siteId}
          postId={postId}
          userId={session.value.user.id}
          userName={session.value.user.name}
        />
      </div>
    </FocusedScreen>
  )
}
