/**
 * Pure helpers of the sales cadences: merge fields, delays, phone/e-mail
 * matching and the plain-text → HTML conversion of the e-mail steps.
 */
import type { CrmCadenceDelayUnitDTO } from '@/types/crm-cadence'

export interface CadenceMergeContext {
  name: string
  company?: string | null
  jobTitle?: string | null
  city?: string | null
  ownerName?: string | null
}

/** Fields offered in the step editor, with the label shown to the user. */
export const CADENCE_MERGE_FIELDS = [
  { token: '{{nome}}', label: 'Nome do lead' },
  { token: '{{primeiro_nome}}', label: 'Primeiro nome' },
  { token: '{{empresa}}', label: 'Empresa' },
  { token: '{{cargo}}', label: 'Cargo' },
  { token: '{{cidade}}', label: 'Cidade' },
  { token: '{{responsavel}}', label: 'Responsável pelo lead' },
] as const

/** Replaces `{{field}}` tokens; unknown or empty fields become ''. */
export function renderCadenceText(
  template: string,
  context: CadenceMergeContext,
): string {
  const values: Record<string, string> = {
    nome: context.name.trim(),
    primeiro_nome: context.name.trim().split(/\s+/)[0] ?? '',
    empresa: context.company?.trim() ?? '',
    cargo: context.jobTitle?.trim() ?? '',
    cidade: context.city?.trim() ?? '',
    responsavel: context.ownerName?.trim() ?? '',
  }
  return template.replace(
    /\{\{\s*([a-z_]+)\s*\}\}/gi,
    (_match, key: string) => {
      return values[key.toLowerCase()] ?? ''
    },
  )
}

const UNIT_MS: Record<CrmCadenceDelayUnitDTO, number> = {
  MINUTES: 60 * 1000,
  HOURS: 60 * 60 * 1000,
  DAYS: 24 * 60 * 60 * 1000,
}

export function cadenceDelayMs(
  value: number,
  unit: CrmCadenceDelayUnitDTO,
): number {
  return Math.max(0, value) * UNIT_MS[unit]
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * WhatsApp number (digits with country code) of a lead phone typed in any
 * format. Brazilian numbers without the country code get `55`.
 */
export function leadPhoneToWaId(raw: string): string | null {
  const digits = digitsOnly(raw)
  if (digits.length < 10 || digits.length > 15) return null
  if (digits.length <= 11) return `55${digits}`
  return digits
}

/**
 * Same phone typed with or without country code/9th digit mask: compares
 * the last 10 digits (the area code + the subscriber's last 8).
 */
export function phonesMatch(a: string, b: string): boolean {
  const left = digitsOnly(a)
  const right = digitsOnly(b)
  if (left.length < 10 || right.length < 10) return false
  return left.slice(-10) === right.slice(-10)
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Plain text written by the seller → simple HTML (paragraphs, line breaks, links). */
export function cadenceTextToHtml(text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) =>
      escapeHtml(paragraph)
        .replace(
          /(https?:\/\/[^\s<]+)/g,
          (url) => `<a href="${url}">${url}</a>`,
        )
        .replace(/\n/g, '<br>'),
    )
  return paragraphs
    .map((paragraph) => `<p style="margin:0 0 14px">${paragraph}</p>`)
    .join('')
}
