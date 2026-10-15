import { redirect } from 'next/navigation'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'
import { SiteStudioService } from '@/src/services/site-studio.service'

/**
 * Old landing page builder link: opens the site it was migrated into, or
 * the Sites list (where the migration banner brings it over).
 */
export default async function CrmLandingPageRedirect({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; id: string }>
}) {
  const { 'workspace-slug': slug, id } = await params
  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (membership.ok && membership.value) {
    const siteId = await SiteStudioService.findMigratedSite(
      session.value.user.id,
      membership.value.workspaceId,
      id,
    )
    if (siteId.ok && siteId.value) {
      redirect(`/${slug}/crm/sites/${siteId.value}`)
    }
  }
  redirect(`/${slug}/crm/sites`)
}
