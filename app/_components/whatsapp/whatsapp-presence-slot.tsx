import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'
import { WhatsappPresenceToggle } from './whatsapp-presence-toggle'

/**
 * Server wrapper that resolves the workspace id from the slug so the zap
 * sidebar (a server layout) can render the client presence toggle.
 */
export async function WhatsappPresenceSlot({ slug }: { slug: string }) {
  const session = await getAuthSession()
  if (!session.ok) return null
  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) return null
  return <WhatsappPresenceToggle workspaceId={membership.value.workspaceId} />
}
