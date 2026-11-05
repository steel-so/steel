import {
  csvToRecords,
  normalizeCsvHeader,
  pickCsvValue,
} from '@/src/lib/servicedesk/csv'

// Contact spreadsheet import (CSV only: no binary parser dependency, every
// spreadsheet app exports CSV). Pure module, safe to import from the browser.

export const CONTACT_IMPORT_MAX_ROWS = 1000
export const CONTACT_IMPORT_MAX_CSV_CHARS = 1_000_000

export const CONTACT_IMPORT_TEMPLATE_FILENAME = 'modelo-importacao-contatos.csv'

/** Standard template: `;` separated with BOM so Excel-BR opens it correctly. */
export const CONTACT_IMPORT_TEMPLATE_CSV =
  '﻿Nome;Telefone;Descrição\r\nMaria Silva;5511999998888;Cliente desde 2024\r\n'

/**
 * Accepted header sets. The three columns are mandatory and must carry one of
 * these exact names (case, accents and spacing are ignored): our template
 * (Nome | Telefone | Descrição) or the short sheet (Nome | Número | Detalhes).
 */
const HEADER_FORMATS = [
  {
    label: 'Nome, Telefone e Descrição',
    name: 'nome',
    phone: 'telefone',
    description: 'descricao',
  },
  {
    label: 'Nome, Número e Detalhes',
    name: 'nome',
    phone: 'numero',
    description: 'detalhes',
  },
] as const

type HeaderFormat = (typeof HEADER_FORMATS)[number]

function detectHeaderFormat(headers: string[]): HeaderFormat | null {
  const normalized = new Set(headers.map(normalizeCsvHeader))
  return (
    HEADER_FORMATS.find(
      (format) =>
        normalized.has(format.name) &&
        normalized.has(format.phone) &&
        normalized.has(format.description),
    ) ?? null
  )
}

const PHONE_PATTERN = /^\d{10,15}$/
const NAME_MAX = 120
const DESCRIPTION_MAX = 500

export interface ContactImportRow {
  /** 1-based spreadsheet line (header is line 1). */
  line: number
  waId: string
  name?: string
  description?: string
}

export interface ContactImportRejectedRow {
  line: number
  message: string
}

export interface ParsedContactImport {
  valid: ContactImportRow[]
  rejected: ContactImportRejectedRow[]
  /** Fatal file-level problem (no rows validated). */
  fileError?: string
}

export function normalizeContactPhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function parseContactImportCsv(csv: string): ParsedContactImport {
  const { headers, records } = csvToRecords(csv)
  if (records.length === 0) {
    return {
      valid: [],
      rejected: [],
      fileError: 'A planilha não tem linhas de dados.',
    }
  }
  const format = detectHeaderFormat(headers)
  if (!format) {
    return {
      valid: [],
      rejected: [],
      fileError:
        'A planilha precisa ter os cabeçalhos "Nome", "Telefone" e "Descrição" ou "Nome", "Número" e "Detalhes", exatamente nesses nomes.',
    }
  }
  if (records.length > CONTACT_IMPORT_MAX_ROWS) {
    return {
      valid: [],
      rejected: [],
      fileError: `Importe no máximo ${CONTACT_IMPORT_MAX_ROWS} linhas por vez.`,
    }
  }

  const valid: ContactImportRow[] = []
  const rejected: ContactImportRejectedRow[] = []
  const seen = new Map<string, number>()

  records.forEach((record, index) => {
    const line = index + 2
    const rawPhone = pickCsvValue(record, [format.phone]) ?? ''
    const waId = normalizeContactPhone(rawPhone)
    if (!PHONE_PATTERN.test(waId)) {
      rejected.push({
        line,
        message: rawPhone
          ? `Telefone inválido: "${rawPhone}". Use DDI + DDD + número, ex.: 5511999998888.`
          : 'Telefone em branco.',
      })
      return
    }
    const name = pickCsvValue(record, [format.name])
    const description = pickCsvValue(record, [format.description])
    if (name && name.length > NAME_MAX) {
      rejected.push({
        line,
        message: `Nome muito longo (máximo ${NAME_MAX} caracteres).`,
      })
      return
    }
    if (description && description.length > DESCRIPTION_MAX) {
      rejected.push({
        line,
        message: `Descrição muito longa (máximo ${DESCRIPTION_MAX} caracteres).`,
      })
      return
    }
    const firstLine = seen.get(waId)
    if (firstLine !== undefined) {
      rejected.push({
        line,
        message: `Telefone repetido na planilha (já aparece na linha ${firstLine}).`,
      })
      return
    }
    seen.set(waId, line)
    valid.push({ line, waId, name, description })
  })

  return { valid, rejected }
}
