/**
 * Exportação de dados tabulares para CSV e Excel — sem dependência externa.
 * O "Excel" é gerado no formato SpreadsheetML (Office XML), que o Excel,
 * LibreOffice e Google Sheets abrem nativamente.
 */

type Row = Record<string, unknown>

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return String(value)
}

/** Escapa um campo CSV (RFC 4180): aspas duplas e separadores. */
export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** Gera um CSV (com BOM para o Excel reconhecer UTF-8). */
export function toCsv(columns: string[], rows: Row[]): string {
  const header = columns.map((c) => csvField(c)).join(',')
  const body = rows
    .map((row) => columns.map((c) => csvField(cellText(row[c]))).join(','))
    .join('\r\n')
  return `﻿${header}\r\n${body}`
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Gera uma planilha SpreadsheetML 2003 (.xls XML) — Excel-compatível, números
 * detectados automaticamente. Uma única aba "Relatório".
 */
export function toSpreadsheetML(columns: string[], rows: Row[]): string {
  const cellXml = (value: unknown): string => {
    const text = cellText(value)
    const num = Number(text)
    const isNum = text !== '' && Number.isFinite(num) && !Array.isArray(value)
    const type = isNum ? 'Number' : 'String'
    const content = isNum ? String(num) : xmlEscape(text)
    return `<Cell><Data ss:Type="${type}">${content}</Data></Cell>`
  }

  const headerRow = `<Row>${columns
    .map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`)
    .join('')}</Row>`
  const bodyRows = rows
    .map((row) => `<Row>${columns.map((c) => cellXml(row[c])).join('')}</Row>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Relatório">
  <Table>${headerRow}${bodyRows}</Table>
 </Worksheet>
</Workbook>`
}
