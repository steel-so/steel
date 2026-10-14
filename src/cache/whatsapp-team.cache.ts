import type { WhatsAppTeamSnapshot } from '@/src/lib/whatsapp/conversation-scope'
import { createKeyedCache } from './_cache'

/**
 * Team membership of a workspace (who leads/belongs to which team), the input
 * of the conversation visibility rule — read on every conversation request,
 * so it is cached. Invalidated by every team write (`WhatsAppTeamService`);
 * the 5-min TTL covers anything else (a user deleted, a cascade).
 */
export const WhatsAppTeamSnapshotCache = createKeyedCache<
  WhatsAppTeamSnapshot[]
>({
  prefix: 'whatsapp-team-snapshot:',
  ttl: 5 * 60,
  name: 'whatsapp_team_snapshot',
})
