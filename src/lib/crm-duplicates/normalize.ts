/**
 * Normalisation helpers of the duplicate detector (C7). Pure functions: the
 * detector compares keys, never raw strings, so "ACME Ltda." and "acme" or
 * "(11) 98765-4321" and "+55 11 8765 4321" meet on the same key.
 */

const LEGAL_SUFFIXES = new Set([
  'ltda',
  'me',
  'epp',
  'eireli',
  'sa',
  'ss',
  'cia',
  'mei',
  'slu',
  'inc',
  'llc',
])

const GENERIC_LOCAL_PARTS = new Set([
  'contato',
  'contact',
  'info',
  'vendas',
  'comercial',
  'financeiro',
  'atendimento',
  'suporte',
  'sac',
  'admin',
  'ola',
  'hello',
  'noreply',
  'no-reply',
  'recepcao',
  'rh',
  'compras',
])

/** Lower case, no diacritics, only letters/digits separated by one space. */
export function normalizeName(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Company name without the legal form ("Acme Ltda" -> "acme"). */
export function normalizeCompanyName(value: string | null | undefined): string {
  const tokens = normalizeName(value)
    .replace(/\bs a\b/g, 'sa')
    .split(' ')
    .filter((token) => token && !LEGAL_SUFFIXES.has(token))
  return tokens.join(' ')
}

/** Tokens in alphabetical order, so "Silva Maria" meets "Maria Silva". */
export function sortedTokens(normalized: string): string {
  return normalized.split(' ').filter(Boolean).sort().join(' ')
}

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/** A valid-looking CNPJ (14 digits, not all equal) or `null`. */
export function cnpjKey(value: string | null | undefined): string | null {
  const digits = onlyDigits(value)
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return null
  return digits
}

/** Lower-cased host without protocol, `www.`, path or port. */
export function domainKey(value: string | null | undefined): string | null {
  if (!value) return null
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0]
  return host && host.includes('.') ? host : null
}

export function emailKey(value: string | null | undefined): string | null {
  const email = (value ?? '').trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null
}

/** `contato@`, `vendas@`... are shared mailboxes: a weak signal. */
export function isGenericEmail(email: string): boolean {
  const local = email.split('@')[0] ?? ''
  return GENERIC_LOCAL_PARTS.has(local)
}

/**
 * Comparable phone key: area code + the last 8 digits, so the national
 * number with or without the country code and the old/new ninth digit all
 * meet. Numbers shorter than 8 digits are not comparable (`null`).
 */
export function phoneKey(value: string | null | undefined): string | null {
  let digits = onlyDigits(value).replace(/^0+/, '')
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length < 8) return null
  const last8 = digits.slice(-8)
  if (/^(\d)\1+$/.test(last8)) return null
  if (digits.length < 10) return last8
  const national = digits.slice(digits.length >= 11 ? -11 : -10)
  return `${national.slice(0, 2)}${last8}`
}

function bigrams(text: string): Map<string, number> {
  const padded = ` ${text} `
  const map = new Map<string, number>()
  for (let i = 0; i < padded.length - 1; i++) {
    const gram = padded.slice(i, i + 2)
    map.set(gram, (map.get(gram) ?? 0) + 1)
  }
  return map
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const left = bigrams(a)
  const right = bigrams(b)
  let overlap = 0
  let total = 0
  for (const count of left.values()) total += count
  for (const count of right.values()) total += count
  for (const [gram, count] of left) {
    overlap += Math.min(count, right.get(gram) ?? 0)
  }
  return total === 0 ? 0 : (2 * overlap) / total
}

/** Name similarity, insensitive to token order. */
export function nameSimilarity(a: string, b: string): number {
  return diceSimilarity(sortedTokens(a), sortedTokens(b))
}
