import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  createPreferencesToken,
  createUnsubscribeToken,
} from '@/src/lib/newsletter/tokens'
import {
  newsletterPreferencesUrl,
  newsletterUnsubscribeUrls,
} from '@/src/lib/newsletter/urls'

/**
 * Pieces shared by the welcome series and the re-engagement e-mails (slice
 * nl2-automation): footer/List-Unsubscribe links, the skip rule and the
 * Resend tags — the same as an issue's, minus the issue recipient.
 */

/** Rows per Resend batch call. */
export const AUTOMATION_BATCH = 100

export type SubscriberLinks = {
  pageUrl: string
  oneClickUrl: string
  preferencesUrl: string
}

/** Unsubscribe page, RFC 8058 one-click and preference center links. */
export function subscriberLinks(
  workspaceId: string,
  subscriber: { subscriberId: string; email: string },
): SubscriberLinks {
  const unsubscribe = newsletterUnsubscribeUrls(
    BETTER_AUTH_URL,
    createUnsubscribeToken({ subscriberId: subscriber.subscriberId }),
  )
  return {
    ...unsubscribe,
    preferencesUrl: newsletterPreferencesUrl(
      BETTER_AUTH_URL,
      createPreferencesToken({ workspaceId, email: subscriber.email }),
    ),
  }
}

/** Why a claimed row must not be sent (or `null`). */
export function automationSkipReason(
  row: { email: string; subscriberStatus: string },
  optedOut: Set<string>,
): string | null {
  if (optedOut.has(row.email.toLowerCase())) return 'OPTED_OUT'
  switch (row.subscriberStatus) {
    case 'ACTIVE':
      return null
    case 'BOUNCED':
      return 'BOUNCED'
    case 'COMPLAINED':
      return 'COMPLAINED'
    default:
      return 'UNSUBSCRIBED'
  }
}

/** Resend tags (ASCII letters, digits, `_` and `-` only). */
export function automationTags(
  kind: 'welcome' | 'reengagement',
  id: string,
): { name: string; value: string }[] {
  return [
    { name: 'kind', value: 'newsletter' },
    { name: kind, value: id.replace(/[^A-Za-z0-9_-]/g, '_') },
  ]
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
