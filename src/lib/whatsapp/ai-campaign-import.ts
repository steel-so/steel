/**
 * Planilha da campanha (CSV exportado do Excel/Sheets/sistemas): a primeira
 * linha é o cabeçalho; o separador (`,` ou `;`) é detectado. Puro — roda no
 * navegador antes do envio. As colunas que não são telefone/nome viram
 * valores para as variáveis do template.
 */

export interface ParsedAiCampaignSheet {
  columns: string[]
  rows: Record<string, string>[]
}

export const AI_CAMPAIGN_IMPORT_MAX_CHARS = 5_000_000

const PHONE_HEADERS = [
  'telefone',
  'celular',
  'whatsapp',
  'phone',
  'fone',
  'numero',
  'número',
]
const NAME_HEADERS = ['nome', 'name', 'cliente', 'contato']
const DESCRIPTION_HEADERS = ['descricao', 'description']

function splitLine(line: string, separator: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        current += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === separator) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

export function parseAiCampaignSheet(text: string): ParsedAiCampaignSheet {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  if (lines.length === 0) return { columns: [], rows: [] }

  const header = lines[0]
  const separator =
    (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0)
      ? ';'
      : ','
  const columns = splitLine(header, separator).map(
    (column, index) => column || `coluna_${index + 1}`,
  )
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, separator)
    return Object.fromEntries(
      columns.map((column, index) => [column, cells[index] ?? '']),
    )
  })
  return { columns, rows }
}

function guess(columns: string[], candidates: string[]): string | null {
  const normalized = columns.map((column) =>
    column.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
  )
  for (const candidate of candidates) {
    const index = normalized.findIndex((column) => column.includes(candidate))
    if (index >= 0) return columns[index]
  }
  return null
}

/** Best guess of the phone, name and description columns from the header. */
export function guessAiCampaignSheetColumns(columns: string[]): {
  phone: string | null
  name: string | null
  description: string | null
} {
  const phone = guess(columns, PHONE_HEADERS)
  const name = guess(
    columns.filter((column) => column !== phone),
    NAME_HEADERS,
  )
  const description = guess(
    columns.filter((column) => column !== phone && column !== name),
    DESCRIPTION_HEADERS,
  )
  return { phone, name, description }
}

/**
 * Rows as the API takes them: phone, name, description (saved on the contact)
 * and the other columns as values.
 */
export function toAiCampaignImportRows(
  sheet: ParsedAiCampaignSheet,
  mapping: { phone: string; name: string | null; description?: string | null },
): {
  phone: string
  name?: string
  description?: string
  values: Record<string, string>
}[] {
  return sheet.rows
    .map((row) => {
      const values = Object.fromEntries(
        Object.entries(row).filter(
          ([column, value]) =>
            column !== mapping.phone && column !== mapping.name && value !== '',
        ),
      )
      const name = mapping.name ? row[mapping.name]?.trim() : ''
      const description = mapping.description
        ? row[mapping.description]?.trim()
        : ''
      return {
        phone: row[mapping.phone]?.trim() ?? '',
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        values,
      }
    })
    .filter((row) => row.phone.replace(/\D/g, '').length > 0)
}
