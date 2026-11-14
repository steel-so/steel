// Modelo de planilha padrão (CSV): telefone, nome (opcional),
// data_referencia, var_1..var_N — N é o número de variáveis do BODY do
// template Meta escolhido. CSV em vez de .xlsx binário: cobre o caso de uso
// (exportação de sistema de terceiro) sem puxar uma dependência de parsing
// binário nova (risco de supply chain) para um formato que qualquer
// planilha exporta nativamente.

export interface BroadcastImportRow {
  phone: string
  contactName?: string
  referenceDate: string
  variables: string[]
}

export interface ParsedBroadcastImportCsv {
  rows: BroadcastImportRow[]
  parseErrors: string[]
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

export function parseBroadcastImportCsv(
  csvText: string,
): ParsedBroadcastImportCsv {
  const lines = csvText
    .split(/\r\n|\n/)
    .filter((line) => line.trim().length > 0)
  if (lines.length < 2) {
    return { rows: [], parseErrors: ['Arquivo vazio ou sem linhas de dados'] }
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const phoneIndex = header.indexOf('telefone')
  const dateIndex = header.indexOf('data_referencia')
  const nameIndex = header.indexOf('nome')

  if (phoneIndex === -1 || dateIndex === -1) {
    return {
      rows: [],
      parseErrors: [
        'Cabeçalho deve conter as colunas "telefone" e "data_referencia"',
      ],
    }
  }

  const variableIndexes = header
    .map((h, index) => ({ h, index }))
    .filter(({ h }) => /^var_\d+$/.test(h))
    .sort((a, b) => Number(a.h.slice(4)) - Number(b.h.slice(4)))
    .map(({ index }) => index)

  const rows: BroadcastImportRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const columns = splitCsvLine(lines[i])
    rows.push({
      phone: (columns[phoneIndex] ?? '').trim(),
      contactName:
        nameIndex !== -1 ? (columns[nameIndex] ?? '').trim() : undefined,
      referenceDate: (columns[dateIndex] ?? '').trim(),
      variables: variableIndexes.map((index) => (columns[index] ?? '').trim()),
    })
  }

  return { rows, parseErrors: [] }
}

export interface ValidatedBroadcastImportRow {
  rowNumber: number
  phone: string
  contactName?: string
  scheduledAt: Date
  // Data/hora real do compromisso (ex: exame) — distinta de `scheduledAt`
  // (horário de disparo do lembrete). Persistida pra a IA poder consultar
  // via tool calling quando o cliente pergunta sobre agendamentos.
  appointmentAt: Date
  variableValues: { body: Record<string, string> }
}

export interface RejectedBroadcastImportRow {
  rowNumber: number
  reason: string
}

export interface BroadcastImportValidationResult {
  valid: ValidatedBroadcastImportRow[]
  rejected: RejectedBroadcastImportRow[]
}

const PHONE_PATTERN = /^\d{10,15}$/

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

export const BROADCAST_IMPORT_TIME_ZONE = 'America/Sao_Paulo'

const BR_DATE_PATTERN =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/
const ISO_WALL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - instant.getTime()
}

/**
 * Parses the reference date of a spreadsheet row. Accepts the Brazilian
 * `dd/MM/yyyy` and `dd/MM/yyyy HH:mm` (read as wall time in `timeZone`) as
 * well as ISO 8601. Returns `null` when the text is not a real date.
 */
export function parseReferenceDate(
  raw: string,
  timeZone = BROADCAST_IMPORT_TIME_ZONE,
): Date | null {
  const text = raw.trim()
  const br = BR_DATE_PATTERN.exec(text)
  // ISO without an offset (`2026-11-21`, `2026-11-21T10:00`) is a wall time
  // too, in the same zone as the Brazilian format, not UTC.
  const isoWall = br ? null : ISO_WALL_PATTERN.exec(text)
  if (!br && !isoWall) {
    const iso = new Date(text)
    return Number.isNaN(iso.getTime()) ? null : iso
  }
  const day = br ? Number(br[1]) : Number(isoWall?.[3])
  const month = br ? Number(br[2]) : Number(isoWall?.[2])
  const year = br ? Number(br[3]) : Number(isoWall?.[1])
  const hourText = br ? br[4] : isoWall?.[4]
  const minuteText = br ? br[5] : isoWall?.[5]
  const hour = hourText === undefined ? 0 : Number(hourText)
  const minute = minuteText === undefined ? 0 : Number(minuteText)
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute))
  // Rejects overflow such as 31/02 or 25:00 that Date.UTC would roll over.
  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour
  ) {
    return null
  }
  // Two passes settle the offset around daylight-saving transitions.
  const first = new Date(wall.getTime() - zoneOffsetMs(wall, timeZone))
  return new Date(wall.getTime() - zoneOffsetMs(first, timeZone))
}

export interface ValidateBroadcastImportOptions {
  /** Zone used to read `dd/MM/yyyy HH:mm` dates. Defaults to São Paulo. */
  timeZone?: string
  /** When set, rows whose send time already passed are rejected. */
  now?: Date
}

function formatForUser(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export function validateBroadcastImportRows(
  rows: BroadcastImportRow[],
  bodyVariableCount: number,
  sendOffsetHours: number,
  options: ValidateBroadcastImportOptions = {},
): BroadcastImportValidationResult {
  const timeZone = options.timeZone ?? BROADCAST_IMPORT_TIME_ZONE
  const valid: ValidatedBroadcastImportRow[] = []
  const rejected: RejectedBroadcastImportRow[] = []

  rows.forEach((row, index) => {
    const rowNumber = index + 1
    const phone = normalizePhone(row.phone)

    if (!PHONE_PATTERN.test(phone)) {
      rejected.push({
        rowNumber,
        reason: `Telefone inválido: "${row.phone}"`,
      })
      return
    }

    const referenceDate = parseReferenceDate(row.referenceDate, timeZone)
    if (!referenceDate) {
      rejected.push({
        rowNumber,
        reason: `Data de referência inválida: "${row.referenceDate}". Use dd/mm/aaaa hh:mm, por exemplo 15/12/2026 09:30.`,
      })
      return
    }

    if (row.variables.length !== bodyVariableCount) {
      rejected.push({
        rowNumber,
        reason: `Template exige ${bodyVariableCount} variável(is), a linha tem ${row.variables.length}`,
      })
      return
    }

    if (row.variables.some((value) => !value)) {
      rejected.push({
        rowNumber,
        reason: 'Uma ou mais variáveis estão em branco',
      })
      return
    }

    const scheduledAt = new Date(
      referenceDate.getTime() - sendOffsetHours * 60 * 60 * 1000,
    )
    if (options.now && scheduledAt.getTime() < options.now.getTime()) {
      rejected.push({
        rowNumber,
        reason: `O envio seria em ${formatForUser(scheduledAt, timeZone)}, que já passou. Use uma data de referência mais distante ou diminua as horas de antecedência.`,
      })
      return
    }

    const body: Record<string, string> = {}
    row.variables.forEach((value, i) => {
      body[String(i + 1)] = value
    })

    valid.push({
      rowNumber,
      phone,
      contactName: row.contactName || undefined,
      scheduledAt,
      appointmentAt: referenceDate,
      variableValues: { body },
    })
  })

  return { valid, rejected }
}
