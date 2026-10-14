import type { Role } from '@prisma/client'
import { WhatsAppTeamSnapshotCache } from '@/src/cache/whatsapp-team.cache'
import { whatsappConversationNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  canSeeConversation,
  scopeFromSnapshot,
  type WhatsAppConversationScope,
  type WhatsAppTeamSnapshot,
} from '@/src/lib/whatsapp/conversation-scope'
import type { WhatsAppRealtimeEvent } from '@/src/lib/whatsapp/realtime'
import {
  createRealtimeScopeFilter,
  createScopeRefresher,
} from '@/src/lib/whatsapp/realtime-scope-filter'
import {
  WhatsAppConversationRepository,
  type WhatsAppConversationWithPreview,
} from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { assertModuleMember } from './authz'

/** How often a live SSE stream re-reads its viewer's scope. */
const REALTIME_SCOPE_TTL_MS = 30_000

/**
 * Resolves the conversation visibility of a viewer (Equipes). Every service
 * that exposes a Comunicação conversation goes through here: the pure rule
 * is `src/lib/whatsapp/conversation-scope.ts`, the inputs are the viewer's
 * workspace role (already loaded by `assertModuleMember`) and the cached team
 * snapshot of the workspace.
 */

/** Team snapshot of the workspace, read through the Redis cache. */
export async function loadWhatsAppTeamSnapshot(
  workspaceId: string,
): Promise<Result<WhatsAppTeamSnapshot[]>> {
  const cached = await WhatsAppTeamSnapshotCache.get(workspaceId)
  if (cached) return ok(cached)

  const fresh = await WhatsAppTeamRepository.listMembershipSnapshot(workspaceId)
  if (!fresh.ok) return fresh
  await WhatsAppTeamSnapshotCache.set(workspaceId, fresh.value)
  return fresh
}

/** Drops the cached snapshot — call after any team write. */
export async function invalidateWhatsAppTeamSnapshot(
  workspaceId: string,
): Promise<void> {
  await WhatsAppTeamSnapshotCache.invalidate(workspaceId)
}

export async function resolveConversationScope(
  userId: string,
  workspaceId: string,
  role: Role,
): Promise<Result<WhatsAppConversationScope>> {
  // The owner never needs the snapshot to see everything — but the DTO of
  // `teams/me` still lists their teams, so resolve it anyway.
  const snapshot = await loadWhatsAppTeamSnapshot(workspaceId)
  if (!snapshot.ok) return snapshot
  return ok(scopeFromSnapshot(userId, role, snapshot.value))
}

/**
 * Loads a Comunicação conversation for a viewer. One the viewer may not see
 * answers exactly like a missing one (404) — its existence is not revealed.
 */
export async function loadVisibleConversation(
  scope: WhatsAppConversationScope,
  workspaceId: string,
  conversationId: string,
): Promise<Result<WhatsAppConversationWithPreview>> {
  const conversation = await WhatsAppConversationRepository.findById(
    conversationId,
    workspaceId,
  )
  if (!conversation.ok) return conversation
  if (!conversation.value || !canSeeConversation(scope, conversation.value)) {
    return err(whatsappConversationNotFound())
  }
  return ok(conversation.value)
}

/** Shortcut for services that only hold the actor and their role. */
export async function loadConversationForViewer(
  viewer: { userId: string; role: Role },
  workspaceId: string,
  conversationId: string,
): Promise<
  Result<{
    scope: WhatsAppConversationScope
    conversation: WhatsAppConversationWithPreview
  }>
> {
  const scope = await resolveConversationScope(
    viewer.userId,
    workspaceId,
    viewer.role,
  )
  if (!scope.ok) return scope
  const conversation = await loadVisibleConversation(
    scope.value,
    workspaceId,
    conversationId,
  )
  if (!conversation.ok) return conversation
  return ok({ scope: scope.value, conversation: conversation.value })
}

/** Members (any role) of a team, from the snapshot. Empty on failure. */
export async function whatsAppTeamMemberIds(
  workspaceId: string,
  teamId: string,
): Promise<string[]> {
  const snapshot = await loadWhatsAppTeamSnapshot(workspaceId)
  if (!snapshot.ok) return []
  const team = snapshot.value.find((candidate) => candidate.id === teamId)
  return team ? team.members.map((member) => member.userId) : []
}

/**
 * Gate + filter of one realtime (SSE) subscriber: module member with
 * `conversations:VIEW`, then a per-connection filter that only forwards the
 * events of conversations the viewer can see (re-reading the scope every
 * 30s, so team/role edits apply without reconnecting).
 */
export async function openWhatsAppRealtimeViewer(
  actorId: string,
  workspaceId: string,
): Promise<
  Result<
    (event: WhatsAppRealtimeEvent) => Promise<WhatsAppRealtimeEvent | null>
  >
> {
  const access = await assertModuleMember(
    actorId,
    workspaceId,
    'COMMUNICATION',
    {
      resource: 'conversations',
      action: 'VIEW',
    },
  )
  if (!access.ok) return access
  const initial = await resolveConversationScope(
    actorId,
    workspaceId,
    access.value.role,
  )
  if (!initial.ok) return initial

  const getScope = createScopeRefresher(
    initial.value,
    async () => {
      const membership = await assertModuleMember(
        actorId,
        workspaceId,
        'COMMUNICATION',
        { resource: 'conversations', action: 'VIEW' },
      )
      if (!membership.ok) {
        // Removed from the workspace/module: stop forwarding; a transient
        // database failure keeps the last scope instead.
        return membership.error.code === 'DATABASE_ERROR'
          ? { ok: false as const }
          : { ok: true as const, value: null }
      }
      const scope = await resolveConversationScope(
        actorId,
        workspaceId,
        membership.value.role,
      )
      return scope.ok
        ? { ok: true as const, value: scope.value }
        : { ok: false as const }
    },
    REALTIME_SCOPE_TTL_MS,
  )

  return ok(
    createRealtimeScopeFilter({
      getScope,
      loadTarget: async (conversationId) => {
        const rows = await WhatsAppConversationRepository.listVisibilityTargets(
          workspaceId,
          [conversationId],
        )
        return rows.ok ? (rows.value[0] ?? null) : null
      },
    }),
  )
}
