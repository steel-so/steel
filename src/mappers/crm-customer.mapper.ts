import type { CustomerRow } from '@/src/repositories/crm-customer.repository'
import type { CrmCustomerRowDTO } from '@/src/schemas/crm-customer.schema'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toCrmCustomerRowDTO(row: CustomerRow): CrmCustomerRowDTO {
  return {
    kind: row.kind,
    id: row.entity_id,
    name: row.name,
    subtitle: row.subtitle,
    deals: Number(row.deals),
    totalWon: Number(row.total ?? 0),
    averageTicket: Number(row.average ?? 0),
    firstWonAt: iso(row.first_won),
    lastWonAt: iso(row.last_won),
    nextRenewalAt: iso(row.next_renewal),
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    health:
      row.health_level && row.health_risk !== null
        ? {
            level: row.health_level,
            score: Math.max(0, Math.min(100, 100 - Number(row.health_risk))),
          }
        : null,
  }
}

/**
 * RFC 4180 field, plus a guard against spreadsheet formula injection: a
 * text cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`.
 */
function csvCell(value: string | number | null): string {
  if (value === null) return ''
  if (typeof value === 'number') return String(value)
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const HEALTH_LABEL = { LOW: 'Saudável', MEDIUM: 'Atenção', HIGH: 'Em risco' }

export const CRM_CUSTOMERS_CSV_HEADER = [
  'Nome',
  'Tipo',
  'Empresa/Domínio',
  'Negócios ganhos',
  'Valor total ganho',
  'Ticket médio',
  'Primeiro negócio ganho',
  'Último negócio ganho',
  'Próxima renovação',
  'Responsável',
  'Saúde',
]

const day = (value: string | null) => (value ? value.slice(0, 10) : null)

/** Excel-friendly CSV (UTF-8 BOM, CRLF) of the filtered customers. */
export function toCrmCustomersCsv(rows: CrmCustomerRowDTO[]): string {
  const line = (cells: (string | number | null)[]) =>
    `${cells.map(csvCell).join(',')}\r\n`
  const body = rows.map((row) =>
    line([
      row.name,
      row.kind === 'COMPANY' ? 'Empresa' : 'Pessoa',
      row.subtitle,
      row.deals,
      Math.round(row.totalWon * 100) / 100,
      Math.round(row.averageTicket * 100) / 100,
      day(row.firstWonAt),
      day(row.lastWonAt),
      day(row.nextRenewalAt),
      row.ownerName,
      row.health
        ? `${HEALTH_LABEL[row.health.level]} (${row.health.score})`
        : null,
    ]),
  )
  return `﻿${line(CRM_CUSTOMERS_CSV_HEADER)}${body.join('')}`
}
