import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/src/lib/auth'
import { MembershipService } from '@/src/services/membership.service'

// No marketing home: the root sends signed-in users to their workspace and
// everyone else straight to sign-in.
export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) redirect('/sign-in')

  const memberships = await MembershipService.listByUser(session.user.id)
  if (memberships.ok && memberships.value.length > 0) {
    redirect(`/${memberships.value[0].workspace.slug}`)
  }
  redirect('/onboarding')
}
