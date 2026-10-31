import { notificationKindInfo } from '@/src/lib/notification-kind'

/**
 * Notification kinds that also go out as Web Push (E4): a new conversation
 * for a human, an SLA about to breach, a pending approval and an assigned
 * lead. They reuse the existing `NotificationKind` values, so the mute
 * preferences (`NotificationPreference`, ServiceDesk preferences) already
 * applied by `NotificationService.notifyUsers` are honoured by construction.
 */
export const PUSH_NOTIFICATION_KINDS: readonly string[] = [
  // New conversation reaching a person
  'WHATSAPP_CONVERSATION_ASSIGNED',
  'WHATSAPP_AI_HANDOFF',
  'WHATSAPP_CONVERSATION_UNATTENDED',
  // SLA about to breach
  'SD_SLA_AT_RISK',
  'SD_SLA_BREACH_PREDICTED',
  'WHATSAPP_SLA_AT_RISK',
  // Pending approval
  'SD_APPROVAL_REQUESTED',
  // Assigned lead
  'CRM_LEAD_ASSIGNED',
]

export function isPushNotificationKind(kind: string): boolean {
  return PUSH_NOTIFICATION_KINDS.includes(kind)
}

export interface PushMessage {
  /** Short, fixed pt-BR title derived from the kind (never record content). */
  title: string
  /** Fixed generic body: the details stay inside the app. */
  body: string
  /** Internal path opened on click. */
  url: string
  /** Collapse tag. */
  tag: string
}

const GENERIC_BODY = 'Toque para abrir no Steel.'

/** Only same-app paths are accepted as click targets. */
export function safePushUrl(href: string | null | undefined): string {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return '/'
  return href
}

/**
 * The payload never carries the notification's own title/body (customer names,
 * ticket subjects, message text): only the kind label and a generic line.
 */
export function buildPushMessage(
  kind: string,
  href: string | null | undefined,
): PushMessage {
  const info = notificationKindInfo(kind)
  return {
    title: `${info.moduleLabel}: ${info.label}`.slice(0, 80),
    body: GENERIC_BODY,
    url: safePushUrl(href),
    tag: kind,
  }
}
