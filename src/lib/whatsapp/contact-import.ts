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

const NAME_ALIASES = ['nome', 'name', 'contato'] as const
const PHONE_ALIASES = [
  'telefone',
  'celular',
  'whatsapp',
  'numero',
  'phone',
] as const
const DESCRIPTION_ALIASES = [
  'descricao',
  'observacoes',
  'observacao',
  'description',
] as const

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
  const known = new Set<string>(PHONE_ALIASES)
  if (!headers.some((h) => known.has(normalizeCsvHeader(h)))) {
    return {
      valid: [],
      rejected: [],
      fileError: 'A planilha precisa ter a coluna "Telefone".',
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
    const rawPhone = pickCsvValue(record, PHONE_ALIASES) ?? ''
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
    const name = pickCsvValue(record, NAME_ALIASES)
    const description = pickCsvValue(record, DESCRIPTION_ALIASES)
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
