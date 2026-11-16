/** Normalizers for the e-mails and phones the public CNPJ sources return. */

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** Lowercase, trimmed e-mail, or null when it is empty or malformed. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? '').trim().toLowerCase()
  if (!email || email.length > 254) return null
  return EMAIL_RE.test(email) ? email : null
}

/**
 * Brazilian phone as `(11) 2395-8400` / `(11) 99999-0000`. Accepts 10 or 11
 * digits, with or without the `55` country code; null for anything else
 * (empty, too short/long, a single repeated digit, DDD starting with 0).
 */
export function formatBrPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return null
  if (/^(\d)\1+$/.test(d)) return null
  if (d.startsWith('0')) return null
  const ddd = d.slice(0, 2)
  const rest = d.slice(2)
  if (/^(\d)\1+$/.test(rest)) return null
  const cut = rest.length - 4
  return `(${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}`
}

export const normalizePhone = formatBrPhone

/** Splits a string holding several phones on `/`, `,` and `;`. */
export function splitPhones(raw: string | null | undefined): string[] {
  return (raw ?? '').split(/[/,;]/).filter((p) => p.trim() !== '')
}

/** Normalizes and deduplicates (by normalized value), keeping order. */
export function uniqueEmails(raws: Array<string | null | undefined>): string[] {
  return [...new Set(raws.map(normalizeEmail).filter((e): e is string => !!e))]
}

export function uniquePhones(raws: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      raws
        .flatMap((r) => splitPhones(r))
        .map(formatBrPhone)
        .filter((p): p is string => !!p),
    ),
  ]
}
