import { toDisplayPhone } from '@/src/lib/phone-br'

/** Máscaras de digitação dos cadastros (a API normaliza para dígitos). */

/** `(11) 98765-4321` progressivo; o DDI 55 é nosso e não aparece. */
export const maskPhone = toDisplayPhone

/** `00000-000` progressivo. */
export function maskCep(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

/** `''` → `null` (campo limpo no PATCH). */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
