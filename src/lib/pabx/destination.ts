/**
 * The PABX dials the national number (area code + subscriber), the same way an
 * extension dials out. WhatsApp ids carry the Brazilian country code, so `55`
 * is dropped from 12/13-digit numbers; anything else is kept as is.
 */
export function toPabxDestination(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13))
    return digits.slice(2)
  return digits
}

/**
 * Number an extension dials from the browser: outside-line prefix `0` + the
 * national number (the tenant routes `_0ZZ9XXXXXXXX`, `_0ZZ[2-6]XXXXXXX`, …).
 */
export function toDialedNumber(phone: string): string {
  const national = toPabxDestination(phone)
  return national.startsWith('0') ? national : `0${national}`
}
