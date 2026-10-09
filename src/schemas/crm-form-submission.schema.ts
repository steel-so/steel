import z from 'zod'
import type { CrmFormFieldDTO } from './crm-form.schema'

/**
 * Server-side validation of a public form submission against the form's own
 * field definitions. The public renderer validates in the browser, but the
 * endpoint is public (`POST /api/crm/forms/{publicToken}/submit`), so the
 * server must not trust it: required fields, the type of each value (e-mail,
 * phone, number, URL, date, select option, checkbox) and length limits are
 * checked here. Keys that are not fields of the form are dropped, never
 * stored.
 */

export type SubmissionValue = string | boolean

/** Same shape as a Zod issue, so the VALIDATION_ERROR envelope is uniform. */
export interface CrmFormSubmissionIssue {
  code: 'custom'
  path: ['values', string]
  message: string
}

export interface CrmFormSubmissionCheck {
  /** Only the form's fields, trimmed; empty optional fields are omitted. */
  values: Record<string, SubmissionValue>
  issues: CrmFormSubmissionIssue[]
}

export const SUBMISSION_TEXT_MAX = 1000
export const SUBMISSION_TEXTAREA_MAX = 10_000

const EmailSchema = z.email()
const PHONE_SEPARATORS = /[\s().-]/g
const PHONE_RE = /^\+?\d{8,15}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Returns the error message for a non-empty string value, or null. */
function checkText(field: CrmFormFieldDTO, value: string): string | null {
  const max =
    field.type === 'textarea' ? SUBMISSION_TEXTAREA_MAX : SUBMISSION_TEXT_MAX
  if (value.length > max) return `Use no máximo ${max} caracteres`
  switch (field.type) {
    case 'email':
      return EmailSchema.safeParse(value).success ? null : 'E-mail inválido'
    case 'phone':
      return PHONE_RE.test(value.replace(PHONE_SEPARATORS, ''))
        ? null
        : 'Telefone inválido'
    case 'number':
      return Number.isFinite(Number(value.replace(',', '.')))
        ? null
        : 'Informe um número'
    case 'url':
      return isValidUrl(value) ? null : 'Endereço inválido'
    case 'date':
      return isValidDate(value) ? null : 'Data inválida (use AAAA-MM-DD)'
    case 'select':
      return field.options?.some((o) => o.value === value)
        ? null
        : 'Opção inválida'
    default:
      return null
  }
}

export function validateCrmFormSubmission(
  fields: CrmFormFieldDTO[],
  raw: Record<string, SubmissionValue>,
): CrmFormSubmissionCheck {
  const values: Record<string, SubmissionValue> = {}
  const issues: CrmFormSubmissionIssue[] = []
  const issue = (key: string, message: string) =>
    issues.push({ code: 'custom', path: ['values', key], message })

  for (const field of fields) {
    const value = raw[field.key]

    if (field.type === 'checkbox') {
      if (value !== undefined && typeof value !== 'boolean') {
        issue(field.key, 'Valor deve ser verdadeiro ou falso')
        continue
      }
      if (field.required && value !== true) {
        issue(field.key, 'Campo obrigatório')
        continue
      }
      if (value !== undefined) values[field.key] = value
      continue
    }

    if (typeof value === 'boolean') {
      issue(field.key, 'Valor deve ser um texto')
      continue
    }
    const text = (value ?? '').trim()
    if (text === '') {
      if (field.required) issue(field.key, 'Campo obrigatório')
      continue
    }
    const error = checkText(field, text)
    if (error) {
      issue(field.key, error)
      continue
    }
    values[field.key] = text
  }

  return { values, issues }
}
