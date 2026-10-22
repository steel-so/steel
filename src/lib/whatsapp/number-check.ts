// "Tem zap?" helpers shared by the service, the import steps and the UI.
// Pure module: safe to import from the browser.

/** Lists up to this size are validated inline (no background job). */
export const NUMBER_CHECK_INLINE_MAX = 200
/** "Validate everything" is capped, to keep one run bounded. */
export const NUMBER_CHECK_MAX_CONTACTS = 20_000
export const NUMBER_CHECK_DEFAULT_TTL_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whether the contact must be asked to Z-API again: never checked, checked
 * longer ago than the workspace TTL, or the caller forced a fresh check.
 */
export function needsWhatsappCheck(
  contact: { whatsappCheckedAt: Date | null; hasWhatsapp: boolean | null },
  options: { ttlDays: number; now: Date; force: boolean },
): boolean {
  if (options.force) return true
  if (contact.hasWhatsapp === null || !contact.whatsappCheckedAt) return true
  return (
    options.now.getTime() - contact.whatsappCheckedAt.getTime() >=
    options.ttlDays * DAY_MS
  )
}

/** Masks a phone for logs and audit trails (LGPD): `5511****`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length <= 4 ? '****' : `${digits.slice(0, 4)}****`
}

export type WhatsappBadgeState = 'yes' | 'no' | 'unknown'

export function whatsappBadgeState(
  hasWhatsapp: boolean | null,
): WhatsappBadgeState {
  if (hasWhatsapp === true) return 'yes'
  if (hasWhatsapp === false) return 'no'
  return 'unknown'
}

export const WHATSAPP_BADGE_LABEL: Record<WhatsappBadgeState, string> = {
  yes: 'Tem WhatsApp',
  no: 'Sem WhatsApp',
  unknown: 'Não verificado',
}
