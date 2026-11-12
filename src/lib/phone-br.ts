/**
 * Brazilian phone handling. Users type DDD + number; the country code (55)
 * is added on our side when the value is stored and hidden when displayed.
 */

const digitsOnly = (value: string): string => value.replace(/\D/g, '')

/** Storage form (digits with 55): `(11) 98888-7777` → `5511988887777`. Empty → null. */
export function toStoredPhone(value: string | null | undefined): string | null {
  const digits = digitsOnly(value ?? '')
  if (!digits) return null
  // An explicit `+` means the user typed the country code: keep it.
  if (value?.trim().startsWith('+')) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

/** What the user sees and edits: no 55, progressive mask `(11) 98888-7777`. */
export function toDisplayPhone(value: string | null | undefined): string {
  let digits = digitsOnly(value ?? '')
  if (
    digits.startsWith('55') &&
    (digits.length === 12 || digits.length === 13)
  ) {
    digits = digits.slice(2)
  }
  if (digits.length > 11) return `+${digits.slice(0, 15)}`
  let out = ''
  if (digits.length > 0) out = `(${digits.slice(0, 2)}`
  if (digits.length >= 2) out += ') '
  if (digits.length > 2) {
    const cut = digits.length > 10 ? 7 : 6
    out += digits.slice(2, cut)
    if (digits.length > cut) out += `-${digits.slice(cut)}`
  }
  return out
}
