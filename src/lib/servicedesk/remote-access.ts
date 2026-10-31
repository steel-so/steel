/**
 * Remote access (S4): provider catalogue and link building. Pure, no I/O.
 *
 * Only the public machine ID is handled. No password or unattended-access
 * secret is stored or put in a link: the technician authenticates inside the
 * RustDesk/AnyDesk client, which keeps its own address book.
 */

export type SdRemoteProviderKey = 'RUSTDESK' | 'ANYDESK'

export const SD_REMOTE_PROVIDERS: Record<
  SdRemoteProviderKey,
  { label: string; defaultTemplate: string; idHint: string }
> = {
  RUSTDESK: {
    label: 'RustDesk',
    defaultTemplate: 'rustdesk://connection/new/{id}',
    idHint:
      'ID de 9 dígitos do RustDesk (ou o nome do host, se usar servidor próprio)',
  },
  ANYDESK: {
    label: 'AnyDesk',
    defaultTemplate: 'anydesk:{id}',
    idHint: 'Número do AnyDesk (9 a 10 dígitos) ou alias@ad',
  },
}

/** Schemes a custom link template may use; anything else could run code in the browser. */
const ALLOWED_TEMPLATE_SCHEMES = ['rustdesk', 'anydesk', 'https']

/** Machine IDs: digits, letters and a few separators (alias@ad, host.name). */
const REMOTE_ID_PATTERN = /^[A-Za-z0-9._@-]{4,64}$/

export function isValidRemoteId(value: string): boolean {
  return REMOTE_ID_PATTERN.test(value)
}

/** Strips the spaces and dashes people paste along with a numeric ID ("123 456 789"). */
export function normalizeRemoteId(raw: string): string {
  const trimmed = raw.trim()
  const compact = trimmed.replace(/[\s-]/g, '')
  return /^\d+$/.test(compact) ? compact : trimmed
}

export function validateLinkTemplate(template: string): string | null {
  if (!template.includes('{id}')) return 'O modelo precisa conter {id}'
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(template)?.[1]?.toLowerCase()
  if (!scheme || !ALLOWED_TEMPLATE_SCHEMES.includes(scheme)) {
    return 'Use um link rustdesk://, anydesk: ou https://'
  }
  return null
}

export function buildRemoteLink(
  provider: SdRemoteProviderKey,
  remoteId: string,
  template?: string | null,
): string {
  const chosen =
    template && validateLinkTemplate(template) === null
      ? template
      : SD_REMOTE_PROVIDERS[provider].defaultTemplate
  return chosen.replace('{id}', encodeURIComponent(remoteId))
}
