/** Digits of a phone as typed or shown ("+55 (11) 91234-5678" → "5511912345678"). */
export function digitsOf(raw: string): string {
  return raw.replace(/\D/g, '')
}

/**
 * Canonical form used to compare phones: digits with the country code (Brazil
 * is assumed for 10 and 11 digit numbers) and without the ninth digit of a
 * Brazilian mobile, so "5511912345678" and "551112345678" are the same line.
 * Returns null when the value cannot be a phone number.
 */
export function canonicalPhone(raw: string): string | null {
  let digits = fullPhone(raw)
  if (!digits) return null
  if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    digits = digits.slice(0, 4) + digits.slice(5)
  }
  return digits
}

export function phonesMatch(a: string, b: string): boolean {
  const left = canonicalPhone(a)
  const right = canonicalPhone(b)
  return left !== null && left === right
}

/** True when the text is only a phone number (WhatsApp shows it for unsaved contacts). */
export function looksLikePhone(text: string): boolean {
  const trimmed = text.trim()
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return false
  const count = digitsOf(trimmed).length
  return count >= 8 && count <= 15
}

/**
 * Digits with the country code; null if not a phone. A number of 10 or 11 digits
 * typed without a leading "+" is taken as Brazilian. (A foreign number of that
 * length read without its "+", such as a US JID, is therefore not recognized.)
 */
export function fullPhone(raw: string): string | null {
  const digits = digitsOf(raw)
  if (digits.length < 8 || digits.length > 15) return null
  const local = (digits.length === 10 || digits.length === 11) && !raw.trim().startsWith('+')
  return local ? `55${digits}` : digits
}

/** `+5511912345678`, the form the CRM stores. */
export function toE164(raw: string): string | null {
  const full = fullPhone(raw)
  return full ? `+${full}` : null
}
