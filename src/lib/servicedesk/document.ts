/**
 * CPF/CNPJ do cadastro de clientes/empresas do ServiceDesk: normalização,
 * validação dos dígitos verificadores, máscara de exibição e detecção de
 * pessoa física/jurídica. Lib pura — roda no servidor e no cliente.
 *
 * Aceita também o **CNPJ alfanumérico** que a Receita Federal adota a partir
 * de 2026 (IN RFB 2.229/2024): as 12 primeiras posições podem ter letras
 * maiúsculas e dígitos; os 2 verificadores continuam numéricos e são
 * calculados com o valor de cada caractere = código ASCII − 48 (logo os
 * dígitos valem 0–9 e `A` vale 17), com os mesmos pesos do CNPJ numérico.
 */
import { toStoredPhone } from '@/src/lib/phone-br'

export type SdDocumentKind = 'CPF' | 'CNPJ'
export type SdDocumentPersonType = 'INDIVIDUAL' | 'LEGAL'

/** Maiúsculas, só `[0-9A-Z]`, no máximo 14 caracteres (máscara removida). */
export function normalizeDocument(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 14)
}

function charValue(char: string): number {
  return char.charCodeAt(0) - 48
}

function isValidCpfDigits(d: string): boolean {
  if (!/^\d{11}$/.test(d)) return false
  if (/^(\d)\1{10}$/.test(d)) return false
  const digit = (length: number): number => {
    let sum = 0
    for (let i = 0; i < length; i++) sum += Number(d[i]) * (length + 1 - i)
    const mod = (sum * 10) % 11
    return mod === 10 ? 0 : mod
  }
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10])
}

function isValidCnpjChars(d: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d)) return false
  if (/^(\d)\1{13}$/.test(d)) return false
  const digit = (slice: string): number => {
    let sum = 0
    let weight = 2
    for (let i = slice.length - 1; i >= 0; i--) {
      sum += charValue(slice[i]) * weight
      weight = weight === 9 ? 2 : weight + 1
    }
    const mod = sum % 11
    return mod < 2 ? 0 : 11 - mod
  }
  return (
    digit(d.slice(0, 12)) === Number(d[12]) &&
    digit(d.slice(0, 13)) === Number(d[13])
  )
}

/** CPF válido (11 dígitos, verificadores corretos, sem sequência repetida). */
export function isValidCpf(value: string): boolean {
  return isValidCpfDigits(normalizeDocument(value))
}

/** CNPJ válido — numérico ou alfanumérico (2026). */
export function isValidCnpj(value: string): boolean {
  return isValidCnpjChars(normalizeDocument(value))
}

/**
 * Tipo pelo tamanho: 11 dígitos = CPF, 14 caracteres = CNPJ. `null` quando
 * incompleto/ambíguo. Não valida os verificadores (use `validateDocument`).
 */
export function detectDocumentKind(value: string): SdDocumentKind | null {
  const d = normalizeDocument(value)
  if (/^\d{11}$/.test(d)) return 'CPF'
  if (d.length === 14) return 'CNPJ'
  return null
}

/** Pessoa física (CPF) ou jurídica (CNPJ), pelo documento. */
export function detectPersonType(value: string): SdDocumentPersonType | null {
  const kind = detectDocumentKind(value)
  if (kind === 'CPF') return 'INDIVIDUAL'
  if (kind === 'CNPJ') return 'LEGAL'
  return null
}

export type SdDocumentValidation =
  | { valid: true; kind: SdDocumentKind; normalized: string }
  | { valid: false; kind: SdDocumentKind | null; normalized: string }

/** Normaliza, detecta o tipo e confere os verificadores. */
export function validateDocument(value: string): SdDocumentValidation {
  const normalized = normalizeDocument(value)
  const kind = detectDocumentKind(normalized)
  if (kind === 'CPF' && isValidCpfDigits(normalized)) {
    return { valid: true, kind, normalized }
  }
  if (kind === 'CNPJ' && isValidCnpjChars(normalized)) {
    return { valid: true, kind, normalized }
  }
  return { valid: false, kind, normalized }
}

/**
 * Máscara de exibição, parcial enquanto digita: até 11 dígitos formata como
 * CPF (`000.000.000-00`); com letras ou mais de 11 caracteres, como CNPJ
 * (`00.000.000/0000-00`).
 */
export function formatDocument(value: string): string {
  const d = normalizeDocument(value)
  if (/^\d{0,11}$/.test(d)) {
    let out = d.slice(0, 3)
    if (d.length > 3) out += `.${d.slice(3, 6)}`
    if (d.length > 6) out += `.${d.slice(6, 9)}`
    if (d.length > 9) out += `-${d.slice(9, 11)}`
    return out
  }
  let out = d.slice(0, 2)
  if (d.length > 2) out += `.${d.slice(2, 5)}`
  if (d.length > 5) out += `.${d.slice(5, 8)}`
  if (d.length > 8) out += `/${d.slice(8, 12)}`
  if (d.length > 12) out += `-${d.slice(12, 14)}`
  return out
}

/**
 * Telefone/WhatsApp brasileiro normalizado para dígitos com DDI (E.164 sem
 * o `+`): `(11) 98765-4321` → `5511987654321`. Números com 10–11 dígitos
 * ganham o `55`; os que já começam com 55 (12–13 dígitos) ficam como estão;
 * outros formatos (internacionais) mantêm só os dígitos. Vazio → `null`.
 */
export function normalizePhone(
  value: string | null | undefined,
): string | null {
  if (value == null) return null
  return toStoredPhone(value)
}

/** Exibição de telefone BR: `5511987654321` → `+55 (11) 98765-4321`. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  const local =
    digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits.length === 10 || digits.length === 11
        ? digits
        : null
  if (!local) return `+${digits}`
  const ddd = local.slice(0, 2)
  const rest = local.slice(2)
  const cut = rest.length === 9 ? 5 : 4
  return `+55 (${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}`
}

/**
 * Variações de um número para casar o WhatsApp de entrada com o cadastro:
 * o WhatsApp costuma entregar celulares BR sem o nono dígito
 * (`55 11 8765-4321`), enquanto o cadastro tem `55 11 98765-4321` — e
 * vice-versa. Devolve o número normalizado e, para celulares BR, a variação
 * com/sem o 9.
 */
export function whatsappCandidates(value: string | null | undefined): string[] {
  const phone = normalizePhone(value)
  if (!phone) return []
  const candidates = [phone]
  if (phone.startsWith('55')) {
    const ddd = phone.slice(2, 4)
    const local = phone.slice(4)
    if (local.length === 9 && local.startsWith('9')) {
      candidates.push(`55${ddd}${local.slice(1)}`)
    } else if (local.length === 8 && /^[6-9]/.test(local)) {
      candidates.push(`55${ddd}9${local}`)
    }
  }
  return candidates
}

/** Link `wa.me` para o número (normalizado); `null` sem número. */
export function whatsappLink(value: string | null | undefined): string | null {
  const phone = normalizePhone(value)
  return phone ? `https://wa.me/${phone}` : null
}
