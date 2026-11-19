import { getActiveFlagKeys } from '@/src/lib/platform-flags'
import type { Result } from '@/src/lib/result'
import { ok } from '@/src/lib/result'
import { assertMember } from './authz'

/** Flags da plataforma ativas para o workspace do membro (uso no cliente). */
export const PlatformFlagService = {
  async listActiveForMember(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<string[]>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const keys = await getActiveFlagKeys(workspaceId)
    if (!keys.ok) return keys
    return ok(keys.value)
  },
}
