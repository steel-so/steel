/**
 * Reversible masking of personal data before a prompt leaves for the AI
 * provider (ADR 0041). Each value becomes a placeholder like `[CPF_1]`; the
 * vault keeps the mapping for the duration of one prepared call, so the same
 * value always gets the same placeholder across the rounds of a tool loop
 * and the answer is unmasked before anyone (user, tool, customer) sees it.
 *
 * Detection is deliberately strict where a false positive would hurt
 * (CPF/CNPJ check digits, Luhn for cards) and loose where over-masking is
 * harmless (phones). Values never leave the vault: logs and audit only get
 * the counts.
 */

export const PII_KINDS = ['EMAIL', 'CNPJ', 'CPF', 'CARD', 'PHONE'] as const
export type PiiKind = (typeof PII_KINDS)[number]

export type PiiCounts = Record<PiiKind, number>

export function emptyPiiCounts(): PiiCounts {
  return { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 }
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '')
}

function allSameDigit(digits: string): boolean {
  return /^(\d)\1+$/.test(digits)
}

export function isValidCpf(value: string): boolean {
  const d = digitsOf(value)
  if (d.length !== 11 || allSameDigit(d)) return false
  const check = (length: number) => {
    let sum = 0
    for (let i = 0; i < length; i++) sum += Number(d[i]) * (length + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return check(9) === Number(d[9]) && check(10) === Number(d[10])
}

export function isValidCnpj(value: string): boolean {
  const d = digitsOf(value)
  if (d.length !== 14 || allSameDigit(d)) return false
  const check = (length: number) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let sum = 0
    for (let i = 0; i < length; i++) sum += Number(d[i]) * weights[i]
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  return check(12) === Number(d[12]) && check(13) === Number(d[13])
}

export function passesLuhn(value: string): boolean {
  const d = digitsOf(value)
  if (d.length < 13 || d.length > 19 || allSameDigit(d)) return false
  let sum = 0
  let double = false
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i])
    if (double) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    double = !double
  }
  return sum % 10 === 0
}

interface Detector {
  kind: PiiKind
  pattern: RegExp
  accept?: (match: string) => boolean
  /** Same value written differently (dots, spaces) maps to one placeholder. */
  normalize: (match: string) => string
}

// Order matters: e-mails first (they may contain digits), then the longer
// document numbers, cards, and phones last (the loosest shape).
const DETECTORS: Detector[] = [
  {
    kind: 'EMAIL',
    pattern:
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    normalize: (m) => m.toLowerCase(),
  },
  {
    kind: 'CNPJ',
    pattern: /(?<![\w.])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\w])/g,
    accept: isValidCnpj,
    normalize: digitsOf,
  },
  {
    kind: 'CPF',
    pattern: /(?<![\w.])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\w])/g,
    accept: isValidCpf,
    normalize: digitsOf,
  },
  {
    kind: 'CARD',
    pattern: /(?<![\w])\d(?:[ -]?\d){12,18}(?![\w])/g,
    accept: passesLuhn,
    normalize: digitsOf,
  },
  {
    kind: 'PHONE',
    pattern:
      /(?<![\w+])(?:\+?55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?9?\d{4}[\s.-]?\d{4}(?![\w])/g,
    normalize: (m) => digitsOf(m).replace(/^55(?=\d{10,11}$)/, ''),
  },
]

const PLACEHOLDER = /\[(EMAIL|CNPJ|CPF|CARD|PHONE)_(\d+)\]/g

/** Longest placeholder the stream unmasker must be able to hold back. */
export const PII_PLACEHOLDER_MAX_LENGTH = 16

export interface PiiVault {
  /** Replaces every detected value with its placeholder. */
  mask(text: string): string
  /** Puts the original values back (unknown placeholders stay as they are). */
  unmask(text: string): string
  /** Distinct values masked so far, by kind. */
  counts(): PiiCounts
  /** Total of distinct values masked so far. */
  size(): number
}

export function createPiiVault(): PiiVault {
  const byKey = new Map<string, string>()
  const byPlaceholder = new Map<string, string>()
  const next: PiiCounts = emptyPiiCounts()

  function placeholderFor(kind: PiiKind, original: string, key: string) {
    const known = byKey.get(`${kind}:${key}`)
    if (known) return known
    next[kind] += 1
    const placeholder = `[${kind}_${next[kind]}]`
    byKey.set(`${kind}:${key}`, placeholder)
    byPlaceholder.set(placeholder, original)
    return placeholder
  }

  return {
    mask(text) {
      if (!text) return text
      let out = text
      for (const detector of DETECTORS) {
        out = out.replace(detector.pattern, (match) => {
          if (detector.accept && !detector.accept(match)) return match
          return placeholderFor(detector.kind, match, detector.normalize(match))
        })
      }
      return out
    },
    unmask(text) {
      if (!text || byPlaceholder.size === 0) return text
      return text.replace(
        PLACEHOLDER,
        (match) => byPlaceholder.get(match) ?? match,
      )
    },
    counts() {
      return { ...next }
    },
    size() {
      return byPlaceholder.size
    },
  }
}

/** Applies `fn` to every string inside a JSON-like value (tool arguments). */
export function mapStrings<T>(value: T, fn: (text: string) => string): T {
  if (typeof value === 'string') return fn(value) as T
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        mapStrings(v, fn),
      ]),
    ) as T
  }
  return value
}

/**
 * Unmasks a streamed answer delta by delta. A placeholder may arrive split
 * across deltas (`[CP` + `F_1]`), so a trailing `[` that could still become
 * one is held back until it closes or grows too long to be a placeholder.
 */
export function createStreamUnmasker(vault: PiiVault) {
  let pending = ''
  return {
    push(delta: string): string {
      const text = pending + delta
      const open = text.lastIndexOf('[')
      if (
        open !== -1 &&
        text.indexOf(']', open) === -1 &&
        text.length - open < PII_PLACEHOLDER_MAX_LENGTH
      ) {
        pending = text.slice(open)
        return vault.unmask(text.slice(0, open))
      }
      pending = ''
      return vault.unmask(text)
    },
    flush(): string {
      const rest = pending
      pending = ''
      return vault.unmask(rest)
    },
  }
}

/** Told to the model whenever something was masked. */
export const PII_MASKING_INSTRUCTION =
  'Alguns dados pessoais desta conversa foram substituídos por marcadores como [CPF_1], [CNPJ_1], [CARD_1], [PHONE_1] ou [EMAIL_1]. Use os marcadores exatamente como estão quando precisar se referir a esses dados (inclusive em argumentos de ferramentas): o sistema devolve o valor real antes de mostrar a resposta. Nunca tente adivinhar o valor original.'
