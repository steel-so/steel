import type { DocumentPricingItem } from '@/src/lib/canvas-document/context'
import type { DocumentFieldInfo } from '@/src/lib/canvas-document/fields'
import {
  type CustomFieldType,
  coerceCustomFieldValue,
} from '@/src/lib/custom-field-value'
import type {
  DocumentFieldValuesDTO,
  DocumentPricingSelectionDTO,
} from '@/src/schemas/document.schema'

/**
 * Validation of the answers a reader sends from the public link (accept or
 * submit): every field of the frozen version is checked against its type
 * with the same validators as the CRM custom fields (CPF, CNPJ, e-mail,
 * phone, date). Pure, so the service and the viewer agree.
 */

export type DocumentAnswersResult =
  | { ok: true; values: DocumentFieldValuesDTO }
  | { ok: false; message: string; errors: Record<string, string> }

const TYPE_BY_FIELD: Record<string, CustomFieldType> = {
  'field-text': 'TEXT',
  'field-email': 'EMAIL',
  'field-phone': 'PHONE',
  'field-number': 'NUMBER',
  'field-date': 'DATE',
  'field-cpf': 'CPF',
  'field-cnpj': 'CNPJ',
}

const TEXTAREA_MAX = 5000

type FieldValue = DocumentFieldValuesDTO[string]
type Check = { ok: true; value: FieldValue } | { ok: false; message: string }

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

function required(field: DocumentFieldInfo): Check {
  return { ok: false, message: `"${field.label}" é obrigatório` }
}

function checkField(field: DocumentFieldInfo, raw: unknown): Check {
  if (isEmpty(raw)) {
    return field.required ? required(field) : { ok: true, value: null }
  }
  switch (field.type) {
    case 'field-checkbox': {
      if (typeof raw !== 'boolean') {
        return { ok: false, message: `"${field.label}" deve ser Sim ou Não` }
      }
      if (field.required && !raw) return required(field)
      return { ok: true, value: raw }
    }
    case 'field-select': {
      const options = field.options ?? []
      const picked = Array.isArray(raw) ? raw : [raw]
      if (!field.multiple && picked.length > 1) {
        return { ok: false, message: `"${field.label}" aceita uma opção` }
      }
      const valid = picked.every(
        (item) => typeof item === 'string' && options.includes(item),
      )
      if (!valid) {
        return { ok: false, message: `"${field.label}" tem opção inválida` }
      }
      const values = picked as string[]
      return { ok: true, value: field.multiple ? values : values[0] }
    }
    case 'field-textarea': {
      if (typeof raw !== 'string') {
        return { ok: false, message: `"${field.label}" deve ser um texto` }
      }
      const text = raw.trim()
      return text.length <= TEXTAREA_MAX
        ? { ok: true, value: text }
        : {
            ok: false,
            message: `"${field.label}" é longo demais (máximo ${TEXTAREA_MAX} caracteres)`,
          }
    }
    default: {
      if (Array.isArray(raw) || typeof raw === 'boolean') {
        return { ok: false, message: `"${field.label}" tem um valor inválido` }
      }
      const coerced = coerceCustomFieldValue(
        { label: field.label, type: TYPE_BY_FIELD[field.type] ?? 'TEXT' },
        raw,
      )
      if (!coerced.ok) return { ok: false, message: coerced.message }
      return { ok: true, value: coerced.value as FieldValue }
    }
  }
}

/**
 * Checks the answers against the fields of the version. Unknown keys are
 * dropped; the result keeps only the normalized values of known fields.
 */
export function validateDocumentAnswers(
  fields: DocumentFieldInfo[],
  values: DocumentFieldValuesDTO,
): DocumentAnswersResult {
  const normalized: DocumentFieldValuesDTO = {}
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const result = checkField(field, values[field.id])
    if (!result.ok) {
      errors[field.id] = result.message
      continue
    }
    if (result.value !== null) normalized[field.id] = result.value
  }
  const messages = Object.values(errors)
  if (messages.length > 0) {
    return { ok: false, message: messages[0], errors }
  }
  return { ok: true, values: normalized }
}

/**
 * Keeps only the selection of items that exist in the version, so a reader
 * cannot invent lines; `pricingLineTotal` already ignores the quantity of
 * lines whose quantity is not editable.
 */
export function sanitizePricingSelection(
  items: DocumentPricingItem[],
  selection: DocumentPricingSelectionDTO,
): DocumentPricingSelectionDTO {
  const known = new Set(items.map((item) => item.id))
  const clean: DocumentPricingSelectionDTO = {}
  for (const [id, choice] of Object.entries(selection)) {
    if (known.has(id)) clean[id] = choice
  }
  return clean
}
