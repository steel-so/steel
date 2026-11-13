/**
 * Field errors of the API envelope, shared by the server (flattening Zod
 * issues) and the client (building a "campo: motivo" message). Pure, so it is
 * safe to import from both sides.
 */

export type FieldErrors = Record<string, string[]>

type IssueLike = { path?: unknown; message?: unknown }

function isIssueArray(value: unknown): value is IssueLike[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === 'object' && 'message' in item)
  )
}

/** Groups Zod-like `issues` by field path (`address.zip`); root issues use `_`. */
export function fieldErrorsFromIssues(issues: unknown): FieldErrors | null {
  if (!isIssueArray(issues)) return null
  const result: FieldErrors = {}
  for (const issue of issues) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : ''
    const key = path || '_'
    const message = String(issue.message)
    result[key] = [...(result[key] ?? []), message]
  }
  return result
}

/**
 * Reads the field errors out of an envelope `error` object, whichever shape
 * the server used: `error.fieldErrors`, `details.fieldErrors` (Zod flatten)
 * or `details` as the raw issues array.
 */
export function readFieldErrors(error: unknown): FieldErrors | null {
  if (!error || typeof error !== 'object') return null
  const { fieldErrors, details } = error as {
    fieldErrors?: unknown
    details?: unknown
  }
  const direct = normalize(fieldErrors)
  if (direct) return direct
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const nested = normalize((details as { fieldErrors?: unknown }).fieldErrors)
    if (nested) return nested
  }
  return fieldErrorsFromIssues(details)
}

function normalize(value: unknown): FieldErrors | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: FieldErrors = {}
  for (const [key, messages] of Object.entries(value)) {
    if (Array.isArray(messages) && messages.length > 0) {
      result[key] = messages.map(String)
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

/** "campo: motivo · outro: motivo" (first reason per field). */
export function formatFieldErrors(fieldErrors: FieldErrors): string {
  return Object.entries(fieldErrors)
    .map(([field, messages]) =>
      field === '_' ? messages[0] : `${field}: ${messages[0]}`,
    )
    .join(' · ')
}
