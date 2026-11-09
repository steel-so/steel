// Pure helpers for custom field values (CRM and WhatsApp contacts): the
// validated Brazilian types and one coercion function shared by the
// services, the spreadsheet import and the forms. No server-only imports, so
// it is safe in the browser.

export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
  'CPF',
  'CNPJ',
  'EMAIL',
  'PHONE',
  'URL',
  'CEP',
] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  TEXT: 'Texto',
  NUMBER: 'Número',
  DATE: 'Data',
  BOOLEAN: 'Sim/Não',
  SELECT: 'Lista de opções',
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  URL: 'Link (URL)',
  CEP: 'CEP',
}

const onlyDigits = (raw: string) => raw.replace(/\D/g, '')

function allSameDigit(digits: string): boolean {
  return /^(\d)\1+$/.test(digits)
}

/** CPF check digits (modulo 11). Expects 11 digits. */
export function isValidCpf(raw: string): boolean {
  const d = onlyDigits(raw)
  if (d.length !== 11 || allSameDigit(d)) return false
  for (const size of [9, 10]) {
    let sum = 0
    for (let i = 0; i < size; i++) sum += Number(d[i]) * (size + 1 - i)
    const check = ((sum * 10) % 11) % 10
    if (check !== Number(d[size])) return false
  }
  return true
}

/** CNPJ check digits (modulo 11). Expects 14 digits. */
export function isValidCnpj(raw: string): boolean {
  const d = onlyDigits(raw)
  if (d.length !== 14 || allSameDigit(d)) return false
  for (const size of [12, 13]) {
    const weights =
      size === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let sum = 0
    for (let i = 0; i < size; i++) sum += Number(d[i]) * weights[i]
    const rest = sum % 11
    const check = rest < 2 ? 0 : 11 - rest
    if (check !== Number(d[size])) return false
  }
  return true
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export interface CustomFieldDefinitionLike {
  label: string
  type: CustomFieldType
  options?: readonly string[]
  required?: boolean
}

export type CustomFieldCoerced =
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; message: string }

/**
 * Validates and normalizes a raw value for a field. Empty means "no value"
 * (an error when the field is required). CPF, CNPJ, CEP and phone are stored
 * as digits only; e-mail is lower-cased; URLs must be http(s).
 */
export function coerceCustomFieldValue(
  def: CustomFieldDefinitionLike,
  raw: unknown,
): CustomFieldCoerced {
  const empty =
    raw === null ||
    raw === undefined ||
    (typeof raw === 'string' && raw.trim() === '')
  if (empty) {
    return def.required
      ? { ok: false, message: `"${def.label}" é obrigatório` }
      : { ok: true, value: null }
  }
  const text = String(raw).trim()
  const bad = (message: string): CustomFieldCoerced => ({
    ok: false,
    message: `"${def.label}" ${message}`,
  })

  switch (def.type) {
    case 'NUMBER': {
      const n = typeof raw === 'number' ? raw : Number(text.replace(',', '.'))
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : bad('deve ser numérico')
    }
    case 'BOOLEAN': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      const lowered = text.toLowerCase()
      if (['sim', 's', 'true', '1', 'yes'].includes(lowered)) {
        return { ok: true, value: true }
      }
      if (['nao', 'não', 'n', 'false', '0', 'no'].includes(lowered)) {
        return { ok: true, value: false }
      }
      return bad('deve ser Sim ou Não')
    }
    case 'DATE': {
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
      const d = new Date(br ? `${br[3]}-${br[2]}-${br[1]}` : text)
      return Number.isNaN(d.getTime())
        ? bad('tem data inválida')
        : { ok: true, value: d.toISOString() }
    }
    case 'SELECT':
      return def.options?.includes(text)
        ? { ok: true, value: text }
        : bad('tem opção inválida')
    case 'CPF':
      return isValidCpf(text)
        ? { ok: true, value: onlyDigits(text) }
        : bad('tem um CPF inválido')
    case 'CNPJ':
      return isValidCnpj(text)
        ? { ok: true, value: onlyDigits(text) }
        : bad('tem um CNPJ inválido')
    case 'CEP': {
      const digits = onlyDigits(text)
      return digits.length === 8
        ? { ok: true, value: digits }
        : bad('tem um CEP inválido (8 dígitos)')
    }
    case 'PHONE': {
      const digits = onlyDigits(text)
      return digits.length >= 8 && digits.length <= 15
        ? { ok: true, value: digits }
        : bad('tem um telefone inválido (8 a 15 dígitos, com DDD)')
    }
    case 'EMAIL':
      return EMAIL_PATTERN.test(text) && text.length <= 254
        ? { ok: true, value: text.toLowerCase() }
        : bad('tem um e-mail inválido')
    case 'URL': {
      try {
        const url = new URL(text)
        return url.protocol === 'http:' || url.protocol === 'https:'
          ? { ok: true, value: url.toString() }
          : bad('deve começar com http:// ou https://')
      } catch {
        return bad('tem um link inválido')
      }
    }
    default:
      return text.length <= 2000
        ? { ok: true, value: text }
        : bad('é longo demais (máximo 2000 caracteres)')
  }
}

/** Display form of a stored value (CPF/CNPJ/CEP/phone masks, dates in pt-BR). */
export function formatCustomFieldValue(
  type: CustomFieldType,
  value: unknown,
): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  const text = String(value)
  const d = onlyDigits(text)
  switch (type) {
    case 'CPF':
      return d.length === 11
        ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
        : text
    case 'CNPJ':
      return d.length === 14
        ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
        : text
    case 'CEP':
      return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : text
    case 'PHONE':
      return d.length === 11
        ? d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
        : d.length === 10
          ? d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
          : text
    case 'DATE': {
      const date = new Date(text)
      return Number.isNaN(date.getTime())
        ? text
        : date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
    }
    default:
      return text
  }
}

/** `Telefone Principal` → `telefone_principal` (field key from its label). */
export function customFieldKeyFromLabel(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return /^[a-z]/.test(slug) ? slug : `campo_${slug}`.replace(/_$/, '')
}
