/**
 * pt-BR formatting of CRM > Documentos values (variables, e-mails). The
 * platform has no per-workspace timezone yet, so dates use the business
 * timezone of the CRM (America/Sao_Paulo), like the proposal validity.
 */

export const DOCUMENT_TIMEZONE = 'America/Sao_Paulo'

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const day = new Intl.DateTimeFormat('pt-BR', { timeZone: DOCUMENT_TIMEZONE })

/** `R$ 48.000,00` (non-breaking space normalized to a plain one). */
export function formatDocumentMoney(value: number): string {
  return money.format(value).replace(/ /g, ' ')
}

/** `30/11/2026` in the CRM timezone. */
export function formatDocumentDate(value: Date): string {
  return day.format(value)
}
