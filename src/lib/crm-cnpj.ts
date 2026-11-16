/**
 * CNPJ: normalização, máscara, validação dos dígitos e os tipos do resultado
 * da consulta (a consulta em si roda no servidor — `crm-cnpj-lookup.ts` pelo
 * navegador, `src/lib/cnpj/provider.ts` no worker).
 */

/** Mantém apenas os dígitos do CNPJ (máx. 14). */
export function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, '').slice(0, 14)
}

/** Formata como `00.000.000/0000-00` (parcial enquanto digita). */
export function formatCnpj(value: string): string {
  const d = normalizeCnpj(value)
  let out = d.slice(0, 2)
  if (d.length > 2) out += `.${d.slice(2, 5)}`
  if (d.length > 5) out += `.${d.slice(5, 8)}`
  if (d.length > 8) out += `/${d.slice(8, 12)}`
  if (d.length > 12) out += `-${d.slice(12, 14)}`
  return out
}

/** `true` quando o CNPJ tem os 14 dígitos. */
export function isCompleteCnpj(value: string): boolean {
  return normalizeCnpj(value).length === 14
}

/** Valida os dois dígitos verificadores do CNPJ. */
export function isValidCnpj(value: string): boolean {
  const d = normalizeCnpj(value)
  if (d.length !== 14) return false
  // Rejeita sequências repetidas (ex.: 00000000000000), que passam no cálculo.
  if (/^(\d)\1{13}$/.test(d)) return false

  const digit = (slice: string, start: number): number => {
    let sum = 0
    let weight = start
    for (const char of slice) {
      sum += Number(char) * weight
      weight = weight === 2 ? 9 : weight - 1
    }
    const mod = sum % 11
    return mod < 2 ? 0 : 11 - mod
  }

  const dv1 = digit(d.slice(0, 12), 5)
  const dv2 = digit(d.slice(0, 13), 6)
  return dv1 === Number(d[12]) && dv2 === Number(d[13])
}

export type CrmCompanyAddressInput = {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zipCode?: string
}

/** Resultado da consulta: campos prontos para preencher a grade da empresa. */
export type CnpjLookup = {
  cnpj: string
  razaoSocial?: string
  nomeFantasia?: string
  /** Melhor nome de exibição: nome fantasia, ou razão social como fallback. */
  name?: string
  address: CrmCompanyAddressInput | null
  /** Registry data and contacts, ready to autofill the matching columns. */
  registry?: Record<string, unknown>
}

export class CnpjNotFoundError extends Error {
  constructor() {
    super('CNPJ não encontrado')
    this.name = 'CnpjNotFoundError'
  }
}
