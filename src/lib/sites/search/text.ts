/**
 * Text helpers of the "Buscadores" checks (pt-BR first). Pure.
 */

/** Lower case, no accents, single spaces. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Words of a text (letters/digits runs, accents kept). */
export function wordsOf(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? []
}

export function countWords(value: string): number {
  return wordsOf(value).length
}

/** Sentences of a text (split on `.`, `!`, `?` followed by a space). */
export function sentencesOf(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/** Words that open a question in Portuguese (and a few in English). */
const QUESTION_OPENERS = [
  'como',
  'o que',
  'oque',
  'qual',
  'quais',
  'quando',
  'onde',
  'por que',
  'porque',
  'pra que',
  'para que',
  'quem',
  'quanto',
  'quanta',
  'quantos',
  'quantas',
  'posso',
  'pode',
  'podem',
  'devo',
  'e possivel',
  'vale a pena',
  'existe',
  'tem como',
  'what',
  'how',
  'why',
  'when',
  'where',
  'which',
  'who',
  'can',
  'is',
  'does',
]

/** A heading that asks something (`?` or a question opener). */
export function isQuestion(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.endsWith('?')) return true
  const normalized = normalizeText(trimmed)
  return QUESTION_OPENERS.some(
    (opener) =>
      normalized === opener ||
      normalized.startsWith(`${opener} `) ||
      normalized.startsWith(`${opener},`),
  )
}

/** Escapes a value for a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Occurrences of `term` as whole words in `value` (accent-insensitive). */
export function countTerm(value: string, term: string): number {
  const needle = normalizeText(term)
  if (!needle) return 0
  const haystack = normalizeText(value)
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(?=$|[^\\p{L}\\p{N}])`,
    'gu',
  )
  return haystack.match(pattern)?.length ?? 0
}

/** Whether any of `terms` appears in `value`. */
export function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => countTerm(value, term) > 0)
}

/** URL slug form of a phrase (`Implante dentário` → `implante-dentario`). */
export function slugForm(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Truncates on a word boundary with an ellipsis (`max` includes it). */
export function truncateWords(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, Math.max(1, max - 1))
  // Ends at a word boundary already, or back to the last space.
  const space = clean[cut.length] === ' ' ? cut.length : cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}

/** Sentences that state a checkable fact: a number, a percentage, a year,
 * a currency amount or a date. */
export function isFactual(sentence: string): boolean {
  return /\d/.test(sentence)
}
