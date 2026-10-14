import { logger } from '@/lib/axiom/logger'
import { getQueueConnection } from '@/src/lib/queue/connection'

/**
 * Redis pub/sub channel between the app and the realtime server (Hocuspocus)
 * for edit-lock changes. The app publishes after a lock/unlock; the realtime
 * process tells the page's open editors (stateless message) and closes their
 * connections, so they reconnect and `onAuthenticate` hands each one the new
 * permission (read-only or not). See `docs/runbooks/realtime-wiki.md`.
 */
export const WIKI_LOCK_CHANNEL = 'wiki:page-lock'

export interface WikiLockMessage {
  wikiPageId: string
  lockedAt: string | null
}

/**
 * Stateless payload the realtime server broadcasts to the page's editors
 * just before closing their connections (HocuspocusProvider `onStateless`).
 */
export const WIKI_LOCK_STATELESS_TYPE = 'wiki-page-lock-changed'

export function wikiLockStatelessPayload(message: WikiLockMessage): string {
  return JSON.stringify({ type: WIKI_LOCK_STATELESS_TYPE, ...message })
}

export function parseWikiLockMessage(payload: string): WikiLockMessage | null {
  try {
    const value = JSON.parse(payload) as Partial<WikiLockMessage> | null
    if (!value || typeof value.wikiPageId !== 'string') return null
    return {
      wikiPageId: value.wikiPageId,
      lockedAt: typeof value.lockedAt === 'string' ? value.lockedAt : null,
    }
  } catch {
    return null
  }
}

/** Never fails the caller: the lock is saved; editors catch up on reconnect. */
export async function publishWikiLockChange(
  message: WikiLockMessage,
): Promise<void> {
  try {
    await getQueueConnection().publish(
      WIKI_LOCK_CHANNEL,
      JSON.stringify(message),
    )
  } catch (error) {
    logger.error('wiki.lock.publish_failed', {
      component: 'WikiPageService',
      wikiPageId: message.wikiPageId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
