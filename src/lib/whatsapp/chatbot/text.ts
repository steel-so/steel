import { isValidCnpj, isValidCpf } from '@/src/lib/servicedesk/document'
import type {
  ChatbotConditionOperator,
  ChatbotQuestionValidation,
} from '@/src/schemas/whatsapp-chatbot.schema'

/** Lower case, no accents, single spaces: how menu answers are compared. */
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g

/** Replaces `{{variable}}`; an unknown variable becomes an empty string. */
export function interpolate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) =>
    Object.hasOwn(variables, name) ? variables[name] : '',
  )
}

/** Same, for the string values of a JSON template (keeps the JSON valid). */
export function interpolateJson(
  template: string,
  variables: Record<string, string>,
): unknown {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return interpolate(value, variables)
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, walk(item)]),
      )
    }
    return value
  }
  try {
    return walk(JSON.parse(template))
  } catch {
    return interpolate(template, variables)
  }
}

export type AnswerCheck = { ok: true; value: string } | { ok: false }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validDate(value: string): string | null {
  const match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (!match) return null
  const [day, month, year] = [match[1], match[2], match[3]].map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  if (!valid) return null
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

/** Validates (and normalizes) the free-text answer of a question node. */
export function checkAnswer(
  validation: ChatbotQuestionValidation,
  raw: string,
): AnswerCheck {
  const text = raw.trim()
  if (!text) return { ok: false }
  switch (validation) {
    case 'TEXT':
      return { ok: true, value: text }
    case 'NUMBER': {
      const normalized = text.replace(',', '.')
      return /^-?\d+(\.\d+)?$/.test(normalized)
        ? { ok: true, value: normalized }
        : { ok: false }
    }
    case 'EMAIL':
      return EMAIL.test(text)
        ? { ok: true, value: text.toLowerCase() }
        : { ok: false }
    case 'PHONE': {
      const digits = text.replace(/\D/g, '')
      return digits.length >= 10 && digits.length <= 13
        ? { ok: true, value: digits }
        : { ok: false }
    }
    case 'CPF':
      return isValidCpf(text)
        ? { ok: true, value: text.replace(/\D/g, '') }
        : { ok: false }
    case 'CNPJ':
      return isValidCnpj(text)
        ? { ok: true, value: text.replace(/[^0-9a-zA-Z]/g, '').toUpperCase() }
        : { ok: false }
    case 'DATE': {
      const date = validDate(text)
      return date ? { ok: true, value: date } : { ok: false }
    }
  }
}

function asNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  return Number(normalized)
}

/** Evaluates one branch of a condition node against a variable's value. */
export function evaluateCondition(
  operator: ChatbotConditionOperator,
  actual: string,
  expected: string,
): boolean {
  const left = normalizeAnswer(actual)
  const right = normalizeAnswer(expected)
  switch (operator) {
    case 'equals':
      return left === right
    case 'not_equals':
      return left !== right
    case 'contains':
      return left.includes(right)
    case 'not_contains':
      return !left.includes(right)
    case 'is_empty':
      return actual.trim() === ''
    case 'is_not_empty':
      return actual.trim() !== ''
    case 'greater_than':
    case 'less_than': {
      const a = asNumber(actual)
      const b = asNumber(expected)
      if (a === null || b === null) return false
      return operator === 'greater_than' ? a > b : a < b
    }
  }
}

/** Reads `a.b.0.c` from a parsed JSON answer, as text; `null` if missing. */
export function readPath(data: unknown, path: string): string | null {
  let current: unknown = data
  for (const key of path.split('.').filter(Boolean)) {
    if (current === null || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  if (current === undefined || current === null) return null
  if (typeof current === 'object') return JSON.stringify(current)
  return String(current)
}
