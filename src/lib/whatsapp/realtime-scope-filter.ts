import {
  type ConversationVisibilityTarget,
  canSeeConversation,
  type WhatsAppConversationScope,
} from './conversation-scope'
import type { WhatsAppRealtimeEvent } from './realtime'

/**
 * Per-subscriber filter of the Comunicação realtime stream (Equipes): the
 * workspace channel carries every conversation event, and each SSE
 * connection only forwards the ones its viewer can see.
 *
 * - `conversation.updated` of a conversation the viewer no longer sees turns
 *   into a `conversation.deleted` (once) so the client drops it from the
 *   list — only the id leaves, never the contact;
 * - message and phone-call events are checked against the conversation's
 *   assignee/team — remembered from the `conversation.updated` events that
 *   flow through, loaded from the database on a miss;
 * - unscoped viewers (owner, admin outside any team) get everything without
 *   a single lookup.
 */

export interface RealtimeScopeFilterDeps {
  /** Current scope of the viewer; `null` = lost access (drop everything). */
  getScope: () => Promise<WhatsAppConversationScope | null>
  /** Assignee/team of a conversation; `null` when it does not exist. */
  loadTarget: (
    conversationId: string,
  ) => Promise<ConversationVisibilityTarget | null>
  /** Remembered conversations before the memory is reset. */
  maxEntries?: number
}

const DEFAULT_MAX_ENTRIES = 2000

export function createRealtimeScopeFilter(deps: RealtimeScopeFilterDeps) {
  const maxEntries = deps.maxEntries ?? DEFAULT_MAX_ENTRIES
  const known = new Map<string, ConversationVisibilityTarget>()
  const hidden = new Set<string>()

  function remember(id: string, target: ConversationVisibilityTarget) {
    if (known.size >= maxEntries) known.clear()
    known.set(id, target)
  }

  async function targetOf(
    conversationId: string,
  ): Promise<ConversationVisibilityTarget | null> {
    const cached = known.get(conversationId)
    if (cached) return cached
    // A miss (or a failed lookup) is not remembered: the next event retries.
    const target = await deps.loadTarget(conversationId)
    if (target) remember(conversationId, target)
    return target
  }

  async function visible(
    scope: WhatsAppConversationScope,
    conversationId: string,
  ): Promise<boolean> {
    const target = await targetOf(conversationId)
    return target !== null && canSeeConversation(scope, target)
  }

  return async function filter(
    event: WhatsAppRealtimeEvent,
  ): Promise<WhatsAppRealtimeEvent | null> {
    const scope = await deps.getScope()
    if (!scope) return null

    switch (event.type) {
      case 'conversation.updated': {
        const { id, assignedUserId, teamId } = event.conversation
        remember(id, { assignedUserId, teamId })
        if (canSeeConversation(scope, { assignedUserId, teamId })) {
          hidden.delete(id)
          return event
        }
        if (hidden.has(id)) return null
        hidden.add(id)
        return { type: 'conversation.deleted', conversationId: id }
      }
      case 'conversation.deleted':
        known.delete(event.conversationId)
        return event
      case 'message.created':
      case 'message.updated':
      case 'message.deleted':
        if (scope.mode === 'ALL') return event
        return (await visible(scope, event.conversationId)) ? event : null
      case 'phone-call.updated':
        if (scope.mode === 'ALL') return event
        // A browser phone call with no conversation belongs to who made it.
        if (!event.call.conversationId)
          return event.call.userId === scope.userId ? event : null
        return (await visible(scope, event.call.conversationId)) ? event : null
      default:
        // Group messages are not conversations (no Equipes rule).
        return event
    }
  }
}

/**
 * Re-resolves the viewer's scope at most every `ttlMs` (team or role edits
 * reach a live stream without reconnecting). A failed refresh keeps the last
 * scope; `null` from the loader (no longer a member) is final until the next
 * refresh.
 */
export function createScopeRefresher(
  initial: WhatsAppConversationScope,
  load: () => Promise<
    { ok: true; value: WhatsAppConversationScope | null } | { ok: false }
  >,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<WhatsAppConversationScope | null> {
  let scope: WhatsAppConversationScope | null = initial
  let resolvedAt = now()
  return async () => {
    if (now() - resolvedAt < ttlMs) return scope
    resolvedAt = now()
    const fresh = await load()
    if (fresh.ok) scope = fresh.value
    return scope
  }
}
